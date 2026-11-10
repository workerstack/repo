#!/usr/bin/env bun
/** Repo-only. Fetch ported pstack skills, apply repo adapters, write SSOT. Not shipped. */
import { ARGV_START } from "./sync-pstack-skills.constants.ts";
import { syncPstackSkills, type Io } from "./sync-pstack-write.ts";

/**
 * Sync the pstack skills as `argv` asks; failures go to `io.err`.
 * @param argv The command line after the script name.
 * @param io Where lines go.
 * @returns The exit code.
 */
export async function main(argv: string[], io: Io): Promise<number> {
  try {
    const result = await syncPstackSkills({ argv, io });
    if (!result.ok) {
      io.err(`${result.error}\n`);
      return 1;
    }
    return 0;
  } catch (err) {
    io.err((err instanceof Error && err.message ? err.message : String(err)) + "\n");
    return 1;
  }
}

if (import.meta.main)
  process.exitCode = await main(process.argv.slice(ARGV_START), {
    out: (line) => void process.stdout.write(line),
    err: (line) => void process.stderr.write(line),
  });
