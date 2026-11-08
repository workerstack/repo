---
tags: [clasp]
---

# Clasp

Low-level Apps Script CLI. Optional. Doctor reports it.

For create/edit sheet, doc, slide, meeting, or mail, use **google-workspace**: `node_modules/@workerstack/repo/references/google-workspace.md` and `bun repo google-workspace`. Do not start from clasp.

```
bun add -g @google/clasp
clasp login
clasp create --type standalone --title <name>
clasp pull
clasp push
clasp run <function>
clasp status
```

Script files live next to `appsscript.json`. Git tracks them. `clasp run` needs the Apps Script API and an API-executable deployment. That path is for custom `.gs`, not day-to-day Workspace.
