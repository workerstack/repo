#!/usr/bin/env bun
import { start } from "../cli/repo.ts"

start().catch((err: unknown) => {
  process.stderr.write(`repo: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
