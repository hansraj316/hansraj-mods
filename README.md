# hansraj-mods

Claude Code mods by hansraj.

| Mod | What it does |
| --- | --- |
| [ship-cockpit](./ship-cockpit) | Guards production deploys and production data, blocks force-push to main, and shows branch, PR, CI checks, last deploy and open issues in a `/ship` pane. |
| [dictation-cleaner](./dictation-cleaner) | Strips fillers, stutters and your usual typos from dictated prompts before Claude reads them. `/dictation` to manage it. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install ship-cockpit --marketplace hansraj316/hansraj-mods
/plugin install dictation-cleaner --marketplace hansraj316/hansraj-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope installs it for every session).

From a shell:

```
claude plugin install ship-cockpit --marketplace hansraj316/hansraj-mods
claude plugin install dictation-cleaner --marketplace hansraj316/hansraj-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `hansraj316/hansraj-mods`, then **Add plugin**.

Mods are advisory, not a security boundary. For hard blocks, also add permission rules in your settings.
