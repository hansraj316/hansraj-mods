import { expect, test } from 'claude-code/testing'

import { classify } from './rules'

test('classifies the deploy commands this user actually runs', async () => {
  expect(classify('mv .git .git.bak && vercel deploy --prebuilt --prod --yes --scope my-team 2>&1 | tail -6').kind).toBe('prod-deploy')
  expect(classify('vercel deploy --prod --yes --scope my-team').kind).toBe('prod-deploy')
  expect(classify('npx vercel --scope my-team --prod').kind).toBe('prod-deploy')
  expect(classify('vercel promote https://x.vercel.app').kind).toBe('prod-deploy')
  expect(classify('printf demo | vercel env add SECRET production').kind).toBe('prod-deploy')
})

test('leaves local builds, pulls and reads alone', async () => {
  expect(classify('vercel pull --yes --environment=production --scope my-team && vercel build --prod').kind).toBe('ok')
  expect(classify('vercel ls --scope my-team | head').kind).toBe('ok')
  expect(classify('vercel deploy --yes').kind).toBe('ok')
  expect(classify('gh pr merge 202 --squash --delete-branch').kind).toBe('ok')
  expect(classify('git commit -m "fix production DELETE FROM bug"').kind).toBe('ok')
})

test('flags production data changes and force pushes to main', async () => {
  expect(classify('DATABASE_URL=$PROD npx drizzle-kit push --config drizzle.prod.ts').kind).toBe('prod-data')
  expect(classify('npm run db:migrate -- --env production').kind).toBe('prod-data')
  expect(classify("psql \"$DATABASE_URL\" <<'SQL'\nDELETE FROM expenses;\nSQL # production").kind).toBe('prod-data')
  expect(classify('npx drizzle-kit push').kind).toBe('ok')
  expect(classify('git push --force origin main').kind).toBe('force-push-main')
  expect(classify('git push --force-with-lease origin feature/x').kind).toBe('ok')
})

const run = (command: string) => ({ tool: 'Bash' as const, command, description: 'test' })

test('denies production data changes without running them', async ($, on) => {
  let ran = false
  on('tool.call', { tool: 'Bash' }, () => {
    ran = true
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  const out = await $.tool.call(run('npx drizzle-kit migrate --env production'))
  expect(String(out.deny)).toContain('PRODUCTION data')
  expect(ran).toBe(false)
})

test('asks before a production deploy and runs it only on "Deploy"', async ($, on) => {
  let deploys = 0
  let answer = 'Cancel'
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => ({
    result: { questions: e.questions, answers: { [e.questions[0]!.question]: answer } },
  }))
  on('tool.call', { tool: 'Bash' }, () => {
    deploys++
    return { result: { stdout: 'deployed', stderr: '', interrupted: false } }
  })

  const cancelled = await $.tool.call(run('vercel deploy --prod --yes'))
  expect(String(cancelled.deny)).toContain('not confirmed')
  expect(deploys).toBe(0)

  answer = 'Deploy'
  const shipped = await $.tool.call(run('vercel deploy --prod --yes'))
  expect(shipped.deny).toBeUndefined()
  expect(deploys).toBe(1)
})
