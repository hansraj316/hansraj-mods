import { expect, test } from 'claude-code/testing'

import { cacheText, pressure, pushGrowth, turnsLeft } from './model'

const BAND = {
  plugin: 'tokentide',
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

const PANE = {
  plugin: 'tokentide',
  component: 'Pane',
  requestId: 'tide',
  props: {
    title: 'Context',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

function measure(percent: number) {
  return {
    context: { tokens: percent * 2000, window: 200_000, percent },
    rateLimits: [{ kind: 'five_hour', percentUsed: 38 }],
    changed: ['context', 'rateLimits'] as ('context' | 'rateLimits')[],
  }
}

test('the model: pressure, growth, turns left and cache', () => {
  expect(pressure(34, 92)).toBe('calm')
  expect(pressure(72, 92)).toBe('warm')
  expect(pressure(95, 92)).toBe('critical')
  expect(pushGrowth([40, 50, 60], 20)).toEqual([20])
  expect(pushGrowth([40, 50], 55)).toEqual([40, 50, 55])
  expect(turnsLeft([50, 56, 62, 68, 74], 74, 92)).toBe(3)
  expect(turnsLeft([50], 50, 92)).toBe(undefined)
  expect(cacheText(0, 1000, 300_000, false)).toBe('—')
  expect(cacheText(1000, 61_000, 300_000, false)).toBe('4:00')
  expect(cacheText(1000, 400_000, 300_000, false)).toBe('cold')
})

test('the ring shows the fill on every surface, and nothing before a reply', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /%/ })).toBeUndefined()
    await ui.unmount()
  }

  await $.session.measure(measure(72))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /^72%$/ }))?.text).toBe('72%')
    expect(await ui.find({ type: 'Text', text: /Warm/ })).toBeDefined()
    // What the engine drew beneath stays.
    expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
    await ui.unmount()
  }
})

test('one toast at the heads-up line and one at critical', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(String(e.text))
    return { value: undefined }
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.measure(measure(70))
  await $.session.measure(measure(81))
  await $.session.measure(measure(84))
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toMatch(/Context 81% full/)
  await $.session.measure(measure(93))
  expect(toasts.length).toBe(2)
  expect(toasts[1]).toMatch(/\/tide compact/)
})

test('Compact asks first, and compacts only on yes', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  let compacted = 0
  let answer = 'Cancel'
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => ({
    result: { questions: e.questions, answers: { [e.questions[0]!.question]: answer } },
  }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('session.compact', () => {
    compacted += 1
    return { skip: 'test stands in for the engine' }
  })

  await $.session.measure(measure(95))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'compact' })
  expect(compacted).toBe(0)
  answer = 'Compact'
  await ui.press({ key: 'compact' })
  expect(compacted).toBe(1)
  await ui.unmount()
})

test('the Rings pane lists context and the 5-hour window, and switches tabs', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.measure(measure(60))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Plan · 5 hour|Plan · 5 hour/ })).toBeDefined()
    await ui.press({ key: 'tab-turns' })
    expect(await ui.find({ type: 'Text', text: /auto-compact/ })).toBeDefined()
    await ui.press({ key: 'tab-now' })
    await ui.unmount()
  }
})
