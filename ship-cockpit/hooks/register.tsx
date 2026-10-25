import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ShipDeploy, ShipPr, ShipSnapshot } from '../types'
import { cdTarget, envFilesIn, hostsIn, isDbMutation, isProdEnvFile, riskyHost } from './db'
import type { HostMark, HostVerdict } from './db'
import { classify, touchesShipState } from './rules'

const PANE = 'ship'
const DEPLOYS_KEY = 'deploys'
const DB_MARKS_KEY = 'dbHosts'
const snapshot = atom({ plugin: 'ship-cockpit', key: 'snapshot' } as const, {
  updatedAt: 0,
  dirty: 0,
  ahead: 0,
  behind: 0,
  issues: [],
} as ShipSnapshot)

const SHIP_PROMPT = `Ship the current work, stopping at the first failure and telling me why:
1. Run the project's tests and lint.
2. Commit any changes with a clear message, push the branch and open a PR (or update the open one).
3. Wait for the PR's checks; merge it only when they pass.
4. Deploy to production with the Vercel CLI. ship-cockpit will ask me to confirm the deploy.
5. Smoke-test the production URL and report what shipped.
Never run migrations or data changes against production.`

async function git($: EngineInterface, ...args: string[]): Promise<string> {
  const ran = await $.process.run(['git', ...args], { timeoutMs: 10_000 })
  return ran.exitCode === 0 ? ran.stdout.trim() : ''
}

async function gh($: EngineInterface, ...args: string[]): Promise<unknown> {
  const ran = await $.process.run(['gh', ...args], { timeoutMs: 20_000 })
  if (ran.exitCode !== 0) return undefined
  try {
    return JSON.parse(ran.stdout)
  } catch {
    return undefined
  }
}

function checksOf(rollup: unknown): ShipPr['checks'] {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none'
  const states = rollup.map(c => String(c?.conclusion || c?.state || c?.status || '').toUpperCase())
  if (states.some(s => /FAIL|ERROR|CANCEL|TIMED_OUT|ACTION_REQUIRED/.test(s))) return 'failing'
  if (states.every(s => /SUCCESS|NEUTRAL|SKIPPED/.test(s))) return 'passing'
  return 'pending'
}

async function lastDeploy($: EngineInterface): Promise<ShipDeploy | undefined> {
  const list = (await $.store.get(DEPLOYS_KEY)) as ShipDeploy[] | undefined
  return list?.[list.length - 1]
}

/** Re-reads git; with `withGitHub`, also the PR and issues (kept from the last read otherwise). */
async function refresh($: EngineInterface, withGitHub = true): Promise<void> {
  try {
    const branch = await git($, 'branch', '--show-current')
    if (!branch) {
      await update($, snapshot, s => ({ ...s, updatedAt: Date.now(), error: 'not a git repository' }))
      return
    }
    const [head, status, counts] = await Promise.all([
      git($, 'rev-parse', '--short', 'HEAD'),
      git($, 'status', '--porcelain'),
      git($, 'rev-list', '--left-right', '--count', '@{upstream}...HEAD'),
    ])
    const [behind = 0, ahead = 0] = counts ? counts.split(/\s+/).map(Number) : [0, 0]
    const before = await read($, snapshot)
    const [prRaw, issuesRaw, deploy] = await Promise.all([
      withGitHub ? gh($, 'pr', 'view', '--json', 'number,title,state,statusCheckRollup') : undefined,
      withGitHub
        ? gh($, 'issue', 'list', '--state', 'open', '--limit', '5', '--json', 'number,title,updatedAt', '--search', 'sort:updated-desc')
        : undefined,
      lastDeploy($),
    ])
    const raw = prRaw as { number: number; title: string; state: string; statusCheckRollup: unknown } | undefined
    const pr = withGitHub
      ? raw && { number: raw.number, title: raw.title, state: raw.state, checks: checksOf(raw.statusCheckRollup) }
      : before.branch === branch ? before.pr : undefined
    const next: ShipSnapshot = {
      updatedAt: Date.now(),
      branch,
      head,
      dirty: status ? status.split('\n').length : 0,
      ahead,
      behind,
      pr,
      issues: withGitHub ? (Array.isArray(issuesRaw) ? (issuesRaw as ShipSnapshot['issues']) : []) : before.issues,
      lastDeploy: deploy,
    }
    await update($, snapshot, () => next)
    $.ui.status(statusLine(next))
  } catch (err) {
    await update($, snapshot, s => ({ ...s, updatedAt: Date.now(), error: String(err).slice(0, 120) }))
  }
}

function statusLine(s: ShipSnapshot): string {
  const pr = s.pr ? ` · PR #${s.pr.number} ${s.pr.checks}` : ''
  const dirty = s.dirty ? ` · ${s.dirty} uncommitted` : ''
  return `⛵ ${s.branch}${dirty}${pr}`
}

