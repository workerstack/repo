import { repoBinLookup } from "../scripts/hook-command.ts";
import { hasOwnedHeader } from "./header.ts";
import type { Output, SyncContext } from "./outputs.ts";
import { HOOKS_DIR } from "./standards.constants.ts";

/** Each git hook and the repo command it runs, with the arguments git passes. */
const GIT_HOOKS = {
  "commit-msg": 'commit-msg "$1"',
  "pre-commit": "turn --staged",
  "pre-push": "link --pre-push",
} as const;

/** The path of each git hook. */
function hookPaths(): string[] {
  return Object.keys(GIT_HOOKS).map((name) => `${HOOKS_DIR}/${name}`);
}

export const HOOK_PATHS: readonly string[] = /* @__PURE__ */ hookPaths();

/**
 * The tracked, executable git hooks: each finds the bin from `.`, the worktree top level git runs hooks in, never from
 * an agent's project dir. A hook at either path without the generated header is the user's, so sync refuses it.
 */
export function gitHooks(ctx: SyncContext): { outputs: Output[]; errors: string[] } {
  const outputs: Output[] = [];
  const errors: string[] = [];

  for (const [name, command] of Object.entries(GIT_HOOKS)) {
    const rel = `${HOOKS_DIR}/${name}`;
    const existing = ctx.read(rel);

    if (existing !== null && !hasOwnedHeader(existing)) {
      errors.push(`${rel} is hand-written; delete it so repo sync can own it`);
      continue;
    }

    const content = `#!/bin/sh\n${repoBinLookup(".")}\n"$r" ${command}\n`;
    outputs.push({ content, executable: true, kind: "file", managed: "whole", path: rel, tracked: true });
  }

  return errors.length > 0 ? { errors, outputs: [] } : { errors, outputs };
}
