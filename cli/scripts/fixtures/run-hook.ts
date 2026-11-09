import { spawnSync } from "node:child_process";
import path from "node:path";
import { vi } from "vitest";
import { BUN } from "../../../dev/test-paths";
import { childEnv } from "../../env.ts";
import type { HookName } from "../hook-command.ts";
import type { HookIo } from "../hook-io.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SPAWN_TIMEOUT_MS = 20_000;

/** A hook's `main`, as `cli/commands.ts` loads it. */
export type HookMain = (argv?: string[], io?: HookIo) => number;

/** What a test reads from a hook run: the exit code and the reply, as a spawn result would give them. */
export interface HookRun {
  status: number;
  stdout: string;
}

/** Sets each variable for the call (undefined removes it) and puts back the value it had; `unstubEnvs` covers the rest. */
function withEnv<T>(env: Record<string, string | undefined>, run: () => T): T {
  const before = Object.keys(env).map((name): [string, string | undefined] => [name, process.env[name]]);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  try {
    return run();
  } finally {
    for (const [name, value] of before) vi.stubEnv(name, value);
  }
}

/** Runs a hook `main` in this process on `payload` (a string goes in as written, an object as JSON) and captures its reply. */
export function runHook(main: HookMain, payload: unknown, env: Record<string, string | undefined> = {}): HookRun {
  const input = new TextEncoder().encode(typeof payload === "string" ? payload : JSON.stringify(payload));
  let fed = false;
  let stdout = "";
  const io: HookIo = {
    readChunk: () => {
      if (fed) return null;
      fed = true;
      return input;
    },
    write: (text) => {
      stdout += text;
    },
  };
  const status = withEnv(env, () => main([], io));
  return { status, stdout };
}

/** The one spawned case per hook: `bun bin/repo.ts hook <name>`, the path a host takes, with `payload` on stdin. */
export function spawnHook(
  name: HookName,
  payload: unknown,
  { env = {}, cwd = REPO_ROOT }: { env?: Record<string, string | undefined>; cwd?: string } = {},
) {
  return spawnSync(BUN, [path.join(REPO_ROOT, "bin", "repo.ts"), "hook", name], {
    encoding: "utf8",
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    cwd,
    env: childEnv({ CLAUDE_PROJECT_DIR: undefined, GROK_WORKSPACE_ROOT: undefined, ...env }),
    timeout: SPAWN_TIMEOUT_MS,
  });
}
