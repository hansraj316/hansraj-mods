/** The preset in use, by position; null when the session's own model runs. */
export type GearIndex = number | null

declare module 'claude-code' {
  interface PluginState {
    'gearbox': {
      /** The preset in use, by position; null when the session's own model runs. */
      active: GearIndex
      /** Whether the draft in the prompt box looks like a small task. */
      light: boolean
      /** Whether the preset editor is open in the band. */
      editing: boolean
      /** The 5-hour window's percent used, when the plan reports one. */
      fiveHour: number | null
    }
  }
}

