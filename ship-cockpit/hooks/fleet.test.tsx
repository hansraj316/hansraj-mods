import { expect, test } from 'claude-code/testing'

import type { FleetProject } from '../types'
import { eventOf, levelOf, perDay, sortFleet } from './fleet'

const project = (over: Partial<FleetProject>): FleetProject => ({
  path: '/p/x',
  name: 'x',
  dirty: 0,
  activity: [0, 0, 0, 0, 0, 0, 0],
  readAt: 0,
  ...over,
})

test('levels and ticker lines put the most urgent news first', () => {
  const failing = project({ name: 'b', mainCi: { branch: 'main', state: 'failing', title: 'tests' } })
  const pending = project({ name: 'a', pr: { number: 42, title: 'CSV export', checks: 'pending', updatedAt: 1 } })
  const healthy = project({ name: 'c', mainCi: { branch: 'main', state: 'passing', title: 'ok' } })
  const dirty = project({ name: 'd', dirty: 3, branch: 'feat/x' })
  expect(levelOf(failing)).toBe('failing')
  expect(levelOf(pending)).toBe('attention')
  expect(levelOf(dirty)).toBe('attention')
  expect(levelOf(healthy)).toBe('healthy')
  expect(eventOf(failing).text).toBe('main failing · tests')
  expect(eventOf(pending).text).toBe('PR #42 checks running')
  expect(eventOf(dirty).text).toBe('3 uncommitted on feat/x')
  expect(sortFleet([healthy, pending, failing]).map(p => p.name)).toEqual(['b', 'a', 'c'])
  const now = Date.UTC(2026, 9, 25, 12)
  expect(perDay([now / 1000, now / 1000 - 3600, now / 1000 - 86_400 * 2], now)).toEqual([0, 0, 0, 0, 1, 0, 2])
})

const BAND = {
  plugin: 'ship-cockpit',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const PANE = {
  plugin: 'ship-cockpit',
  component: 'Pane',
  requestId: 'ship',
  props: { title: 'Ship', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

test('fleet changes need the person; the ticker and Fleet tab show a listed project on every surface', async ($, on) => {
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(String(e.key)) }))
  on('store.set', (_, e) => {
    store.set(String(e.key), e.value)
    return { value: undefined }
  })
  on('env.get', () => ({ value: '/Users/me' }))
  on('session.cwd', () => ({ value: '/Users/me/work' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_, e) => {
    const argv = (e.argv as string[]).join(' ')
    if (argv === 'git rev-parse --is-inside-work-tree') return ok('true')
    if (argv === 'git branch --show-current') return ok('main')
    if (argv === 'git status --porcelain') return ok('')
    if (argv.startsWith('git log -1')) return ok(`${Math.floor(Date.now() / 1000) - 600}\x1fAdd CSV export`)
    if (argv.startsWith('git symbolic-ref')) return ok('origin/main')
    if (argv.startsWith('gh run list')) return ok(JSON.stringify([{ conclusion: 'failure', status: 'completed', displayTitle: 'Unit tests', updatedAt: new Date().toISOString() }]))
    if (argv.startsWith('gh api')) return ok(JSON.stringify([{ title: 'v1.2', open_issues: 1, closed_issues: 3 }]))
    if (argv.startsWith('gh pr list')) return ok('[]')
    return ok('')
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('command.run', () => ({ text: '' }))

  // Only the person at the prompt may change the fleet; a plugin's run (as this test's is) is refused.
  const refused = await $.command.run({ command: 'ship', args: 'fleet add ~/projects/example-app' })
  expect(String(refused.text)).toContain('Only you')
  expect(store.get('fleetPaths')).toBeUndefined()
  store.set('fleetPaths', ['/Users/me/projects/example-app'])
  // Opening the Fleet tab reads every project again; wait for that read.
  await $.command.run({ command: 'ship', args: 'fleet' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Text', text: /main failing · Unit tests/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /engine/ })).toBeDefined()
    await band.press({ key: surface === 'terminal' ? 'ticker' : 'ticker-pause' })
    expect(await band.find({ type: 'Text', text: /paused|PAUSED/ })).toBeDefined()
    await band.press({ key: surface === 'terminal' ? 'ticker' : 'ticker-pause' })
    await band.unmount()

    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ type: 'Text', text: /Failing/ })).toBeDefined()
    await pane.unmount()
  }
})
