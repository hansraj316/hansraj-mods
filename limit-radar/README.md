# Limit Radar

See your plan's usage before you hit the wall. Limit Radar shows your 5-hour, weekly and monthly usage in one pane, forecasts when you will reach the 5-hour limit at the pace you are going, and warns you when that comes before the window resets. Built for the Code tab of the Claude Desktop app; the terminal shows a text version.

- **The pane** (`/radar`). Your 5-hour window as one big percentage, a bar per half hour showing how much of the window each one used, when the window resets, and when you will hit the limit at your recent pace. Under it, your weekly window and the month.
- **The band.** A line above the prompt once the 5-hour window passes 50% (you can change this), and whenever the forecast lands before the reset. **Hide** puts it away until the next window.
- **One heads-up per window.** A toast the first time the forecast shows you running out before the reset.

## About the monthly row

Claude plans have a 5-hour limit and a weekly limit, and no monthly usage limit. So the Month row shows:

- your **monthly spending cap** for usage credits, as a percentage, when Claude Code reports one for your account; otherwise
- **how many days this month you hit a limit**, from the mod's own record.

The month's record starts the day you install the mod and counts days in UTC.

## How the forecast works

Every time Claude Code reports a new figure for the 5-hour window, the mod keeps a reading. The forecast takes the pace of the last hour and projects it to 100%. It needs a few readings at least five minutes apart before it says anything, and it ignores a pace that is flat. It is a projection, not a promise: a quiet half hour pushes it out again.

## What the mod runs, reads and sends

- **Programs it runs**: none.
- **What it reads**: Claude Code's own rate-limit figures for your plan (the 5-hour and weekly windows, and a spending cap when one is reported). It reads no files.
- **What it stores**: the readings of the current 5-hour window and the month's record, in the mod's store on this machine, so the forecast carries across sessions.
- **What it sends out**: nothing. It makes no network calls and no model calls.
- **What it changes**: nothing. It only shows figures.

On an API key, with no plan limits, the pane says so and stays empty.

## Settings

In `/config`, under Limit Radar:

| Setting | Default | What it does |
| --- | --- | --- |
| Show the band from (%) | `50` | When the line above the prompt appears. It also appears whenever the forecast lands before the reset. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install limit-radar --marketplace hansraj316/hansraj-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope installs it for every session, including the Desktop app's Code tab).

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `hansraj316/hansraj-mods`, then **Add plugin**.
