import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { cdTarget, envFilesIn, hostsIn, isDbMutation, riskyHost } from './db'

const NEON = 'ep-example-a1b2c3d4.c-4.us-east-1.aws.neon.tech'

test('recognises the database writes this user runs', async () => {
  expect(isDbMutation('npx dotenv -e .env.local -- npx drizzle-kit push')).toBe(true)
  expect(isDbMutation('npm run db:migrate')).toBe(true)
  expect(isDbMutation('pnpm db:seed')).toBe(true)
  expect(isDbMutation('npx tsx scripts/migrate.ts')).toBe(true)
  expect(isDbMutation('npx drizzle-kit generate')).toBe(false)
  expect(isDbMutation('npm run db:generate')).toBe(false)
  expect(isDbMutation('npx vitest run src/lib/soft-delete.test.ts')).toBe(false)
  expect(isDbMutation('git commit -m "migrate settings page"')).toBe(false)
})

test('finds env files, cd targets and hosts', async () => {
  expect(envFilesIn('npx dotenv -e .env.local -- npx drizzle-kit push')).toEqual(['.env.local'])
  expect(envFilesIn('set -a; . ./.env.vercel.local; set +a; npm run db:migrate')).toContain('./.env.vercel.local')
  expect(envFilesIn('export $(cat .env.prod.vercel.local | xargs) && npm run db:migrate')).toEqual(['.env.prod.vercel.local'])
  expect(cdTarget('cd /home/me/projects/app; npm run db:migrate')).toBe('/home/me/projects/app')
  expect(hostsIn(`DATABASE_URL="postgresql://u:p@ep-example-a1b2c3d4-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require"`)).toEqual([NEON])
  expect(hostsIn('PGHOST="ep-example-a1b2c3d4-pooler.c-4.us-east-1.aws.neon.tech"')).toEqual([NEON])
  expect(hostsIn('DATABASE_URL=postgres://dev:dev@localhost:5432/app')).toEqual(['localhost'])
})

test('treats remote hosts as production until marked safe', async () => {
  expect(riskyHost([NEON], {}, new Set())?.why).toBe('remote and not marked safe')
  expect(riskyHost([NEON], { [NEON]: 'safe' }, new Set())).toBeUndefined()
  expect(riskyHost([NEON], { [NEON]: 'safe' }, new Set([NEON]))?.why).toBe('in a production env file')
  expect(riskyHost(['localhost'], {}, new Set())).toBeUndefined()
  expect(riskyHost(['localhost'], { localhost: 'prod' }, new Set())?.why).toBe('marked prod')
})

const FILES: Record<string, string> = {
  '/repo/.env.local': `DATABASE_URL="postgresql://u:p@ep-example-a1b2c3d4-pooler.c-4.us-east-1.aws.neon.tech/neondb"`,
  '/repo/.env.test': 'DATABASE_URL=postgres://t:t@localhost:5432/test',
}

function world(on: On) {
  on('session.cwd', () => ({ value: '/repo' }))
  mock.env(on, { HOME: '/home' })
  mock.store(on)
  on('fs.read', (_, e) => (e.path in FILES ? { value: FILES[e.path]! } : { deny: 'missing' }))
  on('fs.list', () => ({
    value: Object.keys(FILES).map(path => ({ name: path.split('/').pop()!, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
}

test('blocks a migration against the Neon database in .env.local', async ($, on) => {
  world(on)
  let ran = 0
  on('tool.call', { tool: 'Bash' }, () => {
    ran++
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  const out = await $.tool.call({ tool: 'Bash', command: 'npx dotenv -e .env.local -- npx drizzle-kit push', description: 't' })
  expect(String(out.deny)).toContain(NEON)

  const local = await $.tool.call({ tool: 'Bash', command: 'npx dotenv -e .env.test -- npx drizzle-kit push', description: 't' })
  expect(local.deny).toBeUndefined()
  expect(ran).toBe(1)
})
