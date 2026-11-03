import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Fork, Waypoint } from '../types'
import {
  HANDOFF_SYSTEM,
  cleanName,
  excerpt,
  fallbackHandoff,
  forkOpening,
  handoffPrompt,
  lastReply,
  replyHolding,
  slug,
  transcriptUpTo,
  turnAt,
} from './trail'
import type { Message } from './trail'

const PANE = 'waypoints'
const STORE_FORKS = 'forks'
const START = 'Start it here'
const LATER = 'Save for later'

const pins = atom({ plugin: 'waypoints', key: 'pins' } as const, [] as Waypoint[], { shape: 'pins-1' })
const forks = atom({ plugin: 'waypoints', key: 'forks' } as const, [] as Fork[], { shape: 'forks-1' })
const busy = atom({ plugin: 'waypoints', key: 'busy' } as const, '')

function isForkList(v: unknown): v is Fork[] {
  return Array.isArray(v) && v.every(f => typeof f === 'object' && f !== null && typeof (f as Fork).waypoint === 'string' && typeof (f as Fork).handoff === 'string')
}

function isPinList(v: unknown): v is Waypoint[] {
  return Array.isArray(v) && v.every(p => typeof p === 'object' && p !== null && typeof (p as Waypoint).name === 'string' && typeof (p as Waypoint).index === 'number')
}

async function sessionKey($: EngineInterface): Promise<string> {
  return `pins:${await $.session.id()}`
}

/** Keeps a value across sessions; the session's own state still holds it if the store refuses. */
async function keep($: EngineInterface, key: string, value: unknown): Promise<void> {
  try {
    await $.store.set(key, value)
  } catch {
    // Best effort: the waypoint still works for this session.
  }
}

async function messages($: EngineInterface): Promise<Message[]> {
  return (await $.session.messages()) as unknown as Message[]
}

/** Pins the reply at `index` (the last reply when -1), under `name` or one made from its words. */
async function pin($: EngineInterface, index: number, name?: string): Promise<Waypoint | string> {
  const all = await messages($)
  const at = index >= 0 ? index : lastReply(all)
  const reply = all[at]
  if (!reply) return 'There is no reply to pin yet.'
  const list = await read($, pins)
  const existing = list.find(p => p.index === at)
  if (existing) return existing
  const taken = list.map(p => p.name)
  const wanted = name ? cleanName(name) : ''
  if (wanted && taken.includes(wanted)) return `A waypoint called "${wanted}" exists already. Pick another name.`
  const wp: Waypoint = {
    name: wanted || slug(reply.text, taken),
    index: at,
    turn: turnAt(all, at),
    excerpt: excerpt(reply.text),
    at: await $.clock.now(),
  }
  const next = [...list, wp].sort((a, z) => a.index - z.index)
  await update($, pins, () => next)
  await keep($, await sessionKey($), next)
  return wp
}

/** Writes the handoff for a waypoint and records the fork. */
async function writeFork($: EngineInterface, wp: Waypoint): Promise<Fork> {
  await update($, busy, () => wp.name)
  try {
    const all = await messages($)
    let handoff: string
    try {
      const r = await $.model.complete({ model: 'sonnet', system: HANDOFF_SYSTEM, prompt: handoffPrompt(transcriptUpTo(all, wp.index), wp), maxTokens: 2000 })
      handoff = r.isAnswered && r.text.trim() ? r.text : fallbackHandoff(all, wp.index)
    } catch {
      handoff = fallbackHandoff(all, wp.index)
    }
    const fork: Fork = { waypoint: wp.name, fromSession: await $.session.id(), handoff, at: await $.clock.now(), isOpened: false }
    const list = [...(await read($, forks)).filter(f => f.waypoint !== wp.name), fork]
    await update($, forks, () => list)
    await keep($, STORE_FORKS, list)
    return fork
  } finally {
    await update($, busy, () => '')
  }
}

