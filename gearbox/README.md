# Gearbox

Model and effort presets as one row of chips above the prompt. One click switches both, so you stop running Opus at high effort on a variable rename. Built for the Code tab of the Claude Desktop app; the terminal shows the same row as buttons.

- **Three presets, yours to set.** Out of the box: Opus · high, Sonnet · medium, Haiku · low. Press **Edit** in the band to pick the model and effort for each, or change them in `/config` under Gearbox. Your picks are saved to the mod's settings and stay across sessions.
- **One click to switch.** Press a chip to send the rest of this session's requests in that preset. Press it again to go back to the session's own model. The status line names the preset in use.
- **A nudge for small tasks.** When the draft in the prompt box looks like a small, mechanical task (a rename, a typo, a quick question) and a lighter preset exists, the band suggests it with a **Use Sonnet** button. It never switches on its own.
- **Your 5-hour window** at the end of the row, when your plan reports one.
- **`/gear`** lists the presets, `/gear 1` to `/gear 3` picks one, `/gear off` goes back to the session model, `/gear edit` opens the editor.

Subagents keep the model they were started with; Gearbox changes only the main conversation's requests.

## What the mod runs, reads and sends

- **Programs it runs**: none.
- **What it reads**: what you type in the prompt box, as you type, to judge whether it looks like a small task. The text stays in the mod; it is not stored or sent anywhere. It also reads your plan's 5-hour usage figure from Claude Code.
- **What it stores**: the preset in use for this session, in the session's state. Preset choices go to Gearbox's own settings (`/config`).
- **What it sends out**: nothing of its own. It changes the model and effort named on the main conversation's requests while a preset is selected.
- **What it changes**: the model and effort of the main conversation's requests, only while you have a preset selected.

## Settings

In `/config`, under Gearbox:

| Setting | Default | What it does |
| --- | --- | --- |
| Preset 1: model / effort | `opus` / `high` | The first chip. |
| Preset 2: model / effort | `sonnet` / `medium` | The second chip. |
| Preset 3: model / effort | `haiku` / `low` | The third chip. |
| Suggest a lighter preset | `on` | Set `off` to hide the nudge. |

Effort levels are `low`, `medium`, `high`, `xhigh` and `max`. Claude Code lowers a level a model does not support.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install gearbox --marketplace hansraj316/hansraj-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope installs it for every session, including the Desktop app's Code tab).

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `hansraj316/hansraj-mods`, then **Add plugin**.
