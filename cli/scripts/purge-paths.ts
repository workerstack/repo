/** Where `repo purge-mcps` looks: the home, its flags, and the three global dests under that home. */
import os from "node:os";
import path from "node:path";

import { readEnv } from "../env.ts";
import type { Env } from "../env.ts";
import { APPLY_FLAG } from "./purge-global-mcps.constants.ts";
import type { ParsedArgv } from "./purge-global-mcps.types.ts";

/** HOME, else USERPROFILE (Windows / env sim), else os.homedir(). */
export function resolveHome(env: Env = readEnv()): string {
  return env.HOME || env.USERPROFILE || os.homedir();
}

/** `--apply` or nothing; any other argument is an unknown flag. */
export function parseArgv(argv: unknown): ParsedArgv {
  const args: unknown[] = Array.isArray(argv) ? argv : [];
  let apply = false;
  for (const a of args) {
    if (a === APPLY_FLAG) {
      apply = true;
      continue;
    }
    return { error: `unknown flag: ${a}`, ok: false };
  }
  return { apply, ok: true };
}

/** The global grok config under `home`. */
export function grokConfigPath(home: string): string {
  return path.join(path.resolve(home), ".grok", "config.toml");
}

/** The global cursor MCP config under `home`. */
export function cursorMcpPath(home: string): string {
  return path.join(path.resolve(home), ".cursor", "mcp.json");
}

/** The claude installed-plugins list under `home`. */
export function claudePluginsPath(home: string): string {
  return path.join(path.resolve(home), ".claude", "plugins", "installed_plugins.json");
}
