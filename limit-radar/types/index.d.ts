/** One rate-limit window as the engine reports it. */
export type RadarLimit = { kind: string; percentUsed: number; resetsAt?: string }

/** One reading of the 5-hour window: clock ms and percent used. */
export type RadarSample = { t: number; pct: number }

/** The readings of the current 5-hour window, keyed by when it resets. */
export type RadarLog = { resetsAt: string; samples: RadarSample[] }

/** What the mod keeps about the calendar month (UTC). */
export type RadarMonth = {
  /** "2026-11" */
  month: string
  /** Days ("2026-11-02") on which a 5-hour or weekly window reached 100%. */
  hitDays: string[]
  /** The highest weekly percent seen this month. */
  weekPeak: number
}

/** The latest readings of every window, and when they came. */
export type RadarNow = { limits: RadarLimit[]; at: number }

declare module 'claude-code' {
  interface PluginState {
    'limit-radar': {
      latest: Shaped<RadarNow>
      five: Shaped<RadarLog>
      month: Shaped<RadarMonth>
      /** The resetsAt of the window already warned about, so the band warns once. */
      warned: string
      /** Whether the person closed the band for this window. */
      dismissed: string
      tick: number
    }
  }
}
