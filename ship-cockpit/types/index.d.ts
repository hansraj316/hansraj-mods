export type ShipPr = {
  number: number
  title: string
  state: string
  checks: 'passing' | 'failing' | 'pending' | 'none'
}

export type ShipIssue = { number: number; title: string; updatedAt: string }

export type ShipDeploy = { at: number; command: string; branch: string; head: string }

export type ShipSnapshot = {
  updatedAt: number
  branch?: string
  head?: string
  dirty: number
  ahead: number
  behind: number
  pr?: ShipPr
  issues: ShipIssue[]
  lastDeploy?: ShipDeploy
  error?: string
}

export type FleetProject = {
  path: string
  name: string
  branch?: string
  dirty: number
  lastCommit?: { at: number; subject: string }
  pr?: { number: number; title: string; checks: ShipPr['checks']; updatedAt: number }
  mainCi?: { branch: string; state: 'passing' | 'failing' | 'running'; title: string }
  milestone?: { title: string; percent: number }
  /** Commits per day over the last 7 days, oldest first. */
  activity: number[]
  readAt: number
  error?: string
}

export type ShipTab = 'ship' | 'fleet'

declare module 'claude-code' {
  interface PluginState {
    'ship-cockpit': {
      snapshot: ShipSnapshot
      fleet: Shaped<FleetProject[]>
      tab: ShipTab
      tickerIndex: number
      tickerPaused: boolean
    }
  }
}
