---
tags: [clasp]
---

# Clasp

Low-level Apps Script CLI. Optional. Doctor reports it.

For create/edit sheet, doc, slide, meeting, or mail, use **google-workspace**: `.rulesync/reference/google-workspace.md` and `node scripts/google-workspace.mjs`. Do not start from clasp.

```
npm i -g @google/clasp
clasp login
clasp create --type standalone --title <name>
clasp pull
clasp push
clasp run <function>
clasp status
```

Script files live next to `appsscript.json`. Git tracks them. `clasp run` needs the Apps Script API and an API-executable deployment. That path is for custom `.gs`, not day-to-day Workspace.
