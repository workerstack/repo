---
name: commit-push-deploy
description: >
  Commit, push, then deploy only if allowlisted infra already exists. Use for
  /commit-push-deploy, "commit push deploy", "deploy this". Must push. Never
  force-push. Never invent infra.
---
Run `/commit-push`, then:

## Deploy

Detect **existing** repo-root (or listed) paths only — never create them:

`fly.toml` `vercel.json` `netlify.toml` `wrangler.toml` `wrangler.jsonc` `cloudflare.config.ts` `railway.toml` `railway.json` `render.yaml` `render.yml` `app.yaml` `Dockerfile` `docker-compose.yml` `docker-compose.yaml` `samconfig.toml` `serverless.yml` `serverless.yaml` `Pulumi.yaml` `terraform/` `.do/app.yaml`

This repo (`package.json` `name` `@workerstack/repo`): skip deploy. Stop after push.

No allowlist hit: skip. Never invent infra, hosts, workflows, or config.

Hit: run only a deploy command already documented in-repo (scripts/CI/README). Do not guess a provider. Do not add files.

Cloudflare hit (`wrangler.toml`, `wrangler.jsonc`, `cloudflare.config.ts`) with no in-repo deploy command: run `cf deploy`. Read `node_modules/@workerstack/repo/references/cloudflare.md` first.

Protocol: `node_modules/@workerstack/repo/references/cascade.md`. Do not paste cascade.
