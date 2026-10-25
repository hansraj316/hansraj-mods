import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { HaloBreakdown, HaloCache, HaloTab, HaloUsage } from '../types'
import {
  COLORS,
  SLICE_COLORS,
  TEXT,
  WORD,
  barSvg,
  cacheText,
  growthSvg,
  kTokens,
  pressure,
  pushGrowth,
  resetText,
  ringsSvg,
  textBar,
  ttlMs,
  turnsLeft,
  turnsText,
} from './model'
import type { Pressure } from './model'

const PANE = 'halo'
const DEFAULT_COMPACT_AT = 92

const usage = atom({ plugin: 'context-halo', key: 'usage' } as const, { window: 200_000, limits: [], at: 0 } as HaloUsage, { shape: 'usage-1' })
const growth = atom({ plugin: 'context-halo', key: 'growth' } as const, [] as number[], { shape: 'growth-1' })
const breakdown = atom({ plugin: 'context-halo', key: 'breakdown' } as const, { slices: [] } as HaloBreakdown, { shape: 'breakdown-1' })
const cache = atom({ plugin: 'context-halo', key: 'cache' } as const, { lastAt: 0 } as HaloCache, { shape: 'cache-1' })
const expanded = atom({ plugin: 'context-halo', key: 'expanded' } as const, false)
const tab = atom({ plugin: 'context-halo', key: 'tab' } as const, 'now' as HaloTab)
const now = atom({ plugin: 'context-halo', key: 'now' } as const, 0)
const alerted = atom({ plugin: 'context-halo', key: 'alerted' } as const, 0)

type View = {
  percent: number
  level: Pressure
  used: string
  window: string
  cache: string
  left: number | undefined
  compactAt: number
  slices: { name: string; tokens: number; color: string }[]
}

function limitsOf(list: readonly SessionRateLimit[]): HaloUsage['limits'] {
  return list.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))
}

async function record($: EngineInterface, context: SessionContextUsage, limits: readonly SessionRateLimit[]): Promise<void> {
  const at = await $.clock.now()
  await update($, usage, () => ({ tokens: context.tokens, window: context.window, percent: context.percent, limits: limitsOf(limits), at }))
  if (context.percent !== undefined) {
    const before = await read($, growth)
    const next = pushGrowth(before, context.percent)
    await update($, growth, () => next)
    // A compact or clear brings the fill down: the alerts may fire again.
    if (next.length === 1 && before.length > 1) await update($, alerted, () => 0)
  }
}

/** Refreshes the per-category breakdown with the local estimate (no API calls). */
async function refreshBreakdown($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    const b = u.context.breakdown
    if (!b) return
    const used = b.categories.filter(c => c.kind === 'used' && c.tokens > 0).sort((a, z) => z.tokens - a.tokens)
    const top = used.slice(0, 4).map(c => ({ name: c.name, tokens: c.tokens }))
    const rest = used.slice(4).reduce((a, c) => a + c.tokens, 0)
    if (rest > 0) top.push({ name: 'Other', tokens: rest })
    const compactAt =
      b.isAutoCompactEnabled && b.autoCompactThreshold && b.rawMaxTokens
        ? Math.round((b.autoCompactThreshold / b.rawMaxTokens) * 100)
        : undefined
    await update($, breakdown, () => ({ slices: top, compactAt }))
  } catch {
    // The breakdown is a nicety; the halo still shows the fill without it.
  }
}

async function view($: EngineInterface, options: Record<string, unknown>, isWorking: boolean): Promise<View | undefined> {
  const u = await read($, usage)
  if (u.percent === undefined || u.tokens === undefined) return undefined
  const criticalAt = Number(options.criticalAt) || DEFAULT_COMPACT_AT
  const b = await read($, breakdown)
  const c = await read($, cache)
  const compactAt = b.compactAt ?? DEFAULT_COMPACT_AT
  const t = (await read($, now)) || (await $.clock.now())
  return {
    percent: u.percent,
    level: pressure(u.percent, criticalAt),
    used: kTokens(u.tokens),
    window: kTokens(u.window),
    cache: cacheText(c.lastAt, t, ttlMs(options.cacheTtl), isWorking),
    left: turnsLeft(await read($, growth), u.percent, compactAt),
    compactAt,
    slices: b.slices.map((s, i) => ({ ...s, color: SLICE_COLORS[i % SLICE_COLORS.length] ?? COLORS.muted })),
  }
}

