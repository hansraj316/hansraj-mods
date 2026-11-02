# Waypoints

Conversations with Claude run in one line. Waypoints lets you mark the reply where a decision landed, then start a new line of work from that point, carrying the context up to it, without scrolling back or pasting a summary by hand. Built for the Code tab of the Claude Desktop app; the terminal uses the commands.

- **Pin a reply.** In the Desktop app, hover over a reply and press **Pin**. Anywhere, `/pin` pins the last reply, and `/pin redis-plan` gives it a name.
- **Fork from a pin.** `/fork-at redis-plan` (or the **Fork** button in the map) has Claude write a handoff of the conversation up to that pin: the goal, decisions and why, the state of the work, open questions and the next step. Then you choose:
  - **Start it here**: the view clears and the handoff goes in as the first message. The conversation you left stays in `/resume`.
  - **Save for later**: open it in any session with `/waypoints open redis-plan`.
- **The map** (`/waypoints`). Your pins in this session, in order, with the forks that came from them, and forks saved from other sessions with an **Open here** button.

`/waypoints list` lists saved forks. The command is `/fork-at` because `/fork` is one of Claude Code's own.

## What the mod runs, reads and sends

- **Programs it runs**: none.
- **What it reads**: this session's messages, to pin a reply and to write the handoff.
- **What it stores**: your pins (per session) and saved forks with their handoff text, in the mod's store on this machine.
- **What it sends out**: when you fork, one request to Claude (Sonnet) on your plan, carrying the conversation up to the pin and asking for the handoff. If that request fails, the handoff is the last few turns as they were. Nothing else leaves your machine.
- **What it changes**: when you choose **Start it here**, it runs `/clear` and sends the handoff as your first message. It asks before doing that, every time.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install waypoints --marketplace hansraj316/hansraj-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope installs it for every session, including the Desktop app's Code tab).

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `hansraj316/hansraj-mods`, then **Add plugin**.
