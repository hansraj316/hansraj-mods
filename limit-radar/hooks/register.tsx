import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { RadarLog, RadarMonth, RadarNow } from '../types'
import {
  COLORS,
  addSample,
  addToMonth,
  buckets,
  burnSvg,
  emptyLog,
  emptyMonth,
  forecast,
  meterSvg,
  monthText,
  monthlyLimit,
  resetIn,
  span,
  textBar,
} from './radar'

const PANE = 'radar'
// The 5-hour window spans sessions, so its readings are kept in the shared store too.
const STORE_FIVE = 'five-hour-log'
const STORE_MONTH = 'month'

const latest = atom({ plugin: 'limit-radar', key: 'latest' } as const, { limits: [], at: 0 } as RadarNow, { shape: 'latest-1' })
const five = atom({ plugin: 'limit-radar', key: 'five' } as const, emptyLog() as RadarLog, { shape: 'five-1' })
const month = atom({ plugin: 'limit-radar', key: 'month' } as const, emptyMonth(0) as RadarMonth, { shape: 'month-1' })
const warned = atom({ plugin: 'limit-radar', key: 'warned' } as const, '')
const dismissed = atom({ plugin: 'limit-radar', key: 'dismissed' } as const, '')
const tick = atom({ plugin: 'limit-radar', key: 'tick' } as const, 0)

function isLog(v: unknown): v is RadarLog {
  return typeof v === 'object' && v !== null && Array.isArray((v as RadarLog).samples) && typeof (v as RadarLog).resetsAt === 'string'
}

function isMonth(v: unknown): v is RadarMonth {
  return typeof v === 'object' && v !== null && Array.isArray((v as RadarMonth).hitDays) && typeof (v as RadarMonth).month === 'string'
}

/** Keeps a value across sessions; the session's own state still holds it if the store refuses. */
async function keep($: EngineInterface, key: string, value: unknown): Promise<void> {
  try {
    await $.store.set(key, value)
  } catch {
    // Best effort: losing the cross-session copy only shortens the history.
  }
}

/** Takes in one reading of every window: the 5-hour log, the month, and the latest figures. */
async function record($: EngineInterface, limits: readonly SessionRateLimit[]): Promise<void> {
  const now = await $.clock.now()
  const list = limits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))
  await update($, latest, () => ({ limits: list, at: now }))
  const fiveHour = list.find(l => l.kind === 'five_hour')
  if (fiveHour) {
    const log = addSample(await read($, five), fiveHour, now)
    await update($, five, () => log)
    await keep($, STORE_FIVE, log)
  }
  const m = addToMonth(await read($, month), list, now)
  await update($, month, () => m)
  await keep($, STORE_MONTH, m)
}

/** Loads what earlier sessions kept, when it is newer than what this session holds. */
async function restore($: EngineInterface): Promise<void> {
  let log: unknown
  let m: unknown
  try {
    log = await $.store.get(STORE_FIVE)
    m = await $.store.get(STORE_MONTH)
  } catch {
    return
  }
  if (isLog(log) && (await read($, five)).samples.length === 0) await update($, five, () => log)
  if (isMonth(m) && (await read($, month)).month === emptyMonth(0).month) await update($, month, () => m)
}

type View = {
  now: number
  fivePct?: number
  fiveReset: string
  limitIn?: string
  isLate: boolean
  bars: (number | null)[]
  week?: { pct: number; reset: string }
  monthly?: { pct: number; reset: string }
  monthNote: string
  resetsAt: string
}

async function view($: EngineInterface): Promise<View> {
  const now = (await read($, tick)) || (await $.clock.now())
  const l = await read($, latest)
  const log = await read($, five)
  const fiveHour = l.limits.find(x => x.kind === 'five_hour')
  const week = l.limits.find(x => x.kind === 'seven_day')
  const monthly = monthlyLimit(l.limits)
  const f = forecast(log, now)
  return {
    now,
    fivePct: fiveHour?.percentUsed,
    fiveReset: resetIn(fiveHour?.resetsAt, now),
    limitIn: f ? span(f.limitAt - now) : undefined,
    isLate: !!f && f.isBeforeReset && (fiveHour?.percentUsed ?? 0) < 100,
    bars: buckets(log, now),
    week: week && { pct: week.percentUsed, reset: resetIn(week.resetsAt, now) },
    monthly: monthly && { pct: monthly.percentUsed, reset: resetIn(monthly.resetsAt, now) },
    monthNote: monthText(await read($, month)),
    resetsAt: log.resetsAt,
  }
}

