// Pure text cleaning: no `$`, so every rule is tested on plain strings.

/** Typos from this user's own prompts, then common English ones. Keys are lowercase. */
export const TYPOS: Readonly<Record<string, string>> = {
  defauly: 'default',
  merege: 'merge',
  thenb: 'then',
  tehre: 'there',
  compelte: 'complete',
  fromom: 'from',
  artifcat: 'artifact',
  artifcats: 'artifacts',
  artifcts: 'artifacts',
  incorporte: 'incorporate',
  arcchitercture: 'architecture',
  architecure: 'architecture',
  resturants: 'restaurants',
  resturatants: 'restaurants',
  kirkaldn: 'Kirkland',
  teh: 'the',
  adn: 'and',
  taht: 'that',
  recieve: 'receive',
  seperate: 'separate',
  definately: 'definitely',
  occured: 'occurred',
  untill: 'until',
  wich: 'which',
  becuase: 'because',
  enviroment: 'environment',
  dependancy: 'dependency',
  dependancies: 'dependencies',
  succesful: 'successful',
  sucessful: 'successful',
  udpate: 'update',
  upate: 'update',
  fucntion: 'function',
  funtion: 'function',
  lenght: 'length',
  reponse: 'response',
  repsonse: 'response',
  pls: 'please',
}

export type Cleaned = { text: string; fillers: number; stutters: number; fixes: string[] }

// Spoken hesitations, with the comma or ellipsis dictation leaves after them.
// Marks where a word was removed, so tidying touches only those places.
const GAP = '\u0001'

const FILLER = /(^|[\s(])(?:u+h+m*|u+m+|e+r+m+|h+m+)\b(?:[,.]{1,3}|…)?(?=\s|$)/gi
const YOU_KNOW = /,\s*you know,/gi
// A word said twice in a row; doubles that are often meant are left alone.
const STUTTER = /\b([a-z']+)(\s+\1\b)+/gi
const MEANT_TWICE = new Set(['that', 'had', 'is', 'very', 'no', 'so', 'bye', 'ha', 'really', 'go'])

// Code, URLs, paths, flags and @mentions are never touched.
const PROTECTED = /```[\s\S]*?```|`[^`\n]*`|https?:\/\/\S+|(?:~|\.{1,2})?\/[\w./@-]+|@[\w./-]+|(?<!\w)--?[\w-]+|\b\w+\.\w{1,5}\b/g

function cleanProse(prose: string, extra: Readonly<Record<string, string>>, out: Cleaned): string {
  let text = prose.replace(FILLER, (_, lead: string) => {
    out.fillers++
    return lead + GAP
  })
  text = text.replace(YOU_KNOW, () => {
    out.fillers++
    return ',' + GAP
  })
  text = text.replace(STUTTER, (all, word: string) => {
    if (MEANT_TWICE.has(word.toLowerCase())) return all
    out.stutters++
    return word
  })
  text = text.replace(/\b[a-z]+\b/gi, word => {
    const fix = extra[word.toLowerCase()] ?? TYPOS[word.toLowerCase()]
    if (!fix || fix === word) return word
    const fixed = word[0] === word[0]!.toUpperCase() && fix[0] === fix[0]!.toLowerCase() ? fix[0]!.toUpperCase() + fix.slice(1) : fix
    out.fixes.push(`${word}→${fixed}`)
    return fixed
  })
  return text
}

/**
 * Tidies the gaps removed words left: the spaces and commas around them, and
 * a sentence that now starts lowercase. Text away from a gap is left as typed.
 * `isFirst` marks the stretch that opens the prompt, where a gap at the very
 * start is a sentence start.
 */
function tidy(text: string, isFirst: boolean): string {
  const start = isFirst ? '^|' : ''
  return text
    .replace(new RegExp(`(${start}[.?!]\\s+|\\n[ \\t]*)((?:\\s*${GAP}[\\s,;:]*)+)([a-z])`, 'g'), (_, lead: string, _gap: string, letter: string) => lead + letter.toUpperCase())
    .replace(new RegExp(`(${start}[.?!]\\s+|\\n[ \\t]*)(?:\\s*${GAP}[\\s,;:]*)+`, 'g'), '$1')
    .replace(new RegExp(`[ \\t]*${GAP}[ \\t]*([,.?!;:])`, 'g'), '$1')
    .replace(new RegExp(`([,;:])[ \\t]*${GAP}[ \\t]*[,;:]`, 'g'), '$1')
    .replace(new RegExp(`(\\S)[ \\t]*${GAP}[ \\t]*(?=\\S)`, 'g'), '$1 ')
    .replace(new RegExp(`[ \\t]*${GAP}[ \\t]*`, 'g'), '')
}

export function clean(input: string, extra: Readonly<Record<string, string>> = {}): Cleaned {
  const out: Cleaned = { text: input, fillers: 0, stutters: 0, fixes: [] }
  const parts: { text: string; isProse: boolean }[] = []
  let last = 0
  for (const match of input.matchAll(PROTECTED)) {
    parts.push({ text: input.slice(last, match.index), isProse: true }, { text: match[0], isProse: false })
    last = match.index + match[0].length
  }
  parts.push({ text: input.slice(last), isProse: true })
  const cleaned = parts.map(part => (part.isProse ? cleanProse(part.text, extra, out) : part.text))
  // A prompt with nothing to clean stays byte for byte.
  if (out.fillers + out.stutters + out.fixes.length === 0) return out
  out.text = cleaned
    .map((text, i) => (parts[i]!.isProse ? tidy(text, i === 0) : text))
    .join('')
    .trim()
  return out
}

export function summary(c: Cleaned): string {
  const parts = [
    c.fillers ? `${c.fillers} filler${c.fillers > 1 ? 's' : ''}` : '',
    c.stutters ? `${c.stutters} repeat${c.stutters > 1 ? 's' : ''}` : '',
    c.fixes.length ? c.fixes.slice(0, 4).join(', ') + (c.fixes.length > 4 ? '…' : '') : '',
  ].filter(Boolean)
  return `Cleaned ${parts.join(' · ')}`
}
