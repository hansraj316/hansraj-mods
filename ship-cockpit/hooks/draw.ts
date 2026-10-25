// SVG pieces for the graphical surfaces (Desktop, VS Code, mobile), in the same palette as context-halo.

export const C = {
  green: '#30D158',
  amber: '#FF9F0A',
  red: '#FF453A',
  blue: '#0A84FF',
  gray: '#8E8E93',
  track: '#3A3A3C',
  bar: '#636366',
} as const

/** Text colors that read on dark and light grounds. */
export const T = { green: '#28A745', amber: '#E08600', red: '#FF6961', blue: '#409CFF', gray: '#8E8E93' } as const

const NS = 'xmlns="http://www.w3.org/2000/svg"'

export function dotSvg(color: string, size = 8): string {
  const r = size / 2
  return `<svg ${NS} width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${r}" cy="${r}" r="${r}" fill="${color}"/></svg>`
}

export function ringSvg(percent: number, color: string, size = 36, stroke = 5): string {
  const c = size / 2
  const r = c - stroke / 2
  const len = 2 * Math.PI * r
  const on = (Math.max(0, Math.min(100, percent)) / 100) * len
  return (
    `<svg ${NS} width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-opacity="0.25" stroke-width="${stroke}"/>` +
    (on > 0
      ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${on.toFixed(2)} ${len.toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`
      : '') +
    `</svg>`
  )
}

export function progressSvg(percent: number, color: string, width: number, height = 6): string {
  const w = Math.max(0, Math.min(100, percent)) / 100 * width
  return (
    `<svg ${NS} width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="${height / 2}" fill="${C.track}"/>` +
    (w > 0 ? `<rect width="${Math.max(height, w).toFixed(2)}" height="${height}" rx="${height / 2}" fill="${color}"/>` : '') +
    `</svg>`
  )
}

export function sparkSvg(values: readonly number[], width = 34, height = 14): string {
  const max = Math.max(1, ...values)
  const n = values.length || 1
  const w = 3
  const gap = (width - n * w) / Math.max(1, n - 1)
  const bars = values
    .map((v, i) => {
      const barH = Math.max(2, (v / max) * height)
      return `<rect x="${(i * (w + gap)).toFixed(2)}" y="${(height - barH).toFixed(2)}" width="${w}" height="${barH.toFixed(2)}" rx="1" fill="${C.bar}"/>`
    })
    .join('')
  return `<svg ${NS} width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bars}</svg>`
}

export function checksPercent(checks: string | undefined): number {
  return checks === 'passing' || checks === 'failing' ? 100 : checks === 'pending' ? 60 : 0
}

export function checksColor(checks: string | undefined): { fill: string; text: string } {
  if (checks === 'passing') return { fill: C.green, text: T.green }
  if (checks === 'failing') return { fill: C.red, text: T.red }
  if (checks === 'pending') return { fill: C.amber, text: T.amber }
  return { fill: C.gray, text: T.gray }
}
