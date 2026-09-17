---
tags: [google-workspace]
---

# google-workspace

Create and edit Google Sheets, Docs, Slides, Calendar events, and Gmail from the session.

```
node scripts/google-workspace.mjs whoami
node scripts/google-workspace.mjs scopes
node scripts/google-workspace.mjs login
node scripts/google-workspace.mjs sheet create --title "Q3" --csv "item,qty\nA,2"
node scripts/google-workspace.mjs sheet set --id ID --cell A1 --value x
node scripts/google-workspace.mjs sheet get --id ID --range A1:B10
node scripts/google-workspace.mjs sheet append --id ID --csv "c,3"
node scripts/google-workspace.mjs sheet clear --id ID --range A1:Z
node scripts/google-workspace.mjs doc create --title "Notes" --body "hello"
node scripts/google-workspace.mjs doc append --id ID --body "more"
node scripts/google-workspace.mjs drive list --query "mimeType='application/vnd.google-apps.spreadsheet'"
node scripts/google-workspace.mjs slide create --title "Deck"
node scripts/google-workspace.mjs meeting create --title "Standup" --start 2026-09-15T09:00:00Z --end 2026-09-15T09:15:00Z --attendees a@x.com,b@y.com
node scripts/google-workspace.mjs mail send --to you@example.com --subject hi --body hello
node scripts/google-workspace.mjs mail list
```

Each person has their own Google Cloud app. Creds stay in `~/.grunt/` on that machine. Do not share OAuth JSON or tokens. Do not commit them. Inviting others to a meeting is attendee emails, not shared creds.

Handheld (any OS): `node scripts/setup.mjs google-workspace` or `npm exec grunt setup` → google-workspace. Opens each Cloud Console page, waits, copies the Desktop JSON into `~/.grunt/google-oauth.json`, then browser Allow. Non-TTY: `--creds PATH` to a Desktop download. `--account NAME` for a second Google user.

Doctor reports google-workspace as optional: `ok` when Desktop OAuth JSON, tokens, gcloud ADC, or `~/.clasprc.json` exists, else `missing (optional)`. It prints source names (`oauth` `tokens` `adc` `clasprc`), not secrets. `clasprc` is Drive-only.

Two Google accounts on one machine: `--account NAME` (or `WORKSPACE_ACCOUNT`). Default is `default` (legacy files `~/.grunt/google-oauth.json` + `workspace-tokens.json` still work). Other accounts use `~/.grunt/workspace/NAME/`.

```
node scripts/google-workspace.mjs --account work login
node scripts/google-workspace.mjs --account work whoami
node scripts/google-workspace.mjs accounts
```

Each account needs its own Desktop JSON in that folder (`google-oauth.json`) and its own `login`.

Clasp’s public OAuth client is Drive-only. Calendar and Gmail are restricted; Google blocks extra scopes on that app. Use **your** Desktop OAuth client.

## Agent: setup e2e

If `whoami` works but `meeting` / `mail` / `sheet set` fail with missing scope or “app is blocked”, run **this user** through `node scripts/setup.mjs google-workspace` (TTY). Do not reuse another person’s JSON. Do not invent a client JSON.

Local dir is created by setup (`~/.grunt/`, mode 700 on Unix). Manual equivalent: `mkdir -p "$HOME/.grunt" && chmod 700 "$HOME/.grunt"` then:

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
5. Copy the download to `$HOME/.grunt/google-oauth.json` (Windows: `%USERPROFILE%\.grunt\google-oauth.json`). chmod 600 on Unix. Confirm it has `"installed"` and `client_id`. For `--account NAME`, use `$HOME/.grunt/workspace/NAME/google-oauth.json`.
6. From the repo: `node scripts/google-workspace.mjs login` (or `--account NAME`) — browser Allow. Tokens write beside the JSON (`workspace-tokens.json` or `workspace/NAME/tokens.json`).
7. Smoke:

```
node scripts/google-workspace.mjs whoami
node scripts/google-workspace.mjs scopes
node scripts/google-workspace.mjs sheet create --title smoke-sheet --csv "k,v\nok,1"
node scripts/google-workspace.mjs doc create --title smoke-doc --body ok
node scripts/google-workspace.mjs slide create --title smoke-slide
node scripts/google-workspace.mjs meeting create --title smoke-meeting --start 2026-09-16T09:00:00Z --end 2026-09-16T09:15:00Z
node scripts/google-workspace.mjs mail send --to THEIR_EMAIL --subject smoke --body ok
```

`scopes` must include `calendar`, `gmail.modify` or `gmail.send`, `spreadsheets`, `documents`, `drive`. If login times out, they did not finish Allow; re-run `login`.

If `google-oauth.json` is missing, `login` prints `setup: node scripts/setup.mjs google-workspace`. Prefer the handheld setup (it opens the Project ID URLs). Manual steps above still work.

`gcloud` on PATH is an alternate login (`gcloud auth application-default login` with the extra scopes). Still per person, still local.
