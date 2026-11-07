#!/usr/bin/env node
import { start } from "../cli/repo.mjs"

start().catch((err) => {
  process.stderr.write(`repo: ${err?.message ?? err}\n`)
  process.exit(1)
})