async function compactWithConfirm($: EngineInterface): Promise<void> {
  const u = await read($, usage)
  const fill = u.tokens !== undefined ? `${kTokens(u.tokens)} of ${kTokens(u.window)} tokens` : 'the conversation'
  let answer = 'Cancel'
  try {
    answer = await $.ui.ask(`Compact this session? Claude replaces older turns with a summary of ${fill}. Your files stay as they are.`, {
      header: 'Context',
      options: ['Cancel', 'Compact'],
    })
  } catch {
    return
  }
  if (answer !== 'Compact') return
  $.ui.toast('Compacting the conversation…')
  try {
    await $.session.compact()
  } catch (err) {
    $.ui.toast(`Compact did not run: ${String(err).slice(0, 120)}`)
  }
}

export const register: Register = (on, options) => {
  const opts = options as Record<string, unknown>
  const warnAt = Number(opts.warnAt) || 80
  const criticalAt = Number(opts.criticalAt) || DEFAULT_COMPACT_AT
  const ttl = ttlMs(opts.cacheTtl)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'halo',
      description: 'Context halo: open the Rings pane, or `/halo compact` to compact now',
      argumentHint: '[compact]',
    })
    try {
      const u = await $.session.usage()
      await record($, u.context, u.rateLimits)
    } catch {
      // No figures before the first reply; the halo waits for one.
    }
    // The cache countdown ticks while there is something to count down.
    $.clock.every(5000, () => {
      void (async () => {
        const c = await read($, cache)
        const t = await $.clock.now()
        if (c.lastAt && t - c.lastAt < ttl + 10_000) {
          await update($, now, () => t)
          const left = ttl - (t - c.lastAt)
          if (ttl <= 5 * 60_000 && left <= 60_000 && left > 55_000)
            $.ui.toast('Prompt cache cools in about a minute. Reply soon to keep reads cheap.', { timeoutMs: 6000 })
        }
      })()
    })
    return started
  })

  on('command.run', { command: 'halo' }, async ($, e) => {
    if (e.args.trim() === 'compact') {
      await compactWithConfirm($)
      return { text: 'Context halo: compact handled.' }
    }
    await $.ui.open({ id: PANE, title: 'Context' })
    const u = await read($, usage)
    return { text: u.percent === undefined ? 'Context: waiting for the first reply.' : `Context ${u.percent}% · ${kTokens(u.tokens ?? 0)} of ${kTokens(u.window)}` }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context') || e.changed.includes('rateLimits')) {
      await record($, e.context, e.rateLimits)
      const pct = e.context.percent
      if (pct !== undefined) {
        const was = await read($, alerted)
        const u = await read($, usage)
        const left = turnsLeft(await read($, growth), pct, (await read($, breakdown)).compactAt ?? DEFAULT_COMPACT_AT)
        if (pct >= criticalAt && was < criticalAt) {
          await update($, alerted, () => criticalAt)
          $.ui.toast(`Context ${pct}% full: ${turnsText(left)}. Type /halo compact to compact now.`, { timeoutMs: 8000 })
        } else if (pct >= warnAt && was < warnAt) {
          await update($, alerted, () => warnAt)
          const biggest = (await read($, breakdown)).slices[0]
          const share = biggest && u.tokens ? ` ${biggest.name} take up ${Math.round((biggest.tokens / u.tokens) * 100)}% of it.` : ''
          $.ui.toast(`Context ${pct}% full: ${turnsText(left)}.${share}`, { timeoutMs: 8000 })
        }
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const u = e.usage
      const input = u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0
      const hitRate = u && input > 0 ? Math.round((u.cache_read_input_tokens / input) * 100) : undefined
      const t = await $.clock.now()
      await update($, cache, c => ({ lastAt: t, hitRate: hitRate ?? c.hitRate }))
      await update($, now, () => t)
      void refreshBreakdown($)
    }
    return done
  })

  // The halo: one line above the prompt, a breakdown under it when opened.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const v = await view($, opts, e.props.isWorking)
    if (!v) return below
    const isOpen = await read($, expanded)
    const { Box, Text, Button } = $.ui.resolve(e)
    const toggle = () => update($, expanded, x => !x)
    const compact = () => compactWithConfirm($)

    if (e.surface === 'terminal') {
      const color = v.level === 'critical' ? 'error' : v.level === 'warm' ? 'warning' : 'subtle'
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text color={color}>{textBar(v.percent)}</Text>
            <Text bold>{`${v.percent}%`}</Text>
            {v.level !== 'calm' && <Text color={color}>{WORD[v.level]}</Text>}
            <Text dimColor wrap="truncate">{`${v.used} of ${v.window} · cache ${v.cache} · ${turnsText(v.left)}`}</Text>
            {v.level === 'critical' && <Button key="compact" label="Compact" onPress={compact} />}
          </Box>
          {below}
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    const color = COLORS[v.level]
    const bar = barSvg(v.slices.map(s => ({ value: s.tokens, color: s.color })), 96, 6)
    return (
      <Box flexDirection="column" gap="xs">
        <Box key="halo" flexDirection="row" alignItems="center" gap="sm">
          <Svg source={ringsSvg([{ percent: v.percent, color }], 16, 3)} alt={`Context ${v.percent}% full`} width={16} height={16} />
          <Text weight="semibold" tabular>{`${v.percent}%`}</Text>
          {v.level !== 'calm' && (
            <Text weight="medium" color={TEXT[v.level]}>
              {WORD[v.level]}
            </Text>
          )}
          <Text dimColor tabular>{`${v.used} of ${v.window}`}</Text>
          <Text dimColor>·</Text>
          <Text dimColor tabular>{`Cache ${v.cache}`}</Text>
          <Box flexGrow={1} />
          {v.level === 'critical' && <Button key="compact" variant="primary" label="Compact" onPress={compact} />}
          {v.slices.length > 0 && <Svg source={bar} alt="What is in context, by category" width={96} height={6} />}
          <Button key="toggle" plain dimColor label={isOpen ? 'Hide' : 'Details'} onPress={toggle} />
        </Box>
        {isOpen && (
          <Box flexDirection="column" gap="xs" paddingY="xs">
            {v.slices.map(s => (
              <Box flexDirection="row" gap="sm" alignItems="center">
                <Svg source={barSvg([{ value: 1, color: s.color }], 8, 8)} alt="" width={8} height={8} />
                <Text>{s.name}</Text>
                <Box flexGrow={1} />
                <Text dimColor tabular>{kTokens(s.tokens)}</Text>
              </Box>
            ))}
            <Box flexDirection="row" gap="sm" alignItems="center">
              <Text dimColor>{`Auto-compact: ${turnsText(v.left)}`}</Text>
              <Box flexGrow={1} />
              <Button key="rings" label="Open Rings" onPress={() => $.ui.open({ id: PANE, title: 'Context' })} />
              <Button key="compact-now" variant={v.level === 'critical' ? 'primary' : 'secondary'} label="Compact" onPress={compact} />
            </Box>
          </Box>
        )}
        {below}
      </Box>
    )
  })

  // The Rings pane: context, cache hits and plan windows, with Now and Turns tabs.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const v = await view($, opts, false)
    if (!v) return <Text dimColor>Context figures arrive with Claude's first reply.</Text>
    const u = await read($, usage)
    const c = await read($, cache)
    const series = await read($, growth)
    const current = await read($, tab)
    const t = (await read($, now)) || (await $.clock.now())
    const five = u.limits.find(l => l.kind === 'five_hour')
    const week = u.limits.find(l => l.kind === 'seven_day')
    const rows = [
      { name: 'Context', color: COLORS[v.level], percent: v.percent, detail: `${v.used} of ${v.window}` },
      { name: 'Cache hits', color: COLORS.cache, percent: c.hitRate ?? 0, detail: c.hitRate === undefined ? 'no reply yet' : `${c.hitRate}% · ${v.cache}` },
      five && { name: 'Plan · 5 hour', color: COLORS.fiveHour, percent: five.percentUsed, detail: `${five.percentUsed}% · ${resetText(five.resetsAt, t)}` },
      week && { name: 'Plan · week', color: COLORS.week, percent: week.percentUsed, detail: `${week.percentUsed}% · ${resetText(week.resetsAt, t)}` },
    ].filter(Boolean) as { name: string; color: string; percent: number; detail: string }[]
    const tabs: { id: HaloTab; label: string }[] = [
      { id: 'now', label: 'Now' },
      { id: 'turns', label: 'Turns' },
    ]
    const tabRow = (
      <Box flexDirection="row" gap="xs">
        {tabs.map(x => (
          <Button key={`tab-${x.id}`} label={x.label} variant={current === x.id ? 'primary' : 'secondary'} onPress={() => update($, tab, () => x.id)} />
        ))}
      </Box>
    )

    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="column">
          {tabRow}
          {rows.map(r => (
            <Text>{`${r.name.padEnd(14)} ${textBar(r.percent, 12)} ${r.detail}`}</Text>
          ))}
          <Text> </Text>
          {current === 'now'
            ? v.slices.map(s => <Text>{`${s.name.padEnd(18)} ${kTokens(s.tokens)}`}</Text>)
            : [<Text>{`Fill by turn: ${series.join(' → ')}%`}</Text>, <Text dimColor>{turnsText(v.left)}</Text>]}
          <Button key="compact" label="Compact now" onPress={() => compactWithConfirm($)} />
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    const width = Math.max(160, Math.min(320, e.props.bodyColumns * 8))
    return (
      <Box flexDirection="column" gap="md">
        {tabRow}
        <Box flexDirection="row" justifyContent="center">
          <Svg
            source={ringsSvg(rows.slice(0, 3).map(r => ({ percent: r.percent, color: r.color })), 180, 14)}
            alt={rows.map(r => `${r.name} ${r.percent}%`).join(', ')}
            width={180}
            height={180}
          />
        </Box>
        <Box flexDirection="column" alignItems="center">
          <Text size="title" weight="semibold" tabular>{`${v.percent}%`}</Text>
          <Text size="caption" weight="semibold" color={TEXT[v.level]}>
            {WORD[v.level].toUpperCase()}
          </Text>
        </Box>
        <Box flexDirection="column" gap="xs">
          {rows.map(r => (
            <Box flexDirection="row" gap="sm" alignItems="center">
              <Svg source={barSvg([{ value: 1, color: r.color }], 10, 10)} alt="" width={10} height={10} />
              <Text>{r.name}</Text>
              <Box flexGrow={1} />
              <Text dimColor tabular>{r.detail}</Text>
            </Box>
          ))}
        </Box>
        {current === 'now' ? (
          <Box flexDirection="column" gap="xs">
            <Text size="caption" weight="semibold" dimColor>
              WHAT IS IN CONTEXT
            </Text>
            {v.slices.length === 0 && <Text dimColor>The breakdown appears after the next reply.</Text>}
            {v.slices.length > 0 && <Svg source={barSvg(v.slices.map(s => ({ value: s.tokens, color: s.color })), width, 10)} alt="What is in context, by category" width={width} height={10} />}
            {v.slices.map(s => (
              <Box flexDirection="row" gap="sm" alignItems="center">
                <Svg source={barSvg([{ value: 1, color: s.color }], 8, 8)} alt="" width={8} height={8} />
                <Text>{s.name}</Text>
                <Box flexGrow={1} />
                <Text dimColor tabular>{kTokens(s.tokens)}</Text>
              </Box>
            ))}
          </Box>
        ) : (
          <Box flexDirection="column" gap="xs">
            <Text size="caption" weight="semibold" dimColor>
              FILL BY TURN
            </Text>
            <Svg source={growthSvg(series, v.compactAt, COLORS[v.level], width, 100)} alt={`Fill by turn: ${series.join(', ')} percent`} width={width} height={100} />
            <Text dimColor>{`The dashed line is auto-compact: ${turnsText(v.left)}.`}</Text>
          </Box>
        )}
        <Button key="compact" variant="primary" label="Compact now" onPress={() => compactWithConfirm($)} />
      </Box>
    )
  })
}
