#!/usr/bin/env bun
import { dispatch } from "../cli/commands.ts";

/** Registry commands and hooks first, so they never load the init, sync and prompt code in `cli/main.ts`. */
async function run(): Promise<void> {
  const code = await dispatch(process.argv.slice(2));
  if (code !== null) process.exitCode = code;
  else await (await import("../cli/main.ts")).start();
}

// Exit once the command settles, as each script did when run directly, so a hook never waits on a stray handle.
run().then(
  () => process.exit(),
  (err: unknown) => {
    process.stderr.write(`repo: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
