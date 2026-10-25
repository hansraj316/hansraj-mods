// Pure command classification: no `$`, so the guard judges from the text alone.

export type Verdict =
  | { kind: 'prod-deploy'; segment: string }
  | { kind: 'prod-data'; segment: string }
  | { kind: 'force-push-main'; segment: string }
  | { kind: 'ok' }

const PROD_MARKER = /production|(^|[\s=:/._-])prod($|[\s=:/._-])|\.env\.vercel/i

const DB_MUTATION = new RegExp(
  [
    String.raw`drizzle-kit\s+(push|migrate|drop|up)`,
    String.raw`\b(npm|pnpm|yarn|bun)\s+(run\s+)?db:(push|migrate|reset|seed|drop|wipe)`,
    String.raw`prisma\s+(migrate\s+(deploy|reset|dev)|db\s+(push|execute|seed))`,
    String.raw`\b(psql|neon|neonctl|mysql|sqlite3|turso)\b.*\b(DELETE\s+FROM|TRUNCATE|DROP\s+(TABLE|SCHEMA|DATABASE)|ALTER\s+TABLE|UPDATE\s+\w+\s+SET|INSERT\s+INTO)\b`,
  ].join('|'),
  'i',
)

/** Splits a shell line into the commands it chains, quotes ignored. */
export function segments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\||\n/)
    .map(part => part.trim())
    .filter(Boolean)
}

// Subcommands that never ship a deployment (`vercel build --prod` builds locally).
const NON_DEPLOY = new Set(
  'build pull ls list inspect logs link login logout whoami project projects integration dev domains dns certs teams switch git curl open help init telemetry blob cache flags metrics ai-gateway global-config edge-config microfrontends mcp'.split(' '),
)

function isVercelProdDeploy(segment: string): boolean {
  const vercel = segment.match(/(?:^|\s|\/)vercel(?:\s+(.*))?$/)
  if (!vercel) return false
  const rest = vercel[1] ?? ''
  const sub = rest.split(/\s+/).find(word => word && !word.startsWith('-')) ?? ''
  if (/^(promote|rollback|redeploy)$/.test(sub)) return true
  if (/^(alias)$/.test(sub) && /\bset\b/.test(rest)) return true
  if (/^env$/.test(sub)) return /\b(add|rm|remove|update)\b/.test(rest) && /production/.test(rest)
  if (NON_DEPLOY.has(sub)) return false
  return /(^|\s)--prod\b|--target[= ]production\b|--environment[= ]production\b/.test(rest)
}

export function classify(command: string): Verdict {
  if (PROD_MARKER.test(command) && DB_MUTATION.test(command.replace(/\n/g, ' ')))
    return { kind: 'prod-data', segment: command.split('\n')[0] ?? command }
  for (const segment of segments(command)) {
    if (isVercelProdDeploy(segment)) return { kind: 'prod-deploy', segment }
    if (/\bgit\s+push\b/.test(segment) && /(\s-f\b|--force)/.test(segment) && /\b(main|master)\b/.test(segment))
      return { kind: 'force-push-main', segment }
  }
  return { kind: 'ok' }
}

/** True when the command is worth refreshing the cockpit after. */
export function touchesShipState(command: string): boolean {
  return /\b(git|gh|vercel)\b/.test(command)
}
