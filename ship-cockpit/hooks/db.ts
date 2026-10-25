// Pure parsing for the database guard: which commands change a database, and
// which database hosts a command or an env file points at.

export type HostMark = 'safe' | 'prod'

const MUTATION = [
  String.raw`drizzle-kit\s+(push|migrate|drop|up)\b`,
  String.raw`\b(npm|pnpm|yarn|bun)\s+(run\s+)?db:(?!(generate|check|studio)\b)[\w:-]+`,
  String.raw`prisma\s+(migrate\s+(deploy|reset|dev)|db\s+(push|execute|seed))`,
  String.raw`\b(tsx|ts-node|node|bun)\s+\S*(migrat|seed|reset|wipe|backfill|purge|delete)\S*`,
  String.raw`\b(psql|neon|neonctl|mysql|sqlite3|turso)\b.*\b(DELETE\s+FROM|TRUNCATE|DROP\s+(TABLE|SCHEMA|DATABASE)|ALTER\s+TABLE|UPDATE\s+\w+\s+SET|INSERT\s+INTO)\b`,
].map(source => new RegExp(source, 'i'))

/** True when the command would write to a database (migrations, pushes, seeds, mutating SQL). */
export function isDbMutation(command: string): boolean {
  const flat = command.replace(/\n/g, ' ')
  return MUTATION.some(pattern => pattern.test(flat))
}

const unquote = (word: string) => word.replace(/^['"]|['"]$/g, '')

/** Env files the command loads explicitly: `dotenv -e f`, `--env-file=f`, `source f`, `. f`. */
export function envFilesIn(command: string): string[] {
  const files: string[] = []
  const patterns = [
    /\bdotenv(?:-cli)?\s+(?:-\w+\s+)*?-e\s+(\S+)/g,
    /--env-file[= ](\S+)/g,
    /(?:^|[;&|]\s*|\s)(?:source|\.)\s+(\S*\.env\S*)/g,
    // Any other env file the line names (`export $(cat .env.prod)`, `set -a; . ./.env.vercel.local`).
    /(?:^|[\s'"(=<])((?:[\w~.-]*\/)*\.env(?:\.[\w-]+)*)(?=$|[\s'");|&])/g,
  ]
  for (const pattern of patterns)
    for (const match of command.matchAll(pattern)) if (match[1]) files.push(unquote(match[1]))
  return [...new Set(files)].filter(file => !/\.env\.example$/.test(file))
}

/** The last `cd <dir>` that runs before the command's first database write, if any. */
export function cdTarget(command: string): string | undefined {
  let dir: string | undefined
  for (const part of command.split(/&&|;|\n/)) {
    const cd = part.trim().match(/^cd\s+(\S+)/)
    if (cd?.[1]) dir = unquote(cd[1])
    else if (isDbMutation(part)) break
  }
  return dir
}

/** Lowercases a host and folds Neon's pooled endpoint into the direct one. */
export function normalizeHost(host: string): string {
  return unquote(host).toLowerCase().replace(/^(ep-[a-z0-9-]+?)-pooler\./, '$1.')
}

/** Database hosts named in a command line or an env file's text. */
export function hostsIn(text: string): string[] {
  const hosts = new Set<string>()
  for (const match of text.matchAll(/\b(?:postgres(?:ql)?|mysql|mariadb|libsql|mongodb(?:\+srv)?):\/\/(?:[^@\s'"/]*@)?([^:/?\s'"]+)/gi))
    if (match[1]) hosts.add(normalizeHost(match[1]))
  for (const match of text.matchAll(/^\s*(?:export\s+)?(?:PGHOST|POSTGRES_HOST|DB_HOST)\s*=\s*['"]?([^'"\s#]+)/gim))
    if (match[1]) hosts.add(normalizeHost(match[1]))
  return [...hosts]
}

export function isLocalHost(host: string): boolean {
  return /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1|\[::1\]|host\.docker\.internal|db|postgres)$/.test(host)
}

/** An env file whose name says production (`.env.production`, `.env.prod.vercel.local`). */
export function isProdEnvFile(name: string): boolean {
  return /^\.env\b.*\bprod/i.test(name)
}

export type HostVerdict = { host: string; why: 'marked prod' | 'in a production env file' | 'remote and not marked safe' }

/**
 * The first target host that must be treated as production, or undefined.
 * A host marked safe passes, a local host passes, anything else remote is production.
 */
export function riskyHost(
  targets: readonly string[],
  marks: Readonly<Record<string, HostMark>>,
  prodFileHosts: ReadonlySet<string>,
): HostVerdict | undefined {
  for (const host of targets) {
    const mark = marks[host]
    if (mark === 'prod') return { host, why: 'marked prod' }
    if (prodFileHosts.has(host)) return { host, why: 'in a production env file' }
    if (mark === 'safe' || isLocalHost(host)) continue
    return { host, why: 'remote and not marked safe' }
  }
  return undefined
}
