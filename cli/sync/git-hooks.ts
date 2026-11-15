import { DEPENDENTS_DIR } from "../link.constants.ts";
import { repoBinLookup } from "../scripts/hook-command.ts";
import { hasOwnedHeader } from "./header.ts";
import type { Output, SyncContext } from "./outputs.ts";
import { HOOKS_DIR } from "./standards.constants.ts";

/** One git hook: `before` lines run ahead of the bin lookup, then `body` with `$r` the bin. */
type GitHook = { before?: readonly string[]; body: string };

/**
 * Each git hook's body after the bin lookup, `$r` the bin. git gives pre-push its ref lines once on stdin, so the body
 * reads them first, runs link with no stdin (its children would drain it) and pipes them to commit-msg.
 * reference-transaction runs for every ref update in every repo, so it leaves before the lookup, which exits 1 with no
 * bin, unless a move is committed (git ignores that exit code; a prepared one would abort the update) and a main
 * checkout has dependents. git gives it the ref lines on stdin, which `link push --hook` reads.
 */
const GIT_HOOKS = {
  "commit-msg": { body: '"$r" commit-msg "$1"' },
  "pre-commit": { body: '"$r" precommit' },
  "pre-push": {
    body:
      'input=$(cat)\n"$r" link --pre-push </dev/null && ' +
      'printf \'%s\\n\' "$input" | "$r" commit-msg --pre-push "$@"',
  },
  "reference-transaction": {
    before: [
      '[ "$1" = committed ] || exit 0',
      'm="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || exit 0',
      `[ -d "\${m%/*}/${DEPENDENTS_DIR}" ] || exit 0`,
    ],
    body: '"$r" link push --hook',
  },
} as const satisfies Record<string, GitHook>;

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

  for (const [name, hook] of Object.entries<GitHook>(GIT_HOOKS)) {
    const rel = `${HOOKS_DIR}/${name}`;
    const existing = ctx.read(rel);

    if (existing !== null && !hasOwnedHeader(existing)) {
      errors.push(`${rel} is hand-written; delete it so repo sync can own it`);
      continue;
    }

    const content = `#!/bin/sh\n${[...(hook.before ?? []), repoBinLookup("."), hook.body].join("\n")}\n`;
    outputs.push({ content, executable: true, kind: "file", managed: "whole", path: rel, tracked: true });
  }

  return errors.length > 0 ? { errors, outputs: [] } : { errors, outputs };
}
