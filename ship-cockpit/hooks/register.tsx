import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FleetProject, ShipDeploy, ShipPr, ShipSnapshot, ShipTab } from '../types'
import { cdTarget, envFilesIn, hostsIn, isDbMutation, isProdEnvFile, riskyHost } from './db'
import type { HostMark, HostVerdict } from './db'
import { C, T, checksColor, checksPercent, dotSvg, progressSvg, ringSvg, sparkSvg } from './draw'
import { FLEET_KEY, LEVEL_WORD, eventOf, expandHome, fleetPaths, levelOf, nameOf, readProject, sortFleet } from './fleet'
import type { FleetLevel } from './fleet'
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
const fleet = atom({ plugin: 'ship-cockpit', key: 'fleet' } as const, [] as FleetProject[], { shape: 'fleet-1' })
const tab = atom({ plugin: 'ship-cockpit', key: 'tab' } as const, 'ship' as ShipTab)
const tickerIndex = atom({ plugin: 'ship-cockpit', key: 'tickerIndex' } as const, 0)
const tickerPaused = atom({ plugin: 'ship-cockpit', key: 'tickerPaused' } as const, false)

const LEVEL_COLOR: Record<FleetLevel, { fill: string; text: string; term: string }> = {
  failing: { fill: C.red, text: T.red, term: 'error' },
  attention: { fill: C.amber, text: T.amber, term: 'warning' },
  healthy: { fill: C.green, text: T.green, term: 'success' },
  quiet: { fill: C.blue, text: T.blue, term: 'subtle' },
}

/** Re-reads every project on the fleet list, a few at a time. */
async function refreshFleet($: EngineInterface): Promise<void> {
  const paths = await fleetPaths($)
  const out: FleetProject[] = []
  for (let i = 0; i < paths.length; i += 3) {
    const batch = await Promise.all(paths.slice(i, i + 3).map(p => readProject($, p)))
    out.push(...batch)
  }
  await update($, fleet, () => out)
}

async function fleetCommand($: EngineInterface, args: string[], isPerson: boolean): Promise<string> {
  const [action, ...rest] = args
  if ((action === 'add' || action === 'remove') && !isPerson) return 'Only you, typing at the prompt, can add or remove fleet projects.'
  const paths = await fleetPaths($)
  const home = (await $.env.get('HOME')) ?? ''
  if (action === 'add') {
    const raw = rest.join(' ').trim() || (await $.session.cwd())
    const cwd = await $.session.cwd()
    const path = expandHome(raw.startsWith('/') || raw.startsWith('~') ? raw : `${cwd}/${raw}`, home)
    if (paths.includes(path)) return `${nameOf(path)} is already on the fleet.`
    const next = [...paths, path].slice(0, 12)
    await $.store.set(FLEET_KEY, next)
    void refreshFleet($)
    return `Added ${nameOf(path)} to the fleet (${next.length} project${next.length === 1 ? '' : 's'}).`
  }
  if (action === 'remove') {
    const target = rest.join(' ').trim()
    const next = paths.filter(p => p !== expandHome(target, home) && nameOf(p) !== target)
    if (next.length === paths.length) return `No fleet project matches "${target}".`
    await $.store.set(FLEET_KEY, next)
    await update($, fleet, list => list.filter(p => next.includes(p.path)))
    return `Removed ${target} from the fleet.`
  }
  await update($, tab, () => 'fleet' as ShipTab)
  await $.ui.open({ id: PANE, title: 'Ship' })
  void refreshFleet($)
  if (paths.length === 0) return 'The fleet is empty. Add a project with /ship fleet add <path> (or no path for this folder).'
  return `Fleet: ${paths.map(nameOf).join(', ')}`
}

