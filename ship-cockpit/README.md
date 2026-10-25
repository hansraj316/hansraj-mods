# ship-cockpit

A Claude Code mod for the commit → PR → merge → deploy loop.

- **Production deploy guard**: `vercel --prod`, `vercel deploy --prod`, `promote`, `rollback`, `redeploy`, `alias set` and `vercel env add|rm ... production` stop and ask you first (Cancel / Deploy). The question warns you if you're not on main, have uncommitted changes or the PR checks are failing. Anything other than **Deploy**, or dismissing the question, refuses the command.
- **Production data lock**: for every command that writes to a database (drizzle-kit push/migrate/drop, prisma migrate/db push, `db:*` scripts except generate/check/studio, `tsx|node scripts/*migrate*|*seed*|…`, or psql/neon with mutating SQL), it works out which database the command reaches:
  - the URL written in the command, or the env files it names (`dotenv -e`, `--env-file`, `source`, `$(cat .env.x)`);
  - otherwise `.env.local`, `.env` and `$DATABASE_URL`, in the folder the command `cd`s into.

  It refuses the command when that host is marked prod, appears in a `.env*prod*` file, or is remote and not marked safe. Localhost always passes. Commands that mention production are refused too.
  - `/ship db` shows which database a migration here would reach, and the hosts you've marked.
  - `/ship db safe <host>` / `/ship db prod <host>` / `/ship db forget <host>`. Only you, typing at the prompt, can mark a database safe. Marks are kept across sessions, and a host in a prod env file can never be marked safe.
- **No force-push to main.**
- **Ship pane** (`/ship`): branch, HEAD, uncommitted/ahead/behind, the branch's PR and its checks, the last production deploy, and the 5 most recently updated open issues. It refreshes every minute and after any git/gh/vercel command.
- **`/ship go`**: asks Claude to test, commit, open a PR, wait for checks, merge, deploy (with the guard's confirmation) and smoke-test.
- **Status line**: `⛵ branch · N uncommitted · PR #n checks`.

Mods are advisory, not a security boundary. For hard blocks, also add permission rules (e.g. `"deny": ["Bash(vercel deploy --prod:*)"]`) in settings.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install ship-cockpit --marketplace hansraj316/hansraj-mods
```

Answer `y` to add the marketplace, then pick a scope. From a shell: `claude plugin install ship-cockpit --marketplace hansraj316/hansraj-mods`.
