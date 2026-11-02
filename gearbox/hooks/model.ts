// Gearbox's pure logic: presets from settings, labels, and the "light task" check.

export const MODELS = ['opus', 'sonnet', 'haiku'] as const
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export type Model = (typeof MODELS)[number]
export type Effort = (typeof EFFORTS)[number]
export type Gear = { model: Model; effort: Effort }

const DEFAULTS: Gear[] = [
  { model: 'opus', effort: 'high' },
  { model: 'sonnet', effort: 'medium' },
  { model: 'haiku', effort: 'low' },
]

function isModel(v: unknown): v is Model {
  return typeof v === 'string' && (MODELS as readonly string[]).includes(v)
}

function isEffort(v: unknown): v is Effort {
  return typeof v === 'string' && (EFFORTS as readonly string[]).includes(v)
}

/** The three presets from the mod's settings, falling back to the defaults field by field. */
export function gearsFrom(options: Record<string, unknown>): Gear[] {
  return DEFAULTS.map((d, i) => {
    const model = options[`gear${i + 1}Model`]
    const effort = options[`gear${i + 1}Effort`]
    return { model: isModel(model) ? model : d.model, effort: isEffort(effort) ? effort : d.effort }
  })
}

const SHORT: Record<Effort, string> = { low: 'low', medium: 'med', high: 'high', xhigh: 'x-high', max: 'max' }

export function modelName(m: Model): string {
  return m[0]!.toUpperCase() + m.slice(1)
}

export function label(g: Gear): string {
  return `${modelName(g.model)} · ${SHORT[g.effort]}`
}

const MODEL_WEIGHT: Record<Model, number> = { haiku: 1, sonnet: 2, opus: 3 }
const EFFORT_WEIGHT: Record<Effort, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 }

/** How heavy a preset is: the model first, then the effort. */
export function weight(g: Gear): number {
  return MODEL_WEIGHT[g.model] * 10 + EFFORT_WEIGHT[g.effort]
}

/**
 * The preset to suggest for a light task: the lightest one that still is not
 * Haiku at its lowest unless that is all there is, and only when it is lighter
 * than the one in use. `current` is the preset in use, or null for the
 * session's own model (treated as the heaviest preset).
 */
export function lighterGear(gears: Gear[], current: number | null): number | null {
  const heaviest = Math.max(...gears.map(weight))
  const now = current === null ? heaviest : weight(gears[current]!)
  const lighter = gears
    .map((g, i) => ({ i, w: weight(g), m: g.model }))
    .filter(x => x.w < now)
    .sort((a, z) => z.w - a.w)
  // Prefer the next step down that is not Haiku: a quick edit still wants a capable model.
  const pick = lighter.find(x => x.m !== 'haiku') ?? lighter[0]
  return pick ? pick.i : null
}

const LIGHT_START =
  /^(rename|fix (the |a |this )?typo|typo|format|reformat|lint|add (a )?(comment|docstring|log)|remove (the |a |this )?(comment|log|import|unused)|sort|bump|update (the )?(version|copyright|year)|what('?s| is| does)|where('?s| is)|which|show me|list|explain (this|the) (line|error)|convert|translate)\b/i
const HEAVY =
  /\b(refactor|architect|architecture|design|debug|investigate|root cause|plan|implement|build|migrat\w*|across|entire|whole|every file|all files|performance|security|review|why does|why is)\b/i

/** A rough guess that a draft is a small, mechanical task. Cheap enough for every keystroke. */
export function isLight(draft: string): boolean {
  const text = draft.trim()
  if (text.length < 8 || text.length > 160) return false
  if (text.startsWith('/')) return false
  if (text.includes('```') || text.split('\n').length > 2) return false
  if (HEAVY.test(text)) return false
  return LIGHT_START.test(text)
}

/** The draft after one prompt.edit, from the edit's span and what goes in it. */
export function applyEdit(text: string, start: number, end: number, inputText: string): string {
  return text.slice(0, start) + inputText + text.slice(end)
}
