# hansraj-mods

Claude Code mods by hansraj.

| Mod | What it does |
| --- | --- |
| [ship-cockpit](./ship-cockpit) | Guards production deploys and production data, blocks force-push to main, and shows branch, PR, CI checks, last deploy and open issues in a `/ship` pane, with a Fleet tab and a live ticker of your other projects. |
| [tokentide](./tokentide) | TokenTide: watch the token tide rise. A ring above the prompt, a Rings pane (`/tide`), a prompt-cache countdown and a heads-up before auto-compact. Built for the Desktop app's Code tab. |
| [dictation-cleaner](./dictation-cleaner) | Strips fillers, stutters and your usual typos from dictated prompts before Claude reads them. `/dictation` to manage it. |
| [gearbox](./gearbox) | Gearbox: model and effort presets as one row of chips above the prompt, set to your own taste, with a nudge toward a lighter preset for small tasks. `/gear` to switch or edit. |
| [limit-radar](./limit-radar) | Limit Radar: your 5-hour, weekly and monthly usage in one pane (`/radar`), a forecast of when you'll hit the 5-hour limit at your pace, and a heads-up when that comes before the reset. |
| [waypoints](./waypoints) | Waypoints: pin the reply where a decision landed (`/pin`), then start a new line of work from it with a handoff written for you (`/fork-at`). A map pane shows pins and forks. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install ship-cockpit --marketplace hansraj316/hansraj-mods
/plugin install dictation-cleaner --marketplace hansraj316/hansraj-mods
/plugin install tokentide --marketplace hansraj316/hansraj-mods
/plugin install gearbox --marketplace hansraj316/hansraj-mods
/plugin install limit-radar --marketplace hansraj316/hansraj-mods
/plugin install waypoints --marketplace hansraj316/hansraj-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope installs it for every session).

From a shell:

```
claude plugin install ship-cockpit --marketplace hansraj316/hansraj-mods
claude plugin install dictation-cleaner --marketplace hansraj316/hansraj-mods
claude plugin install tokentide --marketplace hansraj316/hansraj-mods
claude plugin install gearbox --marketplace hansraj316/hansraj-mods
claude plugin install limit-radar --marketplace hansraj316/hansraj-mods
claude plugin install waypoints --marketplace hansraj316/hansraj-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `hansraj316/hansraj-mods`, then **Add plugin**.

Mods are advisory, not a security boundary. For hard blocks, also add permission rules in your settings.
