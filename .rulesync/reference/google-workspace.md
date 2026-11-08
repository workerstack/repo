---
tags: [google-workspace]
---

# google-workspace

Create and edit Google Sheets, Docs, Slides, Calendar events, and Gmail from the session.

```
bun .rulesync/scripts/google-workspace.ts whoami
bun .rulesync/scripts/google-workspace.ts scopes
bun .rulesync/scripts/google-workspace.ts login
bun .rulesync/scripts/google-workspace.ts sheet create --title "Q3" --csv "item,qty\nA,2"
bun .rulesync/scripts/google-workspace.ts sheet set --id ID --cell A1 --value x
bun .rulesync/scripts/google-workspace.ts sheet get --id ID --range A1:B10
bun .rulesync/scripts/google-workspace.ts sheet append --id ID --csv "c,3"
bun .rulesync/scripts/google-workspace.ts sheet clear --id ID --range A1:Z
bun .rulesync/scripts/google-workspace.ts doc create --title "Notes" --body "hello"
bun .rulesync/scripts/google-workspace.ts doc append --id ID --body "more"
bun .rulesync/scripts/google-workspace.ts drive list --query "mimeType='application/vnd.google-apps.spreadsheet'"
bun .rulesync/scripts/google-workspace.ts slide create --title "Deck"
bun .rulesync/scripts/google-workspace.ts meeting create --title "Standup" --start 2026-09-15T09:00:00Z --end 2026-09-15T09:15:00Z --attendees a@x.com,b@y.com
bun .rulesync/scripts/google-workspace.ts mail send --to you@example.com --subject hi --body hello
bun .rulesync/scripts/google-workspace.ts mail list
```

Each person has their own Google Cloud app. Creds stay in `~/.workerstack/` on that machine. Do not share OAuth JSON or tokens. Do not commit them. Inviting others to a meeting is attendee emails, not shared creds.

Handheld (any OS): `bun .rulesync/scripts/setup.ts google-workspace` or `bunx repo setup` → google-workspace. Opens each Cloud Console page, waits, copies the Desktop JSON into `~/.workerstack/workspace/default/google-oauth.json`, then browser Allow. Non-TTY: `--creds PATH` to a Desktop download. `--account NAME` for a second Google user.

Doctor reports google-workspace as optional: `ok` when Desktop OAuth JSON, tokens, gcloud ADC, or `~/.clasprc.json` exists, else `missing (optional)`. It prints source names (`oauth` `tokens` `adc` `clasprc`), not secrets. `clasprc` is Drive-only.

Two Google accounts on one machine: `--account NAME` (or `WORKSPACE_ACCOUNT`). Each account, `default` included, uses `~/.workerstack/workspace/NAME/`.

```
bun .rulesync/scripts/google-workspace.ts --account work login
bun .rulesync/scripts/google-workspace.ts --account work whoami
bun .rulesync/scripts/google-workspace.ts accounts
```

Each account needs its own Desktop JSON in that folder (`google-oauth.json`) and its own `login`.

Clasp’s public OAuth client is Drive-only. Calendar and Gmail are restricted; Google blocks extra scopes on that app. Use **your** Desktop OAuth client.

## Agent: setup e2e

If `whoami` works but `meeting` / `mail` / `sheet set` fail with missing scope or “app is blocked”, run **this user** through `bun .rulesync/scripts/setup.ts google-workspace` (TTY). Do not reuse another person’s JSON. Do not invent a client JSON.

Local dir is created by setup (`~/.workerstack/`, mode 700 on Unix). Manual equivalent: `mkdir -p "$HOME/.workerstack" && chmod 700 "$HOME/.workerstack"` then:

1. Open `https://console.cloud.google.com/projectcreate` — **Create**. Org can be their Workspace org. Note **Project ID** from the dashboard URL (`?project=`).
2. Open `https://console.cloud.google.com/auth/overview/create?project=PROJECT_ID` (or **Google Auth Platform → Branding**).
   - App name: anything (`autorun` is fine). That string is only the Allow screen.
   - User support email: their address.
   - Audience: **Internal** if the Google account is a paid Workspace org (e.g. `@rearm.co`). **Testing** + add their own address as a test user if it is a personal `@gmail.com` (Internal is not offered). APIs work on both; only this consent type changes.
   - Next / Create through the wizard.
3. Open `https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com,gmail.googleapis.com,sheets.googleapis.com,docs.googleapis.com,drive.googleapis.com&project=PROJECT_ID` — **Enable**.
4. Open `https://console.cloud.google.com/auth/clients/create?project=PROJECT_ID`.
   - Application type: **Desktop app**.
   - Create → **Download JSON**.
5. Copy the download to `$HOME/.workerstack/workspace/default/google-oauth.json` (Windows: `%USERPROFILE%\.workerstack\workspace\default\google-oauth.json`). chmod 600 on Unix. Confirm it has `"installed"` and `client_id`. For `--account NAME`, use `$HOME/.workerstack/workspace/NAME/google-oauth.json`.
6. From the repo: `bun .rulesync/scripts/google-workspace.ts login` (or `--account NAME`) — browser Allow. Tokens write beside the JSON (`workspace/NAME/tokens.json`).
7. Smoke:

```
bun .rulesync/scripts/google-workspace.ts whoami
bun .rulesync/scripts/google-workspace.ts scopes
bun .rulesync/scripts/google-workspace.ts sheet create --title smoke-sheet --csv "k,v\nok,1"
bun .rulesync/scripts/google-workspace.ts doc create --title smoke-doc --body ok
bun .rulesync/scripts/google-workspace.ts slide create --title smoke-slide
bun .rulesync/scripts/google-workspace.ts meeting create --title smoke-meeting --start 2026-09-16T09:00:00Z --end 2026-09-16T09:15:00Z
bun .rulesync/scripts/google-workspace.ts mail send --to THEIR_EMAIL --subject smoke --body ok
```

`scopes` must include `calendar`, `gmail.modify` or `gmail.send`, `spreadsheets`, `documents`, `drive`. If login times out, they did not finish Allow; re-run `login`.

If `google-oauth.json` is missing, `login` prints `setup: bun .rulesync/scripts/setup.ts google-workspace`. Prefer the handheld setup (it opens the Project ID URLs). Manual steps above still work.

`gcloud` on PATH is an alternate login (`gcloud auth application-default login` with the extra scopes). Still per person, still local.