async function shipWithConfirm($: EngineInterface): Promise<void> {
  let answer = 'Cancel'
  try {
    answer = await $.ui.ask('Ship the current work? Claude will test, commit, open a PR, merge when checks pass, and ask you before deploying to production.', {
      header: 'Ship',
      options: ['Cancel', 'Ship it'],
    })
  } catch {
    return
  }
  if (answer === 'Ship it') await $.prompt.submit({ text: SHIP_PROMPT, asUser: true })
}

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
    const listed = Object.entries(marks).map(([name, mark]) => `  ${mark.padEnd(4)} ${name}`)
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
      description: 'Ship cockpit: open the pane, `/ship go` to test, PR, merge and deploy, `/ship fleet` for your other projects',
      argumentHint: '[go | fleet [add|remove] <path> | db [safe|prod|forget] <host>]',
    })
    // Headless runs (claude -p, the SDK) keep the guard and nothing else.
    if (!e.isInteractive) return started
    // Fleet: your other projects, read every 3 minutes; the ticker turns every 5 seconds.
    void (async () => {
      if ((await fleetPaths($)).length === 0) return
      await refreshFleet($)
    })()
    $.clock.every(3 * 60_000, () => void refreshFleet($))
    $.clock.every(5000, () => {
      void (async () => {
        const count = (await read($, fleet)).length
        if (count > 1 && !(await read($, tickerPaused))) await update($, tickerIndex, i => (i + 1) % count)
      })()
    })
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
    if (words[0] === 'db') return { text: await dbCommand($, words.slice(1), e.origin?.kind === 'composer') }
    if (words[0] === 'fleet') return { text: await fleetCommand($, words.slice(1), e.origin?.kind === 'composer') }
    if (arg === 'go') {
      await $.prompt.submit({ text: SHIP_PROMPT, asUser: true })
      return { text: 'Shipping: tests → PR → merge → deploy. You will be asked before production.' }
    }
    await refresh($)
    await update($, tab, () => 'ship' as ShipTab)
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = await read($, tab)
    const tabs = (
      <Box flexDirection="row" gap="xs">
        <Button key="tab-ship" label="Ship" variant={current === 'ship' ? 'primary' : 'secondary'} onPress={() => update($, tab, () => 'ship' as ShipTab)} />
        <Button
          key="tab-fleet"
          label="Fleet"
          variant={current === 'fleet' ? 'primary' : 'secondary'}
          onPress={async () => {
            await update($, tab, () => 'fleet' as ShipTab)
            void refreshFleet($)
          }}
        />
      </Box>
    )
    const width = Math.max(20, e.props.bodyColumns)
    const cut = (text: string) => (text.length > width ? text.slice(0, width - 1) + '…' : text)

    if (current === 'fleet') {
      const list = sortFleet(await read($, fleet))
      const count = (l: FleetLevel) => list.filter(p => levelOf(p) === l).length
      if (e.surface === 'terminal') {
        return (
          <Box flexDirection="column">
            {tabs}
            {list.length === 0 && <Text dimColor>No projects yet. /ship fleet add &lt;path&gt;</Text>}
            {list.map(p => {
              const level = levelOf(p)
              const ev = eventOf(p)
              return (
                <Box flexDirection="column">
                  <Text bold color={LEVEL_COLOR[level].term}>{cut(`● ${p.name} · ${LEVEL_WORD[level]}`)}</Text>
                  <Text dimColor>{cut(`  ${ev.text}${ev.at ? ` · ${ago(ev.at)}` : ''}${p.milestone ? ` · ${p.milestone.title} ${p.milestone.percent}%` : ''}`)}</Text>
                </Box>
              )
            })}
          </Box>
        )
      }
      const { Svg } = $.ui.resolve(e)
      const barW = Math.max(120, Math.min(300, width * 7))
      return (
        <Box flexDirection="column" gap="md">
          {tabs}
          <Box flexDirection="row" gap="lg">
            {(['failing', 'attention', 'healthy'] as FleetLevel[]).map(l => (
              <Box flexDirection="column">
                <Text size="heading" weight="semibold" tabular color={LEVEL_COLOR[l].text}>
                  {String(count(l))}
                </Text>
                <Text size="caption" dimColor>
                  {LEVEL_WORD[l]}
                </Text>
              </Box>
            ))}
          </Box>
          {list.length === 0 && <Text dimColor>No projects yet. Type /ship fleet add followed by a folder, or no folder for this one.</Text>}
          {list.map(p => {
            const level = levelOf(p)
            const ev = eventOf(p)
            return (
              <Box key={`p-${p.path}`} flexDirection="column" gap="xs" paddingY="xs">
                <Box flexDirection="row" alignItems="center" gap="sm">
                  <Svg source={dotSvg(LEVEL_COLOR[level].fill)} alt="" width={8} height={8} />
                  <Text weight="semibold" wrap="truncate">{p.name}</Text>
                  <Box flexGrow={1} />
                  <Text size="footnote" weight="semibold" color={LEVEL_COLOR[level].text}>
                    {LEVEL_WORD[level]}
                  </Text>
                </Box>
                <Text size="footnote" wrap="truncate">{ev.text}</Text>
                {p.milestone && (
                  <Box flexDirection="row" alignItems="center" gap="sm">
                    <Svg source={progressSvg(p.milestone.percent, LEVEL_COLOR[level].fill, barW)} alt={`${p.milestone.title} ${p.milestone.percent}% done`} width={barW} height={6} />
                    <Text size="footnote" dimColor tabular>{`${p.milestone.percent}%`}</Text>
                  </Box>
                )}
                <Box flexDirection="row" alignItems="center" gap="sm">
                  <Text size="footnote" dimColor wrap="truncate">{p.milestone?.title ?? p.branch ?? ''}</Text>
                  <Box flexGrow={1} />
                  <Svg source={sparkSvg(p.activity)} alt={`Commits in the last 7 days: ${p.activity.join(', ')}`} width={34} height={14} />
                  <Text size="footnote" dimColor>{ev.at ? ago(ev.at) : ''}</Text>
                </Box>
              </Box>
            )
          })}
          <Text size="footnote" dimColor>From git and GitHub every 3 minutes · /ship fleet add or remove</Text>
        </Box>
      )
    }

    const s = await read($, snapshot)
    if (!s.updatedAt) return <Box flexDirection="column">{tabs}<Text dimColor>Loading…</Text></Box>
    if (!s.branch) return <Box flexDirection="column">{tabs}<Text dimColor>{s.error ?? 'No git repository here.'}</Text></Box>

    if (e.surface === 'terminal') {
      const checkColor = s.pr?.checks === 'passing' ? 'green' : s.pr?.checks === 'failing' ? 'red' : 'yellow'
      return (
        <Box flexDirection="column">
          {tabs}
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
    }

    const { Svg } = $.ui.resolve(e)
    const checks = checksColor(s.pr?.checks)
    return (
      <Box flexDirection="column" gap="md">
        {tabs}
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" alignItems="center">
            <Text size="caption" weight="semibold" dimColor>
              BRANCH
            </Text>
            <Box flexGrow={1} />
            <Text size="footnote" mono dimColor>{`HEAD ${s.head ?? ''}`}</Text>
          </Box>
          <Text mono weight="semibold" wrap="truncate">{s.branch}</Text>
          <Box flexDirection="row" gap="sm" flexWrap="wrap">
            <Text size="footnote" weight="semibold" color={s.dirty ? T.amber : T.gray}>{`${s.dirty} uncommitted`}</Text>
            <Text size="footnote" dimColor>{`${s.ahead} ahead`}</Text>
            <Text size="footnote" dimColor>{`${s.behind} behind`}</Text>
          </Box>
        </Box>
        <Box flexDirection="row" alignItems="center" gap="sm">
          <Svg source={ringSvg(checksPercent(s.pr?.checks), checks.fill)} alt={s.pr ? `Checks ${s.pr.checks}` : 'No pull request'} width={36} height={36} />
          <Box flexDirection="column" flexGrow={1}>
            <Text size="caption" weight="semibold" dimColor>
              PULL REQUEST
            </Text>
            <Text weight="semibold" wrap="truncate">{s.pr ? `#${s.pr.number} ${s.pr.title}` : 'None for this branch'}</Text>
          </Box>
          {s.pr && (
            <Text size="footnote" weight="semibold" color={checks.text}>
              {s.pr.checks === 'passing' ? 'All passed' : s.pr.checks === 'failing' ? 'Failing' : s.pr.checks === 'pending' ? 'Running' : 'No checks'}
            </Text>
          )}
        </Box>
        <Box flexDirection="row" alignItems="center" gap="sm">
          <Svg source={dotSvg(s.lastDeploy ? C.green : C.gray, 10)} alt="" width={10} height={10} />
          <Box flexDirection="column" flexGrow={1}>
            <Text size="caption" weight="semibold" dimColor>
              LAST PRODUCTION DEPLOY
            </Text>
            <Text size="footnote" wrap="truncate">{s.lastDeploy ? `${s.lastDeploy.branch}@${s.lastDeploy.head} · ${ago(s.lastDeploy.at)}` : 'None recorded yet · asks before every deploy'}</Text>
          </Box>
        </Box>
        <Box flexDirection="column" gap="xs">
          <Text size="caption" weight="semibold" dimColor>
            OPEN ISSUES
          </Text>
          {s.issues.length === 0 && <Text size="footnote" dimColor>None open</Text>}
          {s.issues.map(issue => (
            <Box flexDirection="row" gap="sm">
              <Text size="footnote" dimColor tabular>{`#${issue.number}`}</Text>
              <Text size="footnote" wrap="truncate">{issue.title}</Text>
              <Box flexGrow={1} />
              <Text size="footnote" dimColor>{ago(Date.parse(issue.updatedAt))}</Text>
            </Box>
          ))}
        </Box>
        <Box flexDirection="row" gap="sm" alignItems="center">
          <Text size="footnote" dimColor>{`Updated ${ago(s.updatedAt)}`}</Text>
          <Box flexGrow={1} />
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
          <Button key="ship-it" variant="primary" label="Ship it" onPress={() => shipWithConfirm($)} />
        </Box>
      </Box>
    )
  })

  // Fleet ticker: one line above the prompt that turns through your other projects. Click to pause.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const list = sortFleet(await read($, fleet))
    if (list.length === 0) return below
    const paused = await read($, tickerPaused)
    const p = list[(await read($, tickerIndex)) % list.length] ?? list[0]
    if (!p) return below
    const level = levelOf(p)
    const ev = eventOf(p)
    const { Box, Text, Button } = $.ui.resolve(e)
    const toggle = () => update($, tickerPaused, x => !x)
    const open = async () => {
      await update($, tab, () => 'fleet' as ShipTab)
      await $.ui.open({ id: PANE, title: 'Ship' })
    }
    const when = ev.at ? ` · ${ago(ev.at)}` : ''

    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text color={paused ? 'subtle' : 'success'}>{paused ? 'paused' : 'live'}</Text>
            <Text color={LEVEL_COLOR[level].term}>●</Text>
            <Text bold>{p.name}</Text>
            <Text dimColor wrap="truncate">{`${ev.text}${when}`}</Text>
            <Button key="ticker" label={paused ? 'Resume' : 'Pause'} onPress={toggle} />
          </Box>
          {below}
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap="xs">
        <Box key="fleet-ticker" flexDirection="row" alignItems="center" gap="sm">
          <Svg source={dotSvg(paused ? C.gray : C.green, 6)} alt="" width={6} height={6} />
          <Text size="caption" weight="bold" color={paused ? T.gray : T.green}>
            {paused ? 'PAUSED' : 'LIVE'}
          </Text>
          <Svg source={dotSvg(LEVEL_COLOR[level].fill)} alt={LEVEL_WORD[level]} width={8} height={8} />
          <Button key="ticker" plain label={p.name} onPress={open} />
          <Text dimColor wrap="truncate">{`${ev.text}${when}`}</Text>
          <Box flexGrow={1} />
          <Text size="caption" dimColor tabular>{`${(list.indexOf(p) + 1)}/${list.length}`}</Text>
          <Button key="ticker-pause" plain dimColor label={paused ? 'Resume' : 'Pause'} onPress={toggle} />
        </Box>
        {below}
      </Box>
    )
  })
}
