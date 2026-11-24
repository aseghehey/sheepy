# Sheepy

A chat for Claude Code sessions. Sheepy shows the conversations of the
Claude Code sessions running in [herdr-core](https://herdr.dev) terminals,
here and on other machines, live, and lets you talk to them: send messages,
answer their questions, stop them, read their sub-agents.

It's a [Tauri](https://tauri.app) app: a Rust side that drives herdr-core,
and a web window (macOS's own WebKit) for the chat, so text works the way it
does in any Mac app: editing keys, right-click, spelling, Look Up, Services,
dictation, accessibility.

## How it works

- **Sessions** come from `herdr-core events --json`, which sends every
  terminal (its program, status, the window it's in) whenever anything
  changes. Sessions are grouped by their window (Herdr's space and tab).
- **A session's log** is found from its Claude Code process
  (`~/.claude/sessions/<pid>.json` names the session; its log is
  `~/.claude/projects/*/<session>.jsonl`), on whichever machine it runs.
- **Following a log** uses herdr-search on that machine: the end of the log
  first, then `follow --wait`, which returns as soon as new lines are written
  (a plain `tail` every two seconds without herdr-search).
- **Sub-agents** are the `agent-<id>.jsonl` logs beside a session, with the
  `.meta.json` Claude Code writes for each (what it was asked, its type,
  whether it finished). Each Task call in the conversation links to its own.
- **Sending** types into the agent's terminal (`herdr-core send`); questions
  and permission menus are answered with its keys (`herdr-core keys`).

## Develop

Two builds, side by side, each with its own settings:

```sh
npm install
npm run app:dev      # "Sheepy Dev": reloads as you edit; may break while you work
npm run app:stable   # "Sheepy" in /Applications, built from what's committed
```

The stable build comes from a committed revision (HEAD, or a tag, branch or
commit: `npm run app:stable -- <ref>`) in a temporary clean checkout, so
uncommitted work can't reach it. Use it day to day; update it when a change
is committed and works in Sheepy Dev.

Needs herdr-core (`~/.local/bin/herdr-core`) and, for live logs, herdr-search
on each machine (`~/.local/share/herdr-search/bin/herdr-search`).

## Tests

```sh
node --test test/*.test.js        # transcript parsing, find, questions, annotations, sessions
cd src-tauri && cargo test        # herdr-core calls, log reading, sub-agents
```
