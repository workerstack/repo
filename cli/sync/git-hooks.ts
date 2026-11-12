import { repoBinLookup } from "../scripts/hook-command.ts";
import { hasOwnedHeader } from "./header.ts";
import type { Output, SyncContext } from "./outputs.ts";
import { HOOKS_DIR } from "./standards.constants.ts";

/**
 * Each git hook's body after the bin lookup, `$r` the bin. git gives pre-push its ref lines once on stdin, so the body
 * reads them first, runs link with no stdin (its children would drain it) and pipes them to commit-msg.
 */
const GIT_HOOKS = {
  "commit-msg": '"$r" commit-msg "$1"',
  "pre-commit": '"$r" turn --staged',
  "pre-push":
    'input=$(cat)\n"$r" link --pre-push </dev/null && printf \'%s\\n\' "$input" | "$r" commit-msg --pre-push "$@"',
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

  for (const [name, body] of Object.entries(GIT_HOOKS)) {
    const rel = `${HOOKS_DIR}/${name}`;
    const existing = ctx.read(rel);

    if (existing !== null && !hasOwnedHeader(existing)) {
      errors.push(`${rel} is hand-written; delete it so repo sync can own it`);
      continue;
    }

    const content = `#!/bin/sh\n${repoBinLookup(".")}\n${body}\n`;
    outputs.push({ content, executable: true, kind: "file", managed: "whole", path: rel, tracked: true });
  }

  return errors.length > 0 ? { errors, outputs: [] } : { errors, outputs };
}
