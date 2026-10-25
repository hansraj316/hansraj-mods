import { expect, test } from 'claude-code/testing'

import { clean } from './clean'

const cleaned = (text: string, extra?: Record<string, string>) => clean(text, extra).text

test('cleans real dictated prompts from this user', async () => {
  expect(cleaned('have uh, some Indian restaurants, specific section for Indian restaurants or like a filter on top of that uh, page. Uh, but I need extensively all Indian restaurants')).toBe(
    'have some Indian restaurants, specific section for Indian restaurants or like a filter on top of that page. But I need extensively all Indian restaurants',
  )
  expect(cleaned('Ok can you check what is compelte on this and complete all the changes')).toBe('Ok can you check what is complete on this and complete all the changes')
  expect(cleaned('Also, can you do a search on what\'s available on the internet for these Claude mods? Uh,')).toBe(
    "Also, can you do a search on what's available on the internet for these Claude mods?",
  )
  expect(cleaned('project, I have a requirement where uh, I want to make sure')).toBe('project, I have a requirement where I want to make sure')
})

test('removes stutters but keeps doubles that are meant', async () => {
  expect(cleaned('can you fix the the bug')).toBe('can you fix the bug')
  expect(cleaned('I think that that is fine')).toBe('I think that that is fine')
})

test('fixes typos, keeping a capital, and uses added corrections', async () => {
  expect(cleaned('Teh PR needs a merege')).toBe('The PR needs a merge')
  expect(cleaned('deploy to vercell', { vercell: 'Vercel' })).toBe('deploy to Vercel')
  expect(clean('tehre and merege').fixes).toEqual(['tehre→there', 'merege→merge'])
})

test('never touches code, paths, URLs or flags', async () => {
  const code = 'uh run this:\n```\n  um  =  teh(1)\n```\nand `teh --um` in ./src/um.ts or https://x.dev/uh'
  expect(cleaned(code)).toBe('Run this:\n```\n  um  =  teh(1)\n```\nand `teh --um` in ./src/um.ts or https://x.dev/uh')
})

test('leaves a clean prompt byte for byte', async () => {
  const text = '1. npm install\n2.  run   tests  '
  expect(clean(text).text).toBe(text)
  expect(cleaned('umbrella, humming and umami')).toBe('umbrella, humming and umami')
})
