---
tags: [cloudflare]
---

# Cloudflare

Use `cf` for every Cloudflare task. Do not run `wrangler` yourself and do not add it to a project that has none.

## Find the command

```
cf cli search "<describe the task>"
<command from the result> --help
cf schema <command from the result, without the leading cf>
```

`cf cli search` returns five matches. Pick one instead of repeating the search. Write the query as the action and resource type only: no names, domains, emails, account or resource IDs, or tokens. `cf schema` shows the API request detail for a command.

## Project commands

- `cf dev` runs the dev server (`--local` uses local resource simulations).
- `cf deploy` deploys (`--dry-run` builds and checks without uploading).
- `cf build` builds the project.
- `cf workers types` generates types from `cloudflare.config.ts`.
- `cf init workers [directory]` creates or sets up a Workers project.
- `cf auth` manages login and profiles; `--profile <name>` picks one on any command.

`cf dev` and `cf deploy` run the dev server the project declares in `package.json`: `@cloudflare/vite-plugin` (recommended), or `wrangler` for a legacy Worker project that keeps `wrangler.jsonc`. With none declared they print the install choices and stop. Ask before adding a dependency.

## Docs

Product docs: https://developers.cloudflare.com/ . Machine-readable index: https://developers.cloudflare.com/llms.txt .

## Status

`cf` is in beta, so commands and config can still change. Wrangler is not deprecated yet; Cloudflare plans to maintain it for 18 months after the `cf` beta ends.
