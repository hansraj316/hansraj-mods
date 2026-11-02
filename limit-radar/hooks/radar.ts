// Limit Radar's pure logic: samples of the 5-hour window, the burn per half
// hour, the forecast, and the month's record. No engine calls here.

import type { RadarLimit, RadarLog, RadarMonth, RadarSample } from '../types'

export const FIVE_HOURS = 5 * 60 * 60_000
export const BUCKET = 30 * 60_000
export const BUCKETS = FIVE_HOURS / BUCKET
/** The forecast reads the pace of the last hour, so a burst an hour ago fades. */
const PACE_SPAN = 60 * 60_000
const MAX_SAMPLES = 400

export const COLORS = {
  bar: '#FF9F0A',
  barFaint: '#FF9F0A55',
  track: '#3A3A3C',
  warn: '#E08600',
  calm: '#409CFF',
} as const

export function emptyLog(): RadarLog {
  return { resetsAt: '', samples: [] }
}

/** Adds a reading of the 5-hour window. A new resetsAt starts a new window. */
export function addSample(log: RadarLog, limit: RadarLimit, now: number): RadarLog {
  const resetsAt = limit.resetsAt ?? ''
  const base = log.resetsAt === resetsAt ? log : { resetsAt, samples: [] }
  const last = base.samples[base.samples.length - 1]
  if (last && last.pct === limit.percentUsed && now - last.t < 10 * 60_000) return base
  const samples = [...base.samples, { t: now, pct: limit.percentUsed }].slice(-MAX_SAMPLES)
  return { resetsAt, samples }
}

export type Forecast = {
  /** When the window would reach 100% at the recent pace, in clock ms. */
  limitAt: number
  /** True when that comes before the window resets. */
  isBeforeReset: boolean
}

/** The recent pace, projected to 100%. Undefined without enough of a trend. */
export function forecast(log: RadarLog, now: number): Forecast | undefined {
  const recent = log.samples.filter(s => s.t >= now - PACE_SPAN)
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (!first || !last || last.t - first.t < 5 * 60_000) return undefined
  const rate = (last.pct - first.pct) / (last.t - first.t)
  if (rate <= 0) return undefined
  const limitAt = last.t + (100 - last.pct) / rate
  const reset = Date.parse(log.resetsAt)
  return { limitAt, isBeforeReset: Number.isNaN(reset) ? false : limitAt < reset }
}

/** How much of the window each half hour used, oldest first; future buckets are null. */
export function buckets(log: RadarLog, now: number): (number | null)[] {
  const reset = Date.parse(log.resetsAt)
  const start = Number.isNaN(reset) ? now - FIVE_HOURS : reset - FIVE_HOURS
  const out: (number | null)[] = []
  let before = 0
  for (let i = 0; i < BUCKETS; i++) {
    const from = start + i * BUCKET
    if (from > now) {
      out.push(null)
      continue
    }
    const inside = log.samples.filter(s => s.t >= from && s.t < from + BUCKET)
    const top = inside.length ? Math.max(...inside.map(s => s.pct)) : before
    out.push(Math.max(0, top - before))
    before = Math.max(before, top)
  }
  return out
}

/** "45m", "1h 05m", "2d 3h". */
export function span(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 60) return `${min}m`
  if (min < 48 * 60) return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`
  return `${Math.floor(min / 1440)}d ${Math.round((min % 1440) / 60)}h`
}

export function resetIn(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const at = Date.parse(iso)
  return Number.isNaN(at) ? '' : `resets in ${span(at - now)}`
}

/** The calendar month a clock time falls in, as "2026-11" (UTC). */
export function monthOf(now: number): string {
  return new Date(now).toISOString().slice(0, 7)
}

export function emptyMonth(now: number): RadarMonth {
  return { month: monthOf(now), hitDays: [], weekPeak: 0 }
}

/** Folds a reading into the month: a day at 100% in any window, and the week's peak. */
export function addToMonth(month: RadarMonth, limits: readonly RadarLimit[], now: number): RadarMonth {
  const base = month.month === monthOf(now) ? month : emptyMonth(now)
  const day = new Date(now).toISOString().slice(0, 10)
  const hit = limits.some(l => (l.kind === 'five_hour' || l.kind === 'seven_day') && l.percentUsed >= 100)
  const week = limits.find(l => l.kind === 'seven_day')
  return {
    month: base.month,
    hitDays: hit && !base.hitDays.includes(day) ? [...base.hitDays, day] : base.hitDays,
    weekPeak: Math.max(base.weekPeak, week ? week.percentUsed : 0),
  }
}

/** A monthly or spend window the account reports, when there is one. */
export function monthlyLimit(limits: readonly RadarLimit[]): RadarLimit | undefined {
  return limits.find(l => l.kind === 'spend_limit' || /month/i.test(l.kind))
}

export function monthText(month: RadarMonth): string {
  const n = month.hitDays.length
  return n === 0 ? 'No limit hit this month' : `${n} ${n === 1 ? 'day' : 'days'} at a limit this month`
}

function esc(s: string): string {
  return s.replace(/[<>&"]/g, c => `&#${c.charCodeAt(0)};`)
}

/** Bars of the burn per half hour, the future ones as stubs. */
export function burnSvg(values: (number | null)[], width: number, height: number): string {
  const top = Math.max(4, ...values.map(v => v ?? 0))
  const gap = 4
  const w = (width - gap * (values.length - 1)) / values.length
  const bars = values.map((v, i) => {
    const x = (i * (w + gap)).toFixed(1)
    if (v === null) return `<rect x="${x}" y="${height - 2}" width="${w.toFixed(1)}" height="2" rx="1" fill="${esc(COLORS.barFaint)}"/>`
    const h = Math.max(2, (v / top) * (height - 2))
    return `<rect x="${x}" y="${(height - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${esc(COLORS.bar)}"/>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bars.join('')}</svg>`
}

/** A thin meter, 0 to 100. */
export function meterSvg(percent: number, width: number, color: string): string {
  const on = (Math.max(0, Math.min(100, percent)) / 100) * width
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="6" viewBox="0 0 ${width} 6"><rect width="${width}" height="6" rx="3" fill="${COLORS.track}"/>${on > 0 ? `<rect width="${on.toFixed(1)}" height="6" rx="3" fill="${esc(color)}"/>` : ''}</svg>`
}

/** A text bar for the terminal. */
export function textBar(percent: number, cells = 10): string {
  const on = Math.round((Math.max(0, Math.min(100, percent)) / 100) * cells)
  return '█'.repeat(on) + '░'.repeat(cells - on)
}

export type { RadarLimit, RadarLog, RadarMonth, RadarSample }
