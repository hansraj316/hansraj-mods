import type { EngineInterface, Register } from 'claude-code'

import { clean, summary } from './clean'

const OFF_KEY = 'off'
const WORDS_KEY = 'words'

async function extraWords($: EngineInterface): Promise<Record<string, string>> {
  return ((await $.store.get(WORDS_KEY)) as Record<string, string> | undefined) ?? {}
}

const USAGE = 'Usage: /dictation [on | off | add <wrong>=<right> | remove <wrong> | test <text>]'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'dictation',
      description: 'Dictation cleaner: on/off, add a correction, or test a sentence',
      argumentHint: '[on|off|add wrong=right|remove wrong|test <text>]',
    })
    return started
  })

  on('command.run', { command: 'dictation' }, async ($, e) => {
    const [action = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ')
    if (action === 'off' || action === 'on') {
      await $.store.set(OFF_KEY, action === 'off')
      return { text: `Dictation cleaner is ${action}.` }
    }
    if (action === 'add') {
      const pair = arg.match(/^([A-Za-z]+)\s*=\s*(\S.*)$/)
      if (!pair) return { text: USAGE }
      const words = { ...(await extraWords($)), [pair[1]!.toLowerCase()]: pair[2]!.trim() }
      await $.store.set(WORDS_KEY, words)
      return { text: `Will correct "${pair[1]}" to "${pair[2]!.trim()}".` }
    }
    if (action === 'remove') {
      const words = { ...(await extraWords($)) }
      delete words[arg.toLowerCase()]
      await $.store.set(WORDS_KEY, words)
      return { text: `Removed "${arg}".` }
    }
    if (action === 'test') return { text: clean(arg, await extraWords($)).text }
    if (action !== '') return { text: USAGE }
    const isOff = (await $.store.get(OFF_KEY)) === true
    const words = Object.entries(await extraWords($)).map(([w, r]) => `${w}→${r}`)
    return {
      text: `Dictation cleaner is ${isOff ? 'off' : 'on'}. Your corrections: ${words.join(', ') || 'none yet'}.\n${USAGE}`,
    }
  })

  on('prompt.submit', async ($, e, next) => {
    // Only what the person typed or dictated; slash commands and hidden prompts take no rewrite.
    if (e.command || e.isMeta || (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge')) return next(e)
    if ((await $.store.get(OFF_KEY)) === true) return next(e)
    const result = clean(e.text, await extraWords($))
    if (result.text === e.text || result.text === '') return next(e)
    $.ui.toast(summary(result))
    return next({ ...e, text: result.text })
  })
}
