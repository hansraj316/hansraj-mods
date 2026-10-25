# dictation-cleaner

Cleans dictated prompts (Wispr Flow etc.) before Claude reads them:

- removes fillers (`uh`, `um`, `erm`, `hmm`, `, you know,`) and tidies the commas and capitals they leave behind
- collapses stutters (`the the` → `the`), but keeps doubles that are often meant (`that that`, `had had`)
- fixes your usual typos (compelte, merege, defauly, tehre, artifcat, arcchitercture…) plus common English ones
- never touches code fences, `inline code`, URLs, paths, `--flags`, `@mentions` or file names
- a toast shows what changed; slash commands, hidden prompts and headless (`claude -p`) prompts are never rewritten

Commands: `/dictation` (status), `/dictation off|on`, `/dictation add wrong=right`, `/dictation remove wrong`, `/dictation test <text>`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install dictation-cleaner --marketplace hansraj316/hansraj-mods
```

Answer `y` to add the marketplace, then pick a scope. From a shell: `claude plugin install dictation-cleaner --marketplace hansraj316/hansraj-mods`.
