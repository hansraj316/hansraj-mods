// Fleet: pure helpers for the other projects you are shipping. The git/gh reads live in register.tsx.
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

/** Commits per day for the last 7 days, oldest first. */
export function perDay(stamps: number[], nowMs: number): number[] {
  const days = [0, 0, 0, 0, 0, 0, 0]
  for (const s of stamps) {
    const ago = Math.floor((nowMs - s * 1000) / 86_400_000)
    if (ago >= 0 && ago < 7) days[6 - ago] = (days[6 - ago] ?? 0) + 1
  }
  return days
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
