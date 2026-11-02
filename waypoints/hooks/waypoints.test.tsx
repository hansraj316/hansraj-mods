import { expect, mock, test } from 'claude-code/testing'

import { cleanName, lastReply, slug, transcriptUpTo, turnAt } from './trail'

const ANSWER = 'Plan: keep JWT for the API and move web sessions to Redis with a 7-day TTL.'

const MESSAGES = [
  { role: 'user', text: 'How should we store sessions?', toolUses: [] },
  { role: 'assistant', text: 'Let me look at the auth module.', toolUses: [{ tool: 'Read', input: { file_path: 'src/auth.ts' } }] },
  { role: 'user', text: 'Keep it simple.', toolUses: [] },
  { role: 'assistant', text: ANSWER, toolUses: [] },
  { role: 'user', text: 'Now write the migration.', toolUses: [] },
] as const

const PANE = {
  plugin: 'waypoints',
  component: 'Pane',
  requestId: 'waypoints',
  props: { title: 'Waypoints', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

/** Runs a slash command as the person would type it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function run($: any, input: { command: string; args: string }): Promise<{ text?: string }> {
  return $.command.run(input)
}

/** Stands in for the engine's session: its messages, id and store. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function session(on: any) {
  const submitted: string[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('session.messages', () => ({ value: MESSAGES }))
  on('session.id', () => ({ value: 'session-1' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '## Goal\nSessions in Redis, JWT for the API.', usage: { input_tokens: 1, output_tokens: 1 } } }))
  on('prompt.submit', (_: unknown, e: { text: string }) => {
    submitted.push(e.text)
    return { drop: 'test stands in for the engine' }
  })
  return { clock, submitted }
}

test('the model: names, the last reply, the transcript cut at a pin', () => {
  expect(slug(ANSWER, [])).toBe('plan-keep-jwt')
  expect(slug(ANSWER, ['plan-keep-jwt'])).toBe('plan-keep-jwt-2')
  expect(cleanName('  Redis Plan! ')).toBe('redis-plan')
  expect(lastReply(MESSAGES)).toBe(3)
  expect(turnAt(MESSAGES, 3)).toBe(2)
  const t = transcriptUpTo(MESSAGES, 3)
  expect(t).toMatch(/\[Read src\/auth\.ts\]/)
  expect(t).toMatch(/7-day TTL/)
  expect(t).not.toMatch(/migration/)
})

test('/pin pins the last reply, and the map shows it on every surface', async ($, on) => {
  session(on)
  const r = await run($, { command: 'pin', args: 'redis plan' })
  expect(r.text).toMatch(/pinned "redis-plan" \(turn 2\)/)
  expect((await run($, { command: 'pin', args: 'redis plan' })).text).toMatch(/redis-plan/)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /redis-plan/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /turn 2/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/fork-at saves a handoff for later, and /waypoints open starts it', async ($, on) => {
  const { clock, submitted } = session(on)
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => ({ result: { questions: e.questions, answers: { [e.questions[0]!.question]: 'Save for later' } } }))
  expect((await run($, { command: 'fork-at', args: '' })).text).toMatch(/Pin a reply first/)
  await run($, { command: 'pin', args: 'redis-plan' })
  const r = await run($, { command: 'fork-at', args: 'redis-plan' })
  expect(r.text).toMatch(/handoff for "redis-plan" saved/)
  expect(submitted.length).toBe(0)
  expect((await run($, { command: 'waypoints', args: 'list' })).text).toMatch(/redis-plan/)
  await run($, { command: 'waypoints', args: 'open redis-plan' })
  await clock.advance(100)
  expect(submitted[0]).toMatch(/continues from the waypoint "redis-plan"/)
  expect(submitted[0]).toMatch(/Sessions in Redis/)
})

test('Start it here clears the view, then sends the handoff', async ($, on) => {
  const { clock, submitted } = session(on)
  const order: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => ({ result: { questions: e.questions, answers: { [e.questions[0]!.question]: 'Start it here' } } }))
  on('command.run', { command: 'clear' }, () => {
    order.push('clear')
    return { text: '' }
  })
  await run($, { command: 'pin', args: '' })
  const r = await run($, { command: 'fork-at', args: '' })
  expect(r.text).toMatch(/starting a fork from "plan-keep-jwt"/)
  await clock.advance(100)
  expect(order).toEqual(['clear'])
  expect(submitted.length).toBe(1)
})

test('a reply in the Desktop app carries a Pin button', async ($, on) => {
  session(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>reply</Text>
  })
  const ui = await $.ui.mount({ plugin: 'waypoints', surface: 'desktop', component: 'AssistantMessage', requestId: 'm4', props: { text: ANSWER, isFirstOfReply: true } } as never)
  await ui.press({ key: 'pin-m4' })
  await ui.unmount()
  expect((await run($, { command: 'waypoints', args: '' })).text).toMatch(/1 pinned/)
})