export const register: Register = (on, options) => {
  const opts = options as Record<string, unknown>
  const bandAt = Number(opts.bandAt) || 50

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'radar', description: 'Limit Radar: your 5-hour, weekly and monthly usage, with a forecast' })
    await restore($)
    try {
      const u = await $.session.usage()
      if (u.rateLimits.length) await record($, u.rateLimits)
    } catch {
      // No reading before the first reply.
    }
    // Countdowns move on their own; a reading a minute is plenty.
    $.clock.every(60_000, () => {
      void (async () => {
        const t = await $.clock.now()
        await update($, tick, () => t)
      })()
    })
    return started
  })

  on('command.run', { command: 'radar' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Limits' })
    const v = await view($)
    if (v.fivePct === undefined) return { text: 'Limit Radar: no plan limits reported yet. They arrive with the first reply on a Claude subscription.' }
    const parts = [`5-hour ${v.fivePct}% (${v.fiveReset})`]
    if (v.limitIn) parts.push(`at this pace the limit is ${v.limitIn} away`)
    if (v.week) parts.push(`week ${v.week.pct}%`)
    return { text: `Limit Radar: ${parts.join(', ')}.` }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') && e.rateLimits.length) {
      await record($, e.rateLimits)
      const v = await view($)
      if (v.isLate && (await read($, warned)) !== v.resetsAt) {
        await update($, warned, () => v.resetsAt)
        $.ui.toast(`At this pace you reach the 5-hour limit in ${v.limitIn}, before it resets. /radar for details.`, { timeoutMs: 8000 })
      }
    }
    return next(e)
  })

  // The band: only when the forecast lands before the reset, or the window is past bandAt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const v = await view($)
    const isShown = v.fivePct !== undefined && (v.isLate || v.fivePct >= bandAt) && (await read($, dismissed)) !== v.resetsAt
    if (!isShown) return below
    const { Box, Text, Button } = $.ui.resolve(e)
    const words = v.isLate
      ? `At this pace you hit the 5-hour limit in ${v.limitIn}, before it ${v.fiveReset}.`
      : `5-hour window ${v.fivePct}% used, ${v.fiveReset}.`
    return (
      <Box flexDirection="column" gap="xs">
        <Box key="radar" flexDirection="row" alignItems="center" gap="sm">
          <Text color={v.isLate ? COLORS.warn : undefined}>{e.surface === 'terminal' ? `${textBar(v.fivePct ?? 0)} ${words}` : words}</Text>
          <Box flexGrow={1} />
          <Button key="open" plain label="Details" onPress={() => $.ui.open({ id: PANE, title: 'Limits' })} />
          <Button key="dismiss" plain dimColor label="Hide" onPress={() => update($, dismissed, () => v.resetsAt)} />
        </Box>
        {below}
      </Box>
    )
  })

  // The pane: the 5-hour window big, its burn and forecast, then week and month.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = await view($)
    if (v.fivePct === undefined)
      return <Text dimColor>Plan limits arrive with Claude's first reply. They show on a Claude subscription, not on an API key.</Text>

    const monthRow = v.monthly ? `${v.monthly.pct}% of your monthly cap${v.monthly.reset ? `, ${v.monthly.reset}` : ''}` : v.monthNote
    const rows = [
      { name: 'Resets', value: v.fiveReset.replace('resets in ', 'in ') },
      { name: 'Limit at this pace', value: v.limitIn ? `in ${v.limitIn}` : 'not enough readings yet', isLate: v.isLate },
    ]

    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="column">
          <Text weight="semibold">{`5-hour  ${textBar(v.fivePct)} ${v.fivePct}%`}</Text>
          {rows.map(r => (
            <Text color={r.isLate ? 'warning' : undefined}>{`${r.name.padEnd(20)} ${r.value}`}</Text>
          ))}
          {v.week && <Text>{`Week    ${textBar(v.week.pct)} ${v.week.pct}% · ${v.week.reset}`}</Text>}
          <Text>{`Month   ${monthRow}`}</Text>
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    const width = Math.max(160, Math.min(320, e.props.bodyColumns * 8))
    return (
      <Box flexDirection="column" gap="md">
        <Box flexDirection="column">
          <Text size="caption" dimColor>
            5-hour window
          </Text>
          <Text size="title" weight="semibold" tabular>{`${v.fivePct}%`}</Text>
        </Box>
        <Svg source={burnSvg(v.bars, width, 56)} alt={`Use per half hour: ${v.bars.map(b => (b === null ? '-' : `${b}%`)).join(', ')}`} width={width} height={56} />
        <Box flexDirection="column" gap="xs">
          {rows.map(r => (
            <Box flexDirection="row" gap="sm">
              <Text dimColor>{r.name}</Text>
              <Box flexGrow={1} />
              <Text tabular color={r.isLate ? COLORS.warn : undefined}>
                {r.value}
              </Text>
            </Box>
          ))}
        </Box>
        <Box flexDirection="column" gap="xs">
          {v.week && (
            <Box flexDirection="row" gap="sm" alignItems="center">
              <Text dimColor>Week</Text>
              <Box flexGrow={1} />
              <Svg source={meterSvg(v.week.pct, 96, COLORS.bar)} alt={`Week ${v.week.pct}%`} width={96} height={6} />
              <Text tabular>{`${v.week.pct}%`}</Text>
            </Box>
          )}
          {v.week && <Text size="caption" dimColor>{`Week ${v.week.reset}`}</Text>}
          <Box flexDirection="row" gap="sm" alignItems="center">
            <Text dimColor>Month</Text>
            <Box flexGrow={1} />
            {v.monthly && <Svg source={meterSvg(v.monthly.pct, 96, COLORS.bar)} alt={`Month ${v.monthly.pct}%`} width={96} height={6} />}
            <Text tabular>{monthRow}</Text>
          </Box>
        </Box>
      </Box>
    )
  })
}
