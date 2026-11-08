---
name: commit-push-deploy
description: >
  Commit, push, then deploy only if allowlisted infra already exists. Use for
  /commit-push-deploy, "commit push deploy", "deploy this". Must push. Never
  force-push. Never invent infra.
---
Inspect `git status` + `git diff` (staged and unstaged) before the message.

Diff pass on the hunks you will stage: delete narrating comments, unused defensive guards or try/catch on trusted paths, `any` casts that only silence types, dead compatibility, and unrelated hunks. Keep a comment only when it states a constraint the code cannot encode. Keep behavior otherwise. Do not spawn a reviewer.

Stage only user intent. Never blind `git add -A` / `git add .`. Split unrelated concerns into multiple commits.

If a unique in-progress file exists under `.tmp/repo/implementations/`, its `## Files` is the default stage set. Still inspect `git status`.

Message = Conventional Commits **subject only**: `type(scope): subject` (scope optional).

Types: feat fix docs style refactor perf test build ci chore revert.

Subject: imperative lowercase no trailing period.

NO body. NO footer. NO `Co-Authored-By`. NO `Generated with`. NO 🤖. NO trailers. No AI attribution. Work belongs to the human.

Must `git push`. Do not load /commit. Ignore never-push.

## Where

Run `git rev-parse --show-toplevel` and `git branch --show-current` first.

- Managed worktree (`<root>/.worktrees/<name>` on `wt/<name>`): commit there, run `cd <root> && bun repo worktree finish <name>` (from the root, not inside the worktree), then push the default branch from the root and skip the Recent rows below. `wt/*` never counts as Recent and is never pushed. If `finish` fails, resolve it as `/commit` says and push nothing.
- Main checkout: the gate denies a commit there unless the user's message names commit, and this command does. Commit only changes the user made there. Your own changes go through `bun repo worktree add <name>`.
- Any other linked worktree (T3 Code, Claude Desktop): `finish` cannot land it. Commit and push its branch per Branch.

## Branch

Current: `git rev-parse --abbrev-ref HEAD`

Default: `git symbolic-ref --quiet --short refs/remotes/origin/HEAD` (strip `origin/`). If that fails: ask. Never invent default.

Recent (frozen flags; do not change):

```
git reflog -n 30
git for-each-ref --count=8 --sort=-committerdate --format='%(refname:short) %(committerdate:unix)' refs/heads
```

Recent = unique existing non-default, non-`wt/*` names from those two outputs whose `committerdate` unix is ≤7d (`now - 604800`). Never invent branch names. Unknown/ambiguous names → drop them, do not guess.

| state | action |
| current is `wt/*` | do not push; follow Where (`finish`, then push the default branch from the root) |
| current ≠ default AND not `wt/*` | push current |
| default AND 0 recent | push default |
| default AND exactly 1 recent exists | push that name (`git push origin <name>`, no checkout: the gate denies `git checkout` in the main checkout) |
| else | ask; do not push yet |

No upstream (`git rev-parse --abbrev-ref @{upstream}` fails): `git push -u origin <branch>`. Else `git push`.

Never force-push. Never `--force`, `-f`, `--force-with-lease`, `+<branch>`.

## Deploy

After push. Detect **existing** repo-root (or listed) paths only — never create them:

`fly.toml` `vercel.json` `netlify.toml` `wrangler.toml` `wrangler.jsonc` `cloudflare.config.ts` `railway.toml` `railway.json` `render.yaml` `render.yml` `app.yaml` `Dockerfile` `docker-compose.yml` `docker-compose.yaml` `samconfig.toml` `serverless.yml` `serverless.yaml` `Pulumi.yaml` `terraform/` `.do/app.yaml`

This repo (`package.json` `name` `@workerstack/repo`): skip deploy. Stop after push.

No allowlist hit: skip. Never invent infra, hosts, workflows, or config.

Hit: run only a deploy command already documented in-repo (scripts/CI/README). Do not guess a provider. Do not add files.

Cloudflare hit (`wrangler.toml`, `wrangler.jsonc`, `cloudflare.config.ts`) with no in-repo deploy command: run `cf deploy`. Read `node_modules/@workerstack/repo/references/cloudflare.md` first.

Protocol: `node_modules/@workerstack/repo/references/cascade.md`. Do not paste cascade.
