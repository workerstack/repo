/** The repo hooks behind `repo hook <name>`, which hosts call with stdin JSON. */
import type { HookEntry, Registry } from "./commands.types.ts";
import { HOOK_USAGE, isHookName, type HookName } from "./scripts/hook-command.ts";

export const HOOKS: Readonly<Record<HookName, HookEntry>> = {
  "gate-fat-tools": {
    argv: [],
    load: () => import("./scripts/gate-fat-tools.ts"),
    summary: "Fat-tool gate",
  },
  "orchestrate-parent": {
    argv: [],
    load: () => import("./scripts/orchestrate-parent.ts"),
    summary: "Persist, approval and session gate",
  },
  "rtk-grok": {
    argv: [],
    load: () => import("./scripts/rtk-grok.ts"),
    summary: "rtk rewrite for Grok",
  },
  "scrub-spawn-prompt": {
    argv: [],
    load: () => import("./scripts/scrub-spawn-prompt.ts"),
    summary: "Spawn prompt scrub",
  },
  "session-map": {
    argv: [],
    load: () => import("./scripts/session-map.ts"),
    summary: "Session-start folder map",
  },
  worktree: {
    argv: ["hook"],
    load: () => import("./scripts/worktree.ts"),
    summary: "Claude Code worktree create and remove",
  },
};

/** `repo hook <name> …`: the hook's `main` on its fixed argv and then `args`; exit 1 with the hook list for no hook. */
export async function runHook([name, ...args]: readonly string[], hooks: Registry["hooks"]): Promise<number> {
  if (!isHookName(name)) {
    const named = name === undefined ? "name a hook" : `unknown hook "${name}"`;
    process.stderr.write(`repo hook: ${named}; ${HOOK_USAGE}\n`);

    return 1;
  }

  const hook = hooks[name];
  const { main } = await hook.load();

  return await main([...hook.argv, ...args]);
}
