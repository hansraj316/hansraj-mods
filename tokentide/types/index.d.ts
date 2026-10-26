export type HaloLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type HaloUsage = {
  /** Input tokens of the last reply, cached and uncached together. */
  tokens?: number
  /** The model's context window in tokens. */
  window: number
  /** tokens over window, 0 to 100. */
  percent?: number
  limits: HaloLimit[]
  at: number
}

export type HaloSlice = { name: string; tokens: number }

export type HaloBreakdown = {
  slices: HaloSlice[]
  /** Where auto-compact runs, as a percentage of the window. */
  compactAt?: number
}

export type HaloCache = {
  /** When the last main-thread reply finished, in clock milliseconds; 0 before one. */
  lastAt: number
  /** Share of the last reply's input the prompt cache served, 0 to 100. */
  hitRate?: number
}

export type HaloTab = 'now' | 'turns'

declare module 'claude-code' {
  interface PluginState {
    'tokentide': {
      usage: Shaped<HaloUsage>
      growth: Shaped<number[]>
      breakdown: Shaped<HaloBreakdown>
      cache: Shaped<HaloCache>
      expanded: boolean
      tab: HaloTab
      now: number
      alerted: number
    }
  }
}
