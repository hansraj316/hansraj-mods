import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { EFFORTS, MODELS, applyEdit, gearsFrom, isLight, label, lighterGear, modelName } from './model'
import type { Gear } from './model'

const active = atom({ plugin: 'gearbox', key: 'active' } as const, null)
const light = atom({ plugin: 'gearbox', key: 'light' } as const, false)
const editing = atom({ plugin: 'gearbox', key: 'editing' } as const, false)
const fiveHour = atom({ plugin: 'gearbox', key: 'fiveHour' } as const, null)

const EFFORT_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

/** The choice after `value` in `list`, wrapping round. */
function after(list: readonly string[], value: string): string {
  return list[(list.indexOf(value) + 1) % list.length]!
}

/** Saves one preset field through the settings menu, so it lasts and /config shows it. */
async function setField($: EngineInterface, field: string, value: string): Promise<void> {
  try {
    const r = await $.config.set({ key: `gearbox.${field}`, value })
    if ('deny' in r && r.deny) $.ui.toast(`Gearbox could not save that: ${r.deny}`)
  } catch (err) {
    $.ui.toast(`Gearbox could not save that: ${String(err).slice(0, 120)}`)
  }
}

/** Puts a preset in use (null for the session's own model) and names it in the status line. */
async function choose($: EngineInterface, gears: Gear[], i: number | null): Promise<void> {
  await update($, active, () => i)
  $.ui.status(i === null ? undefined : `Gear: ${label(gears[i]!)}`)
}

export const register: Register = (on, options) => {
  const opts = options as Record<string, unknown>
  const gears: Gear[] = gearsFrom(opts)
  const nudge = opts.nudge !== 'off'

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'gear',
      description: 'Gearbox: switch preset (`/gear 1`, `/gear 2`, `/gear 3`, `/gear off`), or `/gear edit`',
      argumentHint: '[1|2|3|off|edit]',
    })
    // A reload keeps the session's state: show the status line again for it.
    const i = await read($, active)
    if (i !== null && gears[i]) $.ui.status(`Gear: ${label(gears[i]!)}`)
    try {
      const u = await $.session.usage()
      const five = u.rateLimits.find(l => l.kind === 'five_hour')
      await update($, fiveHour, () => (five ? five.percentUsed : null))
    } catch {
      // No reading before the first reply.
    }
    return started
  })

  on('command.run', { command: 'gear' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'edit') {
      await update($, editing, () => true)
      return { text: 'Gearbox: the preset editor is open above the prompt.' }
    }
    if (arg === 'off' || arg === '0') {
      await choose($, gears, null)
      return { text: "Gearbox: off. Claude uses the session's own model and effort." }
    }
    const n = Number(arg)
    if (Number.isInteger(n) && n >= 1 && n <= gears.length) {
      await choose($, gears, n - 1)
      return { text: `Gearbox: ${label(gears[n - 1]!)} for the rest of this session.` }
    }
    const list = gears.map((g, i) => `${i + 1}. ${label(g)}`).join(' · ')
    const i = await read($, active)
    return { text: `Gearbox presets: ${list}. In use: ${i === null ? 'the session model' : label(gears[i]!)}.` }
  })

  // Every model request of the main conversation goes out in the chosen gear.
  // Subagents keep the model they were given.
  on('turn.step', async function* ($, e, next) {
    const i = await read($, active)
    const g = i === null ? undefined : gears[i]
    if (!g || e.agentId !== undefined) return yield* next(e)
    return yield* next({ ...e, model: g.model, effort: g.effort })
  })

  // Reads the draft as it is typed, to offer a lighter preset for small edits.
  on('prompt.edit', async ($, e, next) => {
    if (nudge) {
      const draft = applyEdit(e.text, e.start, e.end, e.inputText)
      const isNow = isLight(draft)
      if (isNow !== (await read($, light))) await update($, light, () => isNow)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, light, () => false)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      const five = e.rateLimits.find(l => l.kind === 'five_hour')
      await update($, fiveHour, () => (five ? five.percentUsed : null))
    }
    return next(e)
  })

  // The band: one chip per preset, the 5-hour window, a nudge, and the editor.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // Pickers where the surface has them; elsewhere a button steps through the choices.
    const Select = 'Select' in table ? table.Select : undefined
    const i = await read($, active)
    const isEditing = await read($, editing)
    const five = await read($, fiveHour)
    const suggest = nudge && (await read($, light)) ? lighterGear(gears, i) : null

    const chips = gears.map((g, n) => (
      <Button key={`gear-${n + 1}`} label={label(g)} variant={i === n ? 'primary' : 'secondary'} onPress={() => choose($, gears, i === n ? null : n)} />
    ))

    const editor = isEditing && (
      <Box flexDirection="column" gap="xs" paddingY="xs">
        <Text dimColor>Presets: pick a model and an effort for each. Saved to Gearbox's settings.</Text>
        {gears.map((g, n) => (
          <Box key={`row-${n + 1}`} flexDirection="row" gap="sm" alignItems="center">
            <Text weight="medium">{`${n + 1}`}</Text>
            {Select ? (
              <Select
                key={`model-${n + 1}`}
                label="Model"
                value={g.model}
                options={MODELS.map(m => ({ value: m, label: modelName(m) }))}
                onSelect={(v: string) => setField($, `gear${n + 1}Model`, v)}
              />
            ) : (
              <Button key={`model-${n + 1}`} label={modelName(g.model)} onPress={() => setField($, `gear${n + 1}Model`, after(MODELS, g.model))} />
            )}
            {Select ? (
              <Select
                key={`effort-${n + 1}`}
                label="Effort"
                value={g.effort}
                options={EFFORTS.map(x => ({ value: x, label: EFFORT_LABEL[x] ?? x }))}
                onSelect={(v: string) => setField($, `gear${n + 1}Effort`, v)}
              />
            ) : (
              <Button key={`effort-${n + 1}`} label={EFFORT_LABEL[g.effort] ?? g.effort} onPress={() => setField($, `gear${n + 1}Effort`, after(EFFORTS, g.effort))} />
            )}
          </Box>
        ))}
      </Box>
    )

    const hint = suggest !== null && (
      <Box flexDirection="row" gap="sm" alignItems="center">
        <Text dimColor>{`Looks like a small task. ${label(gears[suggest]!)} is usually enough and uses less of your limit.`}</Text>
        <Button key="use-lighter" label={`Use ${modelName(gears[suggest]!.model)}`} onPress={() => choose($, gears, suggest)} />
      </Box>
    )

    return (
      <Box flexDirection="column" gap="xs">
        <Box key="gears" flexDirection="row" alignItems="center" gap="sm">
          {chips}
          <Box flexGrow={1} />
          {five !== null && <Text dimColor tabular>{`5-hour ${Math.round(five)}%`}</Text>}
          <Button key="edit" plain dimColor label={isEditing ? 'Done' : 'Edit'} onPress={() => update($, editing, x => !x)} />
        </Box>
        {hint}
        {editor}
        {below}
      </Box>
    )
  })
}
