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
- **Ship pane** (`/ship`): branch, HEAD, uncommitted/ahead/behind, the branch's PR with a checks ring, the last production deploy, and the 5 most recently updated open issues. It refreshes every minute and after any git/gh/vercel command. In the Desktop app's Code tab it draws as native cards with **Refresh** and **Ship it** buttons (Ship it asks before it starts); the terminal keeps the compact text view.
- **Fleet** (`/ship fleet`): a second tab with your other projects. Add one with `/ship fleet add <path>` (no path adds the current folder) and drop one with `/ship fleet remove <name>`; up to 12. Each project shows a status (Failing, Needs you, Healthy, Quiet), its most urgent news (main's CI failing, a PR's checks failing, running or ready to merge, uncommitted work, or the last commit), the progress of its first open GitHub milestone, and a 7-day commit sparkline.
- **Fleet ticker**: once the fleet has a project, a line above the prompt turns through them every 5 seconds, most urgent first. **Pause** holds it; clicking a project's name opens the Fleet tab.
- **`/ship go`**: asks Claude to test, commit, open a PR, wait for checks, merge, deploy (with the guard's confirmation) and smoke-test.
- **Status line**: `⛵ branch · N uncommitted · PR #n checks`.

## What the mod runs, reads and sends

- **Programs it runs**: `git` (branch, HEAD, status, ahead/behind counts) and `gh` (`gh pr view`, `gh issue list`) in the current folder, to fill the pane and status line. For each Fleet project, every 3 minutes: `git` (branch, status, the last commit, commit times for the last 7 days, origin's default branch) and `gh` (`gh pr list`, `gh run list` for the default branch, and `gh api` for the first open milestone) in that project's folder. Nothing else is started.
- **Files it reads**: when a command would write to a database, it reads the env files that command names, or `.env.local` and `.env` in the target folder, and the `DATABASE_URL` and `HOME` environment variables. It only parses the database **hostname** out of them to decide whether the target is production. Credentials in those files are never stored, shown or sent anywhere.
- **What it stores**: database host marks (safe/prod), the last 20 production deploys and the Fleet's list of folders, in the plugin's own local store on your machine.
- **What it sends out**: nothing. The mod makes no network calls of its own; `gh` talks to GitHub with your own sign-in to read PRs, runs and milestones. `/ship go` submits a fixed prompt to Claude (the shipping checklist above) and nothing from your files or conversation is put into it.
- **Hooks**: it hooks every `Bash` tool call to classify it (deploy, data change, force-push) and either lets it through, asks you, or refuses it. It never rewrites the command.

Mods are advisory, not a security boundary. For hard blocks, also add permission rules (e.g. `"deny": ["Bash(vercel deploy --prod:*)"]`) in settings.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install ship-cockpit --marketplace hansraj316/hansraj-mods
```

Answer `y` to add the marketplace, then pick a scope. From a shell: `claude plugin install ship-cockpit --marketplace hansraj316/hansraj-mods`.
