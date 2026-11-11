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
  if (!interactive || !io || typeof io.password !== "function") return "";
  logLine(io, `Open: ${JEV_KEY_URL}`);
  return str(await io.password({ message: "TypeSafe API key" }));
}

export async function setupJev({ flags = {}, home = os.homedir(), io, interactive = false }: SetupCtx = {}): Promise<{
  ok: true;
  dest: string;
}> {
  const apiKey = str(flags["api-key"] || flags.key) || (await promptKey({ interactive, io }));
  if (!apiKey) throw new Error(interactive ? "need a TypeSafe API key" : "need --api-key (or TTY: bun repo setup jev)");

  const dest = writeSecretJson(path.join(home, ".workerstack", "jev.json"), { apiKey });
  logLine(io, `wrote ${dest}`);
  return { dest, ok: true };
}
