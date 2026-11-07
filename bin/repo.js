#!/usr/bin/env node
import { start } from "../cli/grunt.mjs"

start().catch((err) => {
  process.stderr.write(`repo: ${err?.message ?? err}\n`)
  process.exit(1)
})
