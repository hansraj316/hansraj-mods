# dictation-cleaner

Cleans dictated prompts (Wispr Flow etc.) before Claude reads them:

- removes fillers (`uh`, `um`, `erm`, `hmm`, `, you know,`) and tidies the commas and capitals they leave behind
- collapses stutters (`the the` → `the`), but keeps doubles that are often meant (`that that`, `had had`)
- fixes your usual typos (compelte, merege, defauly, tehre, artifcat, arcchitercture…) plus common English ones
- never touches code fences, `inline code`, URLs, paths, `--flags`, `@mentions` or file names
- a toast shows what changed; slash commands, hidden prompts and headless (`claude -p`) prompts are never rewritten

## What the mod reads, changes and sends

- **What it reads**: the text of each prompt you type or dictate, at the moment you submit it. Slash commands, hidden prompts and headless (`claude -p`) prompts are never read or changed.
- **What it changes**: it rewrites that prompt text before Claude sees it, removing fillers and stutters and applying the typo corrections listed in `clean.ts` plus any you add with `/dictation add`. A toast shows what changed. A prompt with nothing to clean is passed through unchanged.
- **What it stores**: your on/off setting and the corrections you add, in the plugin's own local store on your machine.
- **What it sends out**: nothing. The mod makes no network calls, runs no programs and reads no files.

Commands: `/dictation` (status), `/dictation off|on`, `/dictation add wrong=right`, `/dictation remove wrong`, `/dictation test <text>`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install dictation-cleaner --marketplace hansraj316/hansraj-mods
```

Answer `y` to add the marketplace, then pick a scope. From a shell: `claude plugin install dictation-cleaner --marketplace hansraj316/hansraj-mods`.
