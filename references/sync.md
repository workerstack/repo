---
description: How sync writes files
---

# Sync

## Skills naming

Do not reuse a repo skill name for a consumer custom skill: a repo-owned skill of the same name in `.repo/skills/` replaces the stock one. Pack names stay reserved when their directory is absent.

`bun repo sync` links the stock skills from the installed package into each host tree and writes the rest; it never copies stock references or scripts. doctor/listen/speak call the consumer's root `scripts/lib/env.mjs` `loadEnv` when that file exists.

Upgrading is running `bun repo update '@workerstack/*'`: it bumps every `@workerstack/*` package to its npm latest, installs, and prints what that install's sync wrote and removed, plus each package's CHANGELOG sections between the installed and the new version. The first sync in a repo an older `bun repo init` copied moves your own rules, subagents, skills, settings keys, lessons, hooks and references into `.repo/` and `references/`, untracks the generated paths, removes the copied `.rulesync/`, and prints one moved line per move. Commit the result.

Each section `bun repo sync` writes below, like its blocks in `.gitignore` and `.gitattributes`, sits between an opening and a closing comment that name it, and the opening one carries a short hash of the text sync wrote. Keep your own lines outside them: a line added or edited inside is moved just below the section by the next sync. A missing, doubled, misplaced or mangled comment is repaired rather than failing sync, each repair printing one line that names the file. A section a new version no longer writes is cut, and a shared file nothing writes any more keeps your lines with its sections cut, removed only when nothing else is left.
