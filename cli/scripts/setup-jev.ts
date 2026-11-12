/** `repo setup jev`: saves the TypeSafe API key to `~/.workerstack/jev.json`. */
import os from "node:os";
import path from "node:path";

import { writeSecretJson } from "./setup-files.ts";
import { logLine } from "./setup-io.ts";
import { JEV_KEY_URL } from "./setup.constants.ts";
import type { SetupCtx, SetupIo } from "./setup.types.ts";
import { str } from "./voice-args.ts";

/** The key from the terminal's password prompt; "" when not interactive or the io has none. */
async function promptKey({
  interactive,
  io,
}: {
  interactive: boolean;
  io: SetupIo | null | undefined;
}): Promise<string> {
  if (!interactive || io?.password === undefined) return "";
  logLine(io, `Open: ${JEV_KEY_URL}`);

  return str(await io.password({ message: "TypeSafe API key" }));
}

export async function setupJev({ flags = {}, home = os.homedir(), io, interactive = false }: SetupCtx = {}): Promise<{
  ok: true;
  dest: string;
}> {
  const flagKey = str(flags["api-key"], str(flags.key));
  const apiKey = flagKey === "" ? await promptKey({ interactive, io }) : flagKey;
  const missing = interactive ? "need a TypeSafe API key" : "need --api-key (or TTY: bun repo setup jev)";

  if (apiKey === "") throw new Error(missing);

  const dest = writeSecretJson(path.join(home, ".workerstack", "jev.json"), { apiKey });
  logLine(io, `wrote ${dest}`);

  return { dest, ok: true };
}
