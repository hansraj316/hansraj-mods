// Pure helpers: pressure levels, formatting, the turns-left estimate and the SVG pieces.

export type Pressure = 'calm' | 'warm' | 'critical'

export const COLORS = {
  calm: '#0A84FF',
  warm: '#FF9F0A',
  critical: '#FF453A',
  cache: '#40C8E0',
  fiveHour: '#5E5CE6',
  week: '#BF5AF2',
  track: '#3A3A3C',
  muted: '#636366',
} as const

/** Text colors that pass contrast on the desktop's dark and light grounds alike. */
export const TEXT = { calm: '#409CFF', warm: '#E08600', critical: '#FF6961' } as const

export const SLICE_COLORS = ['#40C8E0', '#BF5AF2', '#5E5CE6', '#8E8E93', '#64D2FF'] as const

/** Calm below 60%, warm from 60%, critical from `criticalAt`. */
export function pressure(percent: number, criticalAt: number): Pressure {
  if (percent >= criticalAt) return 'critical'
  if (percent >= Math.min(60, criticalAt)) return 'warm'
  return 'calm'
}

export const WORD: Record<Pressure, string> = { calm: 'Calm', warm: 'Warm', critical: 'Critical' }

export function kTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(Math.round(n))
}

/** Adds a reading to the per-turn series; a big drop (compact, clear) starts it over. */
export function pushGrowth(series: readonly number[], percent: number): number[] {
  const last = series[series.length - 1]
  if (last !== undefined && percent < last - 15) return [percent]
  if (last === percent) return [...series]
  return [...series, percent].slice(-24)
}

/** Turns until auto-compact at the recent pace, or undefined when it cannot tell. */
export function turnsLeft(series: readonly number[], percent: number, compactAt: number): number | undefined {
  if (percent >= compactAt) return 0
  const recent = series.slice(-7)
  const steps: number[] = []
  for (let i = 1; i < recent.length; i++) {
    const d = (recent[i] ?? 0) - (recent[i - 1] ?? 0)
    if (d > 0) steps.push(d)
  }
  if (steps.length < 2) return undefined
  const avg = steps.reduce((a, b) => a + b, 0) / steps.length
  if (avg <= 0.2) return undefined
  return Math.max(1, Math.ceil((compactAt - percent) / avg))
}

export function turnsText(n: number | undefined): string {
  if (n === undefined) return 'too few turns yet to time auto-compact'
  if (n === 0) return 'auto-compact is due'
  if (n <= 2) return `${n === 1 ? '1 turn' : '1–2 turns'} before auto-compact`
  return `about ${n} turns before auto-compact`
}

/** Remaining prompt-cache life as m:ss, 'cold' once gone, '—' before the first reply. */
export function cacheText(lastAt: number, now: number, ttlMs: number, isWorking: boolean): string {
  if (!lastAt) return '—'
  if (isWorking) return 'warm'
  const left = ttlMs - (now - lastAt)
  if (left <= 0) return 'cold'
  const s = Math.ceil(left / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function ttlMs(option: unknown): number {
  return option === '1h' ? 60 * 60_000 : 5 * 60_000
}

function esc(s: string): string {
  return s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string)
}

/** One ring (or several concentric ones) as an SVG document. */
export function ringsSvg(rings: { percent: number; color: string }[], size: number, stroke: number): string {
  const c = size / 2
  const parts: string[] = []
  rings.forEach((ring, i) => {
    const r = c - stroke / 2 - i * (stroke + 3)
    if (r <= 2) return
    const len = 2 * Math.PI * r
    const on = Math.max(0, Math.min(100, ring.percent)) / 100 * len
    parts.push(
      `<circle cx="${c}" cy="${c}" r="${r.toFixed(2)}" fill="none" stroke="${esc(ring.color)}" stroke-opacity="0.25" stroke-width="${stroke}"/>`,
      on > 0
        ? `<circle cx="${c}" cy="${c}" r="${r.toFixed(2)}" fill="none" stroke="${esc(ring.color)}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${on.toFixed(2)} ${len.toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`
        : '',
    )
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${parts.join('')}</svg>`
}

/** A segmented bar: one rounded run per slice, 2px apart. */
export function barSvg(slices: { value: number; color: string }[], width: number, height: number): string {
  const total = slices.reduce((a, s) => a + Math.max(0, s.value), 0)
  if (total <= 0)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${height / 2}" fill="${COLORS.track}"/></svg>`
  const gap = slices.length > 1 ? 2 : 0
  const room = width - gap * (slices.length - 1)
  let x = 0
  const rects = slices.map(s => {
    const w = Math.max(1, (Math.max(0, s.value) / total) * room)
    const rect = `<rect x="${x.toFixed(2)}" width="${w.toFixed(2)}" height="${height}" fill="${esc(s.color)}"/>`
    x += w + gap
    return rect
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><clipPath id="r"><rect width="${width}" height="${height}" rx="${height / 2}"/></clipPath><g clip-path="url(#r)">${rects.join('')}</g></svg>`
}

/** Bars for each turn's fill, the last in the pressure color, with a dashed auto-compact line. */
export function growthSvg(series: readonly number[], compactAt: number, accent: string, width: number, height: number): string {
  const n = Math.max(series.length, 1)
  const gap = 4
  const w = Math.max(2, (width - gap * (n - 1)) / n)
  const y = (p: number) => height - (Math.min(100, p) / 100) * height
  const bars = series
    .map((p, i) => {
      const barH = Math.max(2, height - y(p))
      return `<rect x="${(i * (w + gap)).toFixed(2)}" y="${(height - barH).toFixed(2)}" width="${w.toFixed(2)}" height="${barH.toFixed(2)}" rx="2" fill="${i === series.length - 1 ? esc(accent) : COLORS.muted}"/>`
    })
    .join('')
  const line = `<line x1="0" x2="${width}" y1="${y(compactAt).toFixed(2)}" y2="${y(compactAt).toFixed(2)}" stroke="#A1A1A6" stroke-width="1" stroke-dasharray="4 4"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bars}${line}</svg>`
}

/** Text bar for the terminal: ▰▰▰▱▱ */
export function textBar(percent: number, cells = 10): string {
  const on = Math.round((Math.max(0, Math.min(100, percent)) / 100) * cells)
  return '▰'.repeat(on) + '▱'.repeat(cells - on)
}

export function resetText(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const min = Math.max(0, Math.round((at - now) / 60_000))
  if (min < 60) return `resets in ${min}m`
  if (min < 48 * 60) return `resets in ${Math.round(min / 60)}h`
  return `resets in ${Math.round(min / 1440)}d`
}
