# context-halo

See how full Claude's context window is at a glance, before auto-compact surprises you. Built for the Code tab of the Claude Desktop app. The terminal and VS Code show a text version.

- **Halo above the prompt.** A small ring, the percentage, tokens used out of the window, and a prompt-cache countdown. It stays quiet below 60% (Calm), adds the word Warm from 60%, and turns red with a **Compact** button at the critical line (92% by default). **Details** opens a breakdown of what is in context (messages, tools, memory files and so on) and an estimate of how many turns are left before auto-compact.
- **Rings pane** (`/halo`). Concentric rings for context, prompt-cache hit rate and your 5-hour plan window, with the weekly window listed below. The **Now** tab shows the breakdown, and **Turns** charts the fill after each turn against the auto-compact line.
- **Heads-ups.** One toast when context passes 80%, one at the critical line, and a nudge when the prompt cache has about a minute left.
- **Compact with a check.** Every Compact button, and `/halo compact`, asks before it compacts.

All figures come from Claude Code itself (`$.session.usage()` and its measurements). The breakdown uses the local estimate, so the mod makes no extra API calls.

## What the mod runs, reads and sends

- **Programs it runs**: none.
- **What it reads**: Claude Code's own usage figures for this session (context fill, the plan's rate-limit windows, the per-category estimate `/context` shows, and each reply's token counts for the cache hit rate). It reads no files.
- **What it stores**: the session's readings (fill per turn, the last breakdown, when the last reply finished) in the session's own state. Nothing is kept across sessions.
- **What it sends out**: nothing. It makes no network calls, and the breakdown uses the local estimate, so it adds no API requests.
- **What it changes**: only when you press Compact (or type `/halo compact`) and confirm, it asks Claude Code to compact the conversation.

## Settings

In `/config`, under context-halo:

| Setting | Default | What it does |
| --- | --- | --- |
| Prompt cache lifetime | `5m` | Set `1h` if your account uses the long prompt cache. |
| Heads-up at (%) | `80` | When the first toast shows. |
| Critical at (%) | `92` | When the halo turns red and shows Compact. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install context-halo --marketplace hansraj316/hansraj-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope installs it for every session, including the Desktop app's Code tab).

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `hansraj316/hansraj-mods`, then **Add plugin**.
