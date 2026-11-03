import { expect, test } from 'claude-code/testing'

import { gearsFrom, isLight, label, lighterGear } from './model'

/** Runs a slash command as the person would type it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function run($: any, input: { command: string; args: string }): Promise<{ text?: string }> {
  return $.command.run(input)
}

const BAND = {
  plugin: 'gearbox',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const

/** Reads a step's stream to its end, the way the engine does. */
async function drain<C>(stream: AsyncIterable<C>): Promise<void> {
  for await (const _ of stream) void _
}

test('the model: presets from settings, labels, light drafts, lighter presets', () => {
  const gears = gearsFrom({})
  expect(gears.map(label)).toEqual(['Opus · high', 'Sonnet · med', 'Haiku · low'])
  const custom = gearsFrom({ gear2Effort: 'high', gear3Model: 'sonnet', gear1Model: 'nonsense' })
  expect(custom.map(label)).toEqual(['Opus · high', 'Sonnet · high', 'Sonnet · low'])

  expect(isLight('Rename userId to accountId')).toBe(true)
  expect(isLight('what does this regex match?')).toBe(true)
  expect(isLight('Refactor the auth module across every service')).toBe(false)
  expect(isLight('rename')).toBe(false)
  expect(isLight('/gear 2')).toBe(false)

  // From Opus (or the session model) a small task is offered Sonnet, not Haiku.
  expect(lighterGear(gears, 0)).toBe(1)
  expect(lighterGear(gears, null)).toBe(1)
  // From Sonnet the only lighter one is Haiku.
  expect(lighterGear(gears, 1)).toBe(2)
  expect(lighterGear(gears, 2)).toBe(null)
})

test('/gear 2 sends the main thread in Sonnet at medium, and subagents as they were', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  const sent: { model: string; effort?: unknown; agentId?: string }[] = []
  on('turn.step', async function* (_, e) {
    sent.push({ model: e.model, effort: e.effort, agentId: e.agentId })
    // The engine's answer, cut to what this test reads.
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
  })

  const reply = await run($, { command: 'gear', args: '2' })
  expect(reply.text).toMatch(/Sonnet · med/)

  await drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 3 }))
  await drain($.turn.step({ turnId: 't1', index: 1, model: 'claude-opus-5-5', effort: 'high', messageCount: 5, agentId: 'a1' }))
  expect(sent[0]).toEqual({ model: 'sonnet', effort: 'medium', agentId: undefined })
  expect(sent[1]?.model).toBe('claude-opus-5-5')

  await run($, { command: 'gear', args: 'off' })
  await drain($.turn.step({ turnId: 't2', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 7 }))
  expect(sent[2]?.model).toBe('claude-opus-5-5')
})

test('presets come from the settings the person chose', { options: { gear1Model: 'sonnet', gear1Effort: 'max' } }, async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  const reply = await run($, { command: 'gear', args: '' })
  expect(reply.text).toMatch(/1\. Sonnet · max/)
})

test('the band draws the presets and switches on a press, on every surface', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'gear-3' })
    expect((await run($, { command: 'gear', args: '' })).text).toMatch(/In use: Haiku · low/)
    await ui.press({ key: 'gear-3' })
    expect((await run($, { command: 'gear', args: '' })).text).toMatch(/In use: the session model/)
    // What the engine drew beneath stays.
    expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a small draft brings the nudge, and its button downshifts', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  on('prompt.edit', (_, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const draft = 'Rename userId to accountId'
  // The engine raises prompt.edit itself; its types offer no call on $ for it.
  await ($.prompt as unknown as { edit: (e: object) => Promise<unknown> }).edit({ origin: { kind: 'person' }, text: draft.slice(0, -1), cursor: draft.length - 1, start: draft.length - 1, end: draft.length - 1, inputText: 'd' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /small task/ })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'use-lighter' })
  expect((await run($, { command: 'gear', args: '' })).text).toMatch(/In use: Sonnet · med/)
  await ui.unmount()
})

test('the editor saves a pick to the settings menu', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  const saved: { key: string; value: unknown }[] = []
  on('config.set', (_, e) => {
    saved.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await run($, { command: 'gear', args: 'edit' })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.select({ key: 'effort-2', value: 'high' })
  expect(saved).toEqual([{ key: 'gearbox.gear2Effort', value: 'high' }])
  await ui.unmount()
})
