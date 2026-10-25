// Fleet: a glance at the other projects you are shipping, read with git and gh in each project's folder.
import type { EngineInterface } from 'claude-code'

import type { FleetProject } from '../types'

export const FLEET_KEY = 'fleetPaths'

export type FleetLevel = 'failing' | 'attention' | 'healthy' | 'quiet'

export const LEVEL_ORDER: Record<FleetLevel, number> = { failing: 0, attention: 1, healthy: 2, quiet: 3 }

export function expandHome(path: string, home: string): string {
  return path.replace(/^~(?=\/|$)/, home).replace(/\/+$/, '') || '/'
}

export function nameOf(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

async function run($: EngineInterface, cwd: string, argv: string[], timeoutMs = 15_000): Promise<string | undefined> {
  try {
    const ran = await $.process.run(argv, { cwd, timeoutMs })
    return ran.exitCode === 0 ? ran.stdout.trim() : undefined
  } catch {
    return undefined
  }
}

function json(text: string | undefined): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function checksOf(rollup: unknown): 'passing' | 'failing' | 'pending' | 'none' {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none'
  const states = rollup.map(c => String(c?.conclusion || c?.state || c?.status || '').toUpperCase())
  if (states.some(s => /FAIL|ERROR|CANCEL|TIMED_OUT|ACTION_REQUIRED/.test(s))) return 'failing'
  if (states.every(s => /SUCCESS|NEUTRAL|SKIPPED/.test(s))) return 'passing'
  return 'pending'
}

/** Commits per day for the last 7 days, oldest first. */
export function perDay(stamps: number[], nowMs: number): number[] {
  const days = [0, 0, 0, 0, 0, 0, 0]
  for (const s of stamps) {
    const ago = Math.floor((nowMs - s * 1000) / 86_400_000)
    if (ago >= 0 && ago < 7) days[6 - ago] = (days[6 - ago] ?? 0) + 1
  }
  return days
}

/** Reads one project: branch, local changes, last commit, newest open PR, main's CI and the first open milestone. */
export async function readProject($: EngineInterface, path: string): Promise<FleetProject> {
  const now = Date.now()
  const base: FleetProject = { path, name: nameOf(path), dirty: 0, activity: [0, 0, 0, 0, 0, 0, 0], readAt: now }
  const inside = await run($, path, ['git', 'rev-parse', '--is-inside-work-tree'])
  if (inside !== 'true') return { ...base, error: 'not a git repository' }
  const [branch, status, last, stamps, originHead] = await Promise.all([
    run($, path, ['git', 'branch', '--show-current']),
    run($, path, ['git', 'status', '--porcelain']),
    run($, path, ['git', 'log', '-1', '--format=%ct%x1f%s']),
    run($, path, ['git', 'log', '--since=7.days', '--format=%ct']),
    run($, path, ['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']),
  ])
  const [lastAt, lastSubject] = (last ?? '').split('\x1f')
  const mainBranch = originHead?.replace(/^origin\//, '') || 'main'
  const [prRaw, runRaw, msRaw] = await Promise.all([
    run($, path, ['gh', 'pr', 'list', '--state', 'open', '--limit', '1', '--json', 'number,title,statusCheckRollup,updatedAt']),
    run($, path, ['gh', 'run', 'list', '--branch', mainBranch, '--limit', '1', '--json', 'conclusion,status,displayTitle,updatedAt']),
    run($, path, ['gh', 'api', 'repos/{owner}/{repo}/milestones?state=open&sort=due_on&per_page=1']),
  ])
  const prs = json(prRaw) as { number: number; title: string; statusCheckRollup: unknown; updatedAt: string }[] | undefined
  const runs = json(runRaw) as { conclusion: string; status: string; displayTitle: string; updatedAt: string }[] | undefined
  const milestones = json(msRaw) as { title: string; open_issues: number; closed_issues: number }[] | undefined
  const pr = prs?.[0]
  const ci = runs?.[0]
  const ms = milestones?.[0]
  const msTotal = ms ? ms.open_issues + ms.closed_issues : 0
  return {
    ...base,
    branch: branch || undefined,
    dirty: status ? status.split('\n').length : 0,
    lastCommit: lastAt ? { at: Number(lastAt) * 1000, subject: lastSubject ?? '' } : undefined,
    pr: pr ? { number: pr.number, title: pr.title, checks: checksOf(pr.statusCheckRollup), updatedAt: Date.parse(pr.updatedAt) || now } : undefined,
    mainCi: ci
      ? {
          branch: mainBranch,
          state: ci.status !== 'completed' ? 'running' : /success|neutral|skipped/i.test(ci.conclusion) ? 'passing' : 'failing',
          title: ci.displayTitle,
        }
      : undefined,
    milestone: ms && msTotal > 0 ? { title: ms.title, percent: Math.round((ms.closed_issues / msTotal) * 100) } : undefined,
    activity: perDay((stamps ?? '').split('\n').filter(Boolean).map(Number), now),
  }
}

export function levelOf(p: FleetProject): FleetLevel {
  if (p.error) return 'quiet'
  if (p.mainCi?.state === 'failing' || p.pr?.checks === 'failing') return 'failing'
  if (p.pr?.checks === 'pending' || p.mainCi?.state === 'running' || p.dirty > 0) return 'attention'
  if (p.mainCi || p.pr) return 'healthy'
  return 'quiet'
}

export const LEVEL_WORD: Record<FleetLevel, string> = { failing: 'Failing', attention: 'Needs you', healthy: 'Healthy', quiet: 'Quiet' }

/** The one line a project contributes to the ticker, most urgent news first. */
export function eventOf(p: FleetProject): { text: string; at?: number } {
  if (p.error) return { text: p.error }
  if (p.mainCi?.state === 'failing') return { text: `${p.mainCi.branch} failing · ${p.mainCi.title}` }
  if (p.pr?.checks === 'failing') return { text: `PR #${p.pr.number} checks failing`, at: p.pr.updatedAt }
  if (p.pr?.checks === 'pending') return { text: `PR #${p.pr.number} checks running`, at: p.pr.updatedAt }
  if (p.pr?.checks === 'passing') return { text: `PR #${p.pr.number} ready to merge · ${p.pr.title}`, at: p.pr.updatedAt }
  if (p.dirty > 0) return { text: `${p.dirty} uncommitted on ${p.branch ?? 'a branch'}` }
  if (p.mainCi?.state === 'running') return { text: `${p.mainCi.branch} CI running` }
  if (p.lastCommit) return { text: p.lastCommit.subject, at: p.lastCommit.at }
  return { text: 'no commits yet' }
}

export function sortFleet(list: readonly FleetProject[]): FleetProject[] {
  return [...list].sort((a, z) => LEVEL_ORDER[levelOf(a)] - LEVEL_ORDER[levelOf(z)] || a.name.localeCompare(z.name))
}

export async function fleetPaths($: EngineInterface): Promise<string[]> {
  const stored = (await $.store.get(FLEET_KEY)) as string[] | undefined
  return Array.isArray(stored) ? stored.filter(p => typeof p === 'string') : []
}