/** Sends a saved fork's handoff as the first message here, and marks it started. */
async function openFork($: EngineInterface, f: Fork): Promise<void> {
  const list = (await read($, forks)).map(x => (x.waypoint === f.waypoint ? { ...x, isOpened: true } : x))
  await update($, forks, () => list)
  await keep($, STORE_FORKS, list)
  await $.prompt.submit({ text: forkOpening(f), asUser: true })
}

/**
 * Starts a fork in this window: clears the view, then sends the handoff as the
 * first message. A command hook may neither run another command nor submit a
 * prompt while it holds the turn, so this runs just after the command returns.
 */
function startFork($: EngineInterface, fork: Fork): void {
  $.clock.after(50, () => {
    void (async () => {
      try {
        await $.command.run({ command: 'clear', args: '' })
      } catch {
        $.ui.toast(`The handoff for "${fork.waypoint}" is saved. Run /clear, then /waypoints open ${fork.waypoint}.`, { timeoutMs: 10_000 })
        return
      }
      await openFork($, fork)
    })()
  })
}

/** Forks from a waypoint: writes the handoff, then asks whether to start it now. */
async function fork($: EngineInterface, name: string): Promise<string> {
  const list = await read($, pins)
  const wp = name ? list.find(p => p.name === cleanName(name)) : list[list.length - 1]
  if (!wp) return list.length ? `No waypoint called "${name}". Yours: ${list.map(p => p.name).join(', ')}.` : 'Pin a reply first: /pin, or the Pin button on a reply.'
  const f = await writeFork($, wp)
  let answer = LATER
  try {
    answer = await $.ui.ask(`Start a fork from "${wp.name}" now? This view clears and the handoff is sent as the first message. This conversation stays in /resume.`, {
      header: 'Fork',
      options: [START, LATER],
    })
  } catch {
    answer = LATER
  }
  if (answer === START) {
    startFork($, f)
    return `Waypoints: starting a fork from "${wp.name}". The earlier conversation stays in /resume.`
  }
  return `Waypoints: handoff for "${wp.name}" saved. In any session, /waypoints open ${wp.name} starts it.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'pin', description: 'Waypoints: pin the last reply (`/pin name` to name it)', argumentHint: '[name]' })
    await $.command.register({ name: 'fork-at', description: 'Waypoints: start a new line of work from a waypoint (the latest when no name)', argumentHint: '[name]' })
    await $.command.register({ name: 'waypoints', description: 'Waypoints: open the map, or `/waypoints open name` to start a saved fork, `/waypoints list`', argumentHint: '[open name | list]' })
    try {
      const saved = await $.store.get(await sessionKey($))
      if (isPinList(saved) && (await read($, pins)).length === 0) await update($, pins, () => saved)
      const f = await $.store.get(STORE_FORKS)
      if (isForkList(f)) await update($, forks, () => f)
    } catch {
      // Nothing kept yet.
    }
    return started
  })

  // A clear starts a new conversation: this one's pins stay with it in the store.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') await update($, pins, () => [])
    return next(e)
  })

  on('command.run', { command: 'pin' }, async ($, e) => {
    const r = await pin($, -1, e.args.trim() || undefined)
    return { text: typeof r === 'string' ? `Waypoints: ${r}` : `Waypoints: pinned "${r.name}" (turn ${r.turn}).` }
  })

  on('command.run', { command: 'fork-at' }, async ($, e) => ({ text: await fork($, e.args.trim()) }))

  on('command.run', { command: 'waypoints' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    if (verb === 'list') {
      const list = await read($, forks)
      return { text: list.length ? `Saved forks: ${list.map(f => f.waypoint + (f.isOpened ? ' (started)' : '')).join(', ')}.` : 'No saved forks yet.' }
    }
    if (verb === 'open') {
      const name = cleanName(rest.join(' '))
      const f = (await read($, forks)).find(x => x.waypoint === name)
      if (!f) return { text: `Waypoints: no saved fork called "${name}". /waypoints list shows them.` }
      // Submitted just after this command returns: a command hook cannot start a turn.
      $.clock.after(50, () => void openFork($, f))
      return { text: `Waypoints: opened the fork from "${name}".` }
    }
    await $.ui.open({ id: PANE, title: 'Waypoints' })
    const n = (await read($, pins)).length
    return { text: n ? `Waypoints: ${n} pinned in this session.` : 'Waypoints: nothing pinned yet. /pin pins the last reply.' }
  })

  // A Pin button that shows when the pointer is over a reply, in the Desktop app.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.surface !== 'desktop' || !e.props.isFirstOfReply || e.props.isSummary) return drawn
    const { Box, Button } = $.ui.resolve(e)
    const text = e.props.text
    const isPinned = (await read($, pins)).some(p => text.includes(p.excerpt.replace(/…$/, '').slice(0, 40)))
    return (
      <Box key={`reply-${e.requestId}`} position="relative" flexDirection="column">
        {drawn}
        <Box position="absolute" top={0} right={0} display={isPinned ? 'flex' : 'none'} hover={{ display: 'flex' }}>
          <Button
            key={`pin-${e.requestId}`}
            plain
            dimColor={!isPinned}
            label={isPinned ? 'Pinned' : 'Pin'}
            onPress={async () => {
              const r = await pin($, replyHolding(await messages($), text))
              $.ui.toast(typeof r === 'string' ? r : `Pinned "${r.name}". /fork-at ${r.name} starts a new line of work from here.`)
            }}
          />
        </Box>
      </Box>
    )
  })

  // The map: the session as a line, its waypoints on it, forks branching off.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, pins)
    const saved = await read($, forks)
    const working = await read($, busy)
    if (!list.length && !saved.length)
      return (
        <Box flexDirection="column" gap="sm">
          <Text>No waypoints yet.</Text>
          <Text dimColor>Pin a reply where a decision landed: the Pin button on a reply, or /pin. Then /fork-at starts a new line of work from there.</Text>
          <Button key="pin-last" label="Pin the last reply" onPress={() => pin($, -1)} />
        </Box>
      )
    const isText = e.surface === 'terminal'
    return (
      <Box flexDirection="column" gap="sm">
        {list.map(p => {
          const f = saved.find(x => x.waypoint === p.name)
          return (
            <Box key={`wp-${p.name}`} flexDirection="column" gap="xs">
              <Box flexDirection="row" gap="sm" alignItems="center">
                <Text color="#FF9F0A">{isText ? '●' : '●'}</Text>
                <Text weight="semibold">{p.name}</Text>
                <Text dimColor>{`turn ${p.turn}`}</Text>
                <Box flexGrow={1} />
                <Button
                  key={`fork-${p.name}`}
                  label={working === p.name ? 'Writing handoff…' : 'Fork'}
                  onPress={async () => {
                    if (await read($, busy)) return
                    $.ui.toast(await fork($, p.name))
                  }}
                />
              </Box>
              <Text dimColor wrap="truncate">{`│ ${p.excerpt}`}</Text>
              {f && <Text color="#40C8E0">{`└─ ${f.isOpened ? 'fork started' : 'fork saved'} · /waypoints open ${p.name}`}</Text>}
            </Box>
          )
        })}
        {saved.filter(f => !list.some(p => p.name === f.waypoint)).length > 0 && (
          <Box flexDirection="column" gap="xs">
            <Text dimColor>From other sessions</Text>
            {saved
              .filter(f => !list.some(p => p.name === f.waypoint))
              .map(f => (
                <Box key={`saved-${f.waypoint}`} flexDirection="row" gap="sm" alignItems="center">
                  <Text color="#40C8E0">○</Text>
                  <Text>{f.waypoint}</Text>
                  <Box flexGrow={1} />
                  <Button
                    key={`open-${f.waypoint}`}
                    label="Open here"
                    onPress={() => openFork($, f)}
                  />
                </Box>
              ))}
          </Box>
        )}
      </Box>
    )
  })
}
