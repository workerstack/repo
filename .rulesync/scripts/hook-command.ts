/**
 * The repo hooks and the one command every host runs for each. Pure and dependency free, because consumers that still
 * copy `.rulesync/scripts/` import it from `hooks-union.ts`, where `cli/` does not exist.
 */

/** Each repo hook, and the file its command ran before it went through `repo hook`. */
export const HOOK_SCRIPTS = {
  "gate-fat-tools": "gate-fat-tools.ts",
  "orchestrate-parent": "orchestrate-parent.ts",
  "rtk-grok": "rtk-grok.ts",
  "scrub-spawn-prompt": "scrub-spawn-prompt.ts",
  "session-map": "session-map.ts",
  worktree: "worktree.ts",
} as const;

export type HookName = keyof typeof HOOK_SCRIPTS;

export const HOOK_NAMES = (Object.keys(HOOK_SCRIPTS) as HookName[]).sort();

export function isHookName(name: string | undefined): name is HookName {
  return name !== undefined && Object.hasOwn(HOOK_SCRIPTS, name);
}

export const HOOK_USAGE = `use ${HOOK_NAMES.slice(0, -1).join(", ")} or ${HOOK_NAMES.at(-1)}`;

/**
 * The hook command every host runs: find the root the way hooks always have, then the installed bin, which bun links
 * as `repo` on POSIX and as `repo.exe` on Windows. A checkout with no install gets a message and exit 1; exit 2 would
 * block the `bun install` that fixes it.
 */
export function hookCommand(name: HookName): string {
  return (
    `d="\${GROK_WORKSPACE_ROOT:-\${CLAUDE_PROJECT_DIR:-.}}"; b=node_modules/.bin/repo; ` +
    `[ -e "$d/$b" ] || [ -e "$d/$b.exe" ] || d="$(git -C "$d" rev-parse --show-toplevel 2>/dev/null || echo "$d")"; ` +
    `r="$d/$b"; [ -e "$r" ] || [ ! -e "$r.exe" ] || r="$r.exe"; ` +
    `[ -x "$r" ] || { echo "repo: $d/$b is missing; run bun install" >&2; exit 1; }; ` +
    `"$r" hook ${name}`
  );
}

/** The repo hook a command runs, in the `repo hook <name>` form or the older direct script form; null for any other command. */
export function hookNameOf(command: string): HookName | null {
  const viaBin = /(?:\$r"|[\s"'/]repo"?|^repo)\s+hook\s+([\w-]+)\s*$/.exec(command);
  if (viaBin) return isHookName(viaBin[1]) ? viaBin[1] : null;
  for (const name of HOOK_NAMES) {
    if (new RegExp(`[\\\\/"'\\s]${HOOK_SCRIPTS[name].replace(".", "\\.")}(?:["'\\s]|$)`).test(command)) return name;
  }
  return null;
}
