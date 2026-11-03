/** A pinned reply in this session. */
export type Waypoint = {
  name: string
  /** Position of the pinned reply in the session's messages. */
  index: number
  /** The turn number it came in, counting the person's messages. */
  turn: number
  excerpt: string
  /** Clock ms when it was pinned. */
  at: number
}

/** A fork started, or saved for later, from a waypoint. Kept across sessions. */
export type Fork = {
  /** The waypoint's name; one fork per waypoint name, the newest kept. */
  waypoint: string
  /** The session the waypoint is in. */
  fromSession: string
  handoff: string
  at: number
  /** True once a session has opened it. */
  isOpened: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'waypoints': {
      pins: Shaped<Waypoint[]>
      forks: Shaped<Fork[]>
      /** The waypoint a handoff is being written for, while it is. */
      busy: string
    }
  }
}
