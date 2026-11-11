import type { SpawnSyncReturns } from "node:child_process";

import { main, type CiDeps } from "../ci.ts";
import { OK, PASSED } from "./ci-run.ts";

/** A finished spawn: exit 0 with no output, unless `over` says otherwise. */
export function spawnReply(over: Partial<SpawnSyncReturns<string>> = {}): SpawnSyncReturns<string> {
  return {
    output: [],
    pid: 0,
    signal: null,
    status: 0,
    stderr: "",
    stdout: "",
    ...over,
  };
}

/** `repo ci` in `root` with the packs and checks read from its config, the gates faked and `fakes` over them. */
export async function ciFromConfig(root: string, fakes: Pick<CiDeps, "repo" | "spawn">) {
  const out: string[] = [];
  const code = await main([], {
    bins: { tsc: () => OK, vitest: () => PASSED },
    cwd: root,
    now: () => 0,
    repo: () => OK,
    ...fakes,
    stdout: (s) => out.push(s),
  });
  return { code, out: out.join("") };
}
