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

declare module 'claude-code' {
  interface PluginState {
    'ship-cockpit': { snapshot: ShipSnapshot }
  }
}