function ago(at: number): string {
  const min = Math.round((Date.now() - at) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  if (min < 48 * 60) return `${Math.round(min / 60)}h ago`
  return `${Math.round(min / 1440)}d ago`
}

/** Asks the person to confirm a production deploy; anything but "Deploy" refuses. */
async function confirmDeploy($: EngineInterface, segment: string): Promise<string | undefined> {
  const s = await read($, snapshot)
  const warnings = [
    s.branch && !/^(main|master)$/.test(s.branch) ? `branch is ${s.branch}, not main` : '',
    s.dirty ? `${s.dirty} uncommitted change(s)` : '',
    s.pr?.checks === 'failing' ? 'PR checks are failing' : '',
  ].filter(Boolean)
  const where = s.branch ? ` from ${s.branch}@${s.head}` : ''
  const warn = warnings.length ? ` ⚠ ${warnings.join('; ')}.` : ''
  try {
    const answer = await $.ui.ask(`Deploy to PRODUCTION${where}?${warn} Command: ${segment.slice(0, 160)}`, {
      header: 'Ship',
      options: ['Cancel', 'Deploy'],
    })
    return answer === 'Deploy' ? undefined : `the user chose "${answer}"`
  } catch {
    return 'nobody confirmed it'
  }
}

async function dbMarks($: EngineInterface): Promise<Record<string, HostMark>> {
  return ((await $.store.get(DB_MARKS_KEY)) as Record<string, HostMark> | undefined) ?? {}
}

async function readText($: EngineInterface, path: string): Promise<string> {
  try {
    return String(await $.fs.read(path))
  } catch {
    return ''
  }
}

/** Where a database-writing command points, and the first target to treat as production. */
async function judgeDb($: EngineInterface, command: string): Promise<{ dir: string; targets: string[]; risky?: HostVerdict }> {
  const cwd = await $.session.cwd()
  const home = (await $.env.get('HOME')) ?? ''
  const cd = cdTarget(command)?.replace(/^~(?=\/|$)/, home)
  const dir = !cd ? cwd : cd.startsWith('/') ? cd : `${cwd}/${cd}`
  const inDir = (file: string) => (file.startsWith('/') ? file : `${dir}/${file}`)

  const explicit = envFilesIn(command)
  const inline = hostsIn(command)
  let targets = [...inline]
  for (const file of explicit) targets.push(...hostsIn(await readText($, inDir(file))))
  if (inline.length === 0 && explicit.length === 0) {
    for (const file of ['.env.local', '.env']) targets.push(...hostsIn(await readText($, inDir(file))))
    targets.push(...hostsIn(`DATABASE_URL=${(await $.env.get('DATABASE_URL')) ?? ''}`))
  }
  targets = [...new Set(targets)]

  const prodFileHosts = new Set<string>()
  const entries = await $.fs.list(dir).catch(() => [])
  for (const entry of entries)
    if (entry.kind === 'file' && isProdEnvFile(entry.name))
      for (const host of hostsIn(await readText($, inDir(entry.name)))) prodFileHosts.add(host)

  return { dir, targets, risky: riskyHost(targets, await dbMarks($), prodFileHosts) }
}

async function dbCommand($: EngineInterface, args: string[], isPerson: boolean): Promise<string> {
  const [action, host] = args
  const marks = await dbMarks($)
  if (!action) {
    const { dir, targets, risky } = await judgeDb($, 'npx drizzle-kit push')
    const listed = Object.entries(marks).map(([h, m]) => `  ${m.padEnd(4)} ${h}`)
    return [
      `Databases a migration in ${dir} would reach: ${targets.join(', ') || 'none found'}`,
      risky ? `  → blocked: ${risky.host} (${risky.why})` : '  → allowed',
      listed.length ? `Marked hosts:\n${listed.join('\n')}` : 'No hosts marked yet.',
      'Mark one with /ship db safe <host> or /ship db prod <host>; /ship db forget <host> clears it.',
    ].join('\n')
  }
  if (!host || !/^(safe|prod|forget)$/.test(action)) return 'Usage: /ship db [safe|prod|forget] <host>'
  if (action !== 'prod' && !isPerson) return 'Only you, typing at the prompt, can mark a database safe or forget a mark.'
  const key = host.toLowerCase()
  const nextMarks = { ...marks }
  if (action === 'forget') delete nextMarks[key]
  else nextMarks[key] = action as HostMark
  await $.store.set(DB_MARKS_KEY, nextMarks)
  return action === 'forget' ? `Forgot ${key}.` : `Marked ${key} as ${action}.`
}

// True once session.start found an interactive session in a git repository.
let isWatching = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'ship',
      description: 'Ship cockpit: open the pane, or `/ship go` to test, PR, merge and deploy',
      argumentHint: '[go | db [safe|prod|forget] <host>]',
    })
    // Headless runs (claude -p, the SDK) keep the guard and nothing else.
    if (!e.isInteractive) return started
    void (async () => {
      if (!(await git($, 'rev-parse', '--is-inside-work-tree'))) return
      isWatching = true
      await refresh($)
      $.clock.every(60_000, () => void refresh($, false))
      $.clock.every(5 * 60_000, () => void refresh($))
      void $.ui.open({ id: PANE, title: 'Ship' })
    })()
    return started
  })

  on('command.run', { command: 'ship' }, async ($, e) => {
    const arg = e.args.trim()
    const words = arg.split(/\s+/)
    if (words[0] === 'db') return { text: await dbCommand($, words.slice(1), e.origin.kind === 'composer') }
    if (arg === 'go') {
      await $.prompt.submit({ text: SHIP_PROMPT, asUser: true })
      return { text: 'Shipping: tests → PR → merge → deploy. You will be asked before production.' }
    }
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Ship' })
    return { text: statusLine(await read($, snapshot)) }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const verdict = classify(e.command)
    if (verdict.kind === 'prod-data')
      return {
        deny: `ship-cockpit: "${verdict.segment.slice(0, 120)}" would change PRODUCTION data, which is never run from Claude. Tell the user the exact command so they can run it themselves with "! <command>" if they really mean it.`,
      }
    if (isDbMutation(e.command)) {
      const { risky } = await judgeDb($, e.command)
      if (risky)
        return {
          deny: `ship-cockpit: this command writes to the database at ${risky.host}, which is treated as PRODUCTION (${risky.why}). Do not retry or work around it. Tell the user; if that database is a dev copy they can type "/ship db safe ${risky.host}", or run the command themselves with "! <command>".`,
        }
    }
    if (verdict.kind === 'force-push-main')
      return { deny: 'ship-cockpit: force-pushing main is blocked. Push a branch and open a PR instead.' }
    if (verdict.kind === 'prod-deploy') {
      const refused = await confirmDeploy($, verdict.segment)
      if (refused)
        return { deny: `ship-cockpit: production deploy not confirmed (${refused}). Do not retry; ask the user what they want.` }
      const ran = await next(e)
      if (ran.deny === undefined && ran.isError !== true) {
        const s = await read($, snapshot)
        const entry: ShipDeploy = { at: Date.now(), command: verdict.segment.slice(0, 200), branch: s.branch ?? '?', head: s.head ?? '?' }
        const list = ((await $.store.get(DEPLOYS_KEY)) as ShipDeploy[] | undefined) ?? []
        await $.store.set(DEPLOYS_KEY, [...list, entry].slice(-20))
        $.ui.toast(`Deployed ${entry.branch}@${entry.head} to production`)
      }
      if (isWatching) void refresh($)
      return ran
    }
    const ran = await next(e)
    if (isWatching && touchesShipState(e.command)) void refresh($)
    return ran
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'ship-cockpit: its guard failed, so the command was not run.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, snapshot)
    const width = Math.max(20, e.props.bodyColumns)
    const cut = (text: string) => (text.length > width ? text.slice(0, width - 1) + '…' : text)
    if (!s.updatedAt) return <Text dimColor>Loading…</Text>
    if (!s.branch) return <Text dimColor>{s.error ?? 'No git repository here.'}</Text>
    const checkColor = s.pr?.checks === 'passing' ? 'green' : s.pr?.checks === 'failing' ? 'red' : 'yellow'
    return (
      <Box flexDirection="column">
        <Text bold>{cut(`⎇ ${s.branch} @ ${s.head}`)}</Text>
        <Text dimColor={!s.dirty && !s.ahead && !s.behind} color={s.dirty ? 'yellow' : undefined}>
          {cut(`${s.dirty} uncommitted · ↑${s.ahead} ↓${s.behind}`)}
        </Text>
        <Text> </Text>
        <Text bold>Pull request</Text>
        {s.pr ? (
          <Box flexDirection="column">
            <Text>{cut(`#${s.pr.number} ${s.pr.title}`)}</Text>
            <Text color={checkColor}>{`${s.pr.state.toLowerCase()} · checks ${s.pr.checks}`}</Text>
          </Box>
        ) : (
          <Text dimColor>none for this branch</Text>
        )}
        <Text> </Text>
        <Text bold>Production</Text>
        {s.lastDeploy ? (
          <Text>{cut(`${s.lastDeploy.branch}@${s.lastDeploy.head} · ${ago(s.lastDeploy.at)}`)}</Text>
        ) : (
          <Text dimColor>no deploy recorded yet</Text>
        )}
        <Text dimColor>guarded: asks before deploy</Text>
        <Text> </Text>
        <Text bold>Open issues</Text>
        {s.issues.length === 0 && <Text dimColor>none</Text>}
        {s.issues.map(issue => (
          <Text>{cut(`#${issue.number} ${issue.title} · ${ago(Date.parse(issue.updatedAt))}`)}</Text>
        ))}
        <Text> </Text>
        <Text dimColor>{cut(`updated ${ago(s.updatedAt)} · /ship go to ship`)}</Text>
      </Box>
    )
  })
}
