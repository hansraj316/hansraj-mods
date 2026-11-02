import { expect, test } from 'claude-code/testing'

import { addSample, addToMonth, buckets, emptyLog, emptyMonth, forecast, monthText, monthlyLimit, span } from './radar'

/** Runs a slash command as the person would type it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function run($: any, input: { command: string; args: string }): Promise<{ text?: string }> {
  return $.command.run(input)
}

const MIN = 60_000
const T0 = Date.parse('2026-11-02T20:00:00Z')
const RESET = '2026-11-02T23:00:00Z' // the window opened at 18:00

const BAND = {
  plugin: 'limit-radar',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const PANE = {
  plugin: 'limit-radar',
  component: 'Pane',
  requestId: 'radar',
  props: { title: 'Limits', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

/** An in-memory store standing in for the engine's. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function memoryStore(on: (...args: any[]) => unknown) {
  const data = new Map<string, unknown>()
  on('store.get', (_: unknown, e: { key: string }) => ({ value: data.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    data.set(e.key, e.value)
    return { value: undefined }
  })
  return data
}

function reading(five: number, week = 41, extra: { kind: string; percentUsed: number; resetsAt?: string }[] = []) {
  return {
    context: { tokens: 1000, window: 200_000, percent: 1 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: five, resetsAt: RESET },
      { kind: 'seven_day', percentUsed: week, resetsAt: '2026-11-06T00:00:00Z' },
      ...extra,
    ],
    changed: ['rateLimits'] as ('rateLimits')[],
  }
}

test('the model: samples, burn per half hour, forecast, month', () => {
  let log = emptyLog()
  log = addSample(log, { kind: 'five_hour', percentUsed: 40, resetsAt: RESET }, T0)
  log = addSample(log, { kind: 'five_hour', percentUsed: 52, resetsAt: RESET }, T0 + 20 * MIN)
  log = addSample(log, { kind: 'five_hour', percentUsed: 64, resetsAt: RESET }, T0 + 40 * MIN)
  // 24 points in 40 minutes: 36 points to go take an hour, so 21:40 + 60m = 22:40, before the 23:00 reset.
  const f = forecast(log, T0 + 40 * MIN)
  expect(f?.isBeforeReset).toBe(true)
  expect(span((f?.limitAt ?? 0) - (T0 + 40 * MIN))).toBe('1h 00m')

  // The window opened at 18:00: buckets 4 and 5 (20:00 to 21:00) hold this hour's use.
  const b = buckets(log, T0 + 40 * MIN)
  expect(b.length).toBe(10)
  expect(b[4]).toBe(52)
  expect(b[5]).toBe(12)
  expect(b[9]).toBe(null)

  // A new resetsAt starts a new window.
  expect(addSample(log, { kind: 'five_hour', percentUsed: 3, resetsAt: '2026-11-03T04:00:00Z' }, T0 + 4 * 60 * MIN).samples.length).toBe(1)

  let m = emptyMonth(T0)
  m = addToMonth(m, [{ kind: 'five_hour', percentUsed: 100 }], T0)
  m = addToMonth(m, [{ kind: 'five_hour', percentUsed: 100 }], T0 + 30 * MIN)
  expect(monthText(m)).toBe('1 day at a limit this month')
  expect(addToMonth(m, [], Date.parse('2026-12-01T01:00:00Z')).hitDays).toEqual([])
  expect(monthlyLimit([{ kind: 'spend_limit', percentUsed: 36 }])?.percentUsed).toBe(36)
})

test('the pane shows the 5-hour window, the week and the month on every surface', async ($, on) => {
  let now = T0
  on('clock.now', () => ({ value: now }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  memoryStore(on)
  on('ui.toast', () => ({ value: undefined }))
  await $.session.measure(reading(52))
  now += 30 * MIN
  await $.session.measure(reading(71))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /71%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Week/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /this month/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a monthly spend cap the account reports takes the Month row', async ($, on) => {
  on('clock.now', () => ({ value: T0 }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  memoryStore(on)
  await $.session.measure(reading(20, 30, [{ kind: 'spend_limit', percentUsed: 36 }]))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /36% of your monthly cap/ })).toBeDefined()
  await ui.unmount()
})

test('a pace that beats the reset brings one toast and the band', async ($, on) => {
  let now = T0
  const toasts: string[] = []
  on('clock.now', () => ({ value: now }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  memoryStore(on)
  on('ui.toast', (_, e) => {
    toasts.push(String(e.text))
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.measure(reading(20))
  // A quiet window: no band below 50%.
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /5-hour/ })).toBeUndefined()
  await ui.unmount()

  now += 20 * MIN
  await $.session.measure(reading(40))
  now += 20 * MIN
  await $.session.measure(reading(60))
  now += 1 * MIN
  await $.session.measure(reading(61))
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toMatch(/before it resets/)

  for (const surface of ['terminal', 'desktop'] as const) {
    const each = await $.ui.mount({ ...BAND, surface })
    expect(await each.find({ type: 'Text', text: /before it resets in/ })).toBeDefined()
    expect(await each.find({ type: 'Text', text: /engine/ })).toBeDefined()
    await each.unmount()
  }
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'dismiss' })
  expect(await ui.find({ type: 'Text', text: /before it resets/ })).toBeUndefined()
  await ui.unmount()
})

test('/radar opens the pane and says where things stand', async ($, on) => {
  on('clock.now', () => ({ value: T0 }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  memoryStore(on)
  let opened = ''
  on('ui.open', (_, e) => {
    opened = e.id
    return { value: { isPlaced: true } }
  })
  const before = await run($, { command: 'radar', args: '' })
  expect(before.text).toMatch(/no plan limits/)
  await $.session.measure(reading(33))
  const after = await run($, { command: 'radar', args: '' })
  expect(opened).toBe('radar')
  expect(after.text).toMatch(/5-hour 33%/)
})
