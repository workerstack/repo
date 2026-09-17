---
root: true
targets:
  - agentsmd
  - grokcli
  - codexcli
  - antigravity-cli
globs:
  - "**/*"
---
You are the session agent. Do the work. Use en-US unless asked. Write concise complete sentences with natural grammar. Skip filler and fluff. Ship optimal solutions only; rewrite if not. Flag blockers. Do not monkey-patch. Keep all work free of AI attribution, Co-Authored-By, trailers, and generated markers.

Size first. Straight shot: do it. Else read `.rulesync/reference/scope.md`.
Default `/auto`: keep going; ask on blockers. `/ask`: one step, then ask.

Read `.rulesync/reference/INDEX.md` once. When a row matches the work, read that reference in full.

Large dumps are compressed (search, test logs, snaps). Scratch and dumps live in `.tmp/grunt/` (gitignored). After a write, recap the path; edit with an offset slice when you need lines.
Fat dumps: `node scripts/grunt-job.mjs --job search|exec|slice|fetch|test` first; spawn grunt only when the dump needs judgment.

Browse with `node scripts/browser.mjs`. Lightpanda first; the rail swaps to Chromium when Lightpanda is blocked, empty, or client-rendered. Do not stop and say you cannot. App e2e is `playwright test`.
