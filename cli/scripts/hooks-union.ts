#!/usr/bin/env bun
/**
 * Overlay after the hooks generator (`cli/sync/agents/render-hooks.ts`), for what hooks.jsonc cannot express.
 * Union, never replace: the generator's own groups (scrub, gate, orchestrate-parent, session map)
 * are left as generated.
 *
 * Claude/Codex native event is UserPromptSubmit (mapped from SoT beforeSubmitPrompt).
 * Antigravity has neither beforeSubmitPrompt nor subagentStop.
 * Grok SessionStart stays empty on orchestrate-parent.json.
 * Claude/Codex SessionStart: session-map.ts (folder map) when shipped, first in the group.
 * Antigravity SessionStart is the generator's flat entries, consumer extras appended flat.
 * Cursor's .cursor/hooks.json is all flat entries; consumer extras are appended flat under its own tool name.
 *
 * Consumer extras (if those scripts exist): SessionStart, check-behind,
 * validate+sim; Antigravity and Cursor get them under their own tool names.
 * Path deny from consumer `.repo/permissions.json`.
 * Claude WorktreeCreate / WorktreeRemove come from hooks.jsonc's claudecode block; --check needs them when worktree.ts
 * ships.
 * Every repo hook command is hookCommand(name): the installed `repo` bin, run as `repo hook <name>`.
 * Every consumer script command is rootCmd(): the script in the project dir, else at its git top level.
 *
 * `bun repo sync` applies the union then checks it; `bun repo sync --check` runs the keep-list only.
 */
import fs from "node:fs";
import path from "node:path";

import { hookCommand, hookNameOf, type HookName } from "./hook-command.ts";
import { applyAgents, applyClaude, applyCodex, applyCursor } from "./hooks-union-apply.ts";
import { isRootCmd } from "./hooks-union-commands.ts";
import { loadConsumerDeny, mapHooks, presentAutorun, ships } from "./hooks-union-desired.ts";
import { allCommands } from "./hooks-union-merge.ts";
import {
  AGENTS_HOOKS,
  AUTORUN_NEEDLES,
  CLAUDE_SETTINGS,
  CODEX_HOOKS,
  COMMAND_FILES,
  CURSOR_HOOKS,
  GIT_HOOKS,
  GIT_HOOKS_DIR,
  OWNED_HOOKS,
  RULESYNC_ID,
} from "./hooks-union.constants.ts";
import type { Roots } from "./hooks-union.types.ts";
import { stripJsonc } from "./strip-jsonc.ts";

/**
 * `workspaceRoot` is where the hook files are read and written. `sourceRoot` is the stock package whose
 * `cli/scripts/` says which repo hooks ship. `consumerRoot` owns `scripts/` hooks, `scripts/git-hooks`
 * and the path deny (`.repo/permissions.json`).
 * Both default to `workspaceRoot`.
 */
export type UnionOptions = {
  workspaceRoot?: string;
  sourceRoot?: string;
  consumerRoot?: string;
  check?: boolean;
};

export type UnionResult = {
  ok: boolean;
  check: boolean;
  error?: string;
  failures?: string[];
};

/** One hook file `checkUnion` reads: the repo hooks it must run and the text it must hold. */
type FileSpec = {
  id: string;
  path: string;
  hooks: readonly HookName[];
  needles: readonly string[];
};

function given(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function resolveRoots(opts: UnionOptions | string): Roots {
  if (typeof opts === "string") return { consumer: opts, src: opts, ws: opts };
  const ws = given(opts.workspaceRoot) ?? process.cwd();

  return { consumer: given(opts.consumerRoot) ?? ws, src: given(opts.sourceRoot) ?? ws, ws };
}

function checked(roots: Roots): UnionResult {
  const failures = checkUnion({ consumerRoot: roots.consumer, sourceRoot: roots.src, workspaceRoot: roots.ws });

  if (failures.length > 0) return { check: true, error: `drift: ${failures.join("; ")}`, failures, ok: false };

  return { check: true, failures: [], ok: true };
}

export function applyUnion(opts: UnionOptions | string = {}): UnionResult {
  const roots = resolveRoots(opts);

  if (typeof opts === "object" && opts.check === true) return checked(roots);
  applyClaude(roots);
  applyCodex(roots);
  applyAgents(roots);
  applyCursor(roots);

  return { check: false, ok: true };
}

/** Why `command` in hook file `id` is not the form sync writes, or null when it is. */
function staleOf(id: string, command: string): string | null {
  const hook = hookNameOf(command);

  if (hook !== null) {
    // The stock source may hold the short form, which sync expands; every generated file holds the expanded text.
    const short = id === RULESYNC_ID && command === `repo hook ${hook}`;

    if (command === hookCommand(hook) || short) return null;

    return `${id}: ${hook} hook command is not the one bun repo sync writes for ${hook}: run bun repo sync`;
  }

  const script = AUTORUN_NEEDLES.find((n) => command.includes(n));

  if (script === undefined || isRootCmd(command)) return null;

  return `${id}: ${script} hook command does not find its script from the repo root: run bun repo sync`;
}

function staleCommands(root: string): string[] {
  return COMMAND_FILES.flatMap(([id, rel]) => {
    const p = path.join(root, rel);

    if (!fs.existsSync(p)) return [];
    const data: unknown = JSON.parse(stripJsonc(fs.readFileSync(p, "utf8")));

    return allCommands(data).flatMap((command) => staleOf(id, command) ?? []);
  });
}

function fileSpecs(roots: Roots): FileSpec[] {
  const autorun = presentAutorun(roots.consumer);
  const map = mapHooks(roots.src);
  const worktree: HookName[] = ships(roots.src, "worktree") ? ["worktree"] : [];

  return [
    {
      hooks: [...OWNED_HOOKS, ...map, ...worktree],
      id: "claude",
      needles: [...autorun, ...loadConsumerDeny(roots)],
      path: CLAUDE_SETTINGS,
    },
    { hooks: [...OWNED_HOOKS, ...map], id: "codex", needles: autorun, path: CODEX_HOOKS },
    { hooks: OWNED_HOOKS, id: "agents", needles: autorun, path: AGENTS_HOOKS },
    { hooks: OWNED_HOOKS, id: "cursor", needles: autorun, path: CURSOR_HOOKS },
  ];
}

function specFailures(root: string, spec: FileSpec): string[] {
  const p = path.join(root, spec.path);

  if (!fs.existsSync(p)) return [`${spec.id}: missing ${spec.path}`];
  const text = fs.readFileSync(p, "utf8");
  const present = new Set(allCommands(JSON.parse(text)).map(hookNameOf));

  return [
    ...spec.hooks.filter((h) => !present.has(h)).map((h) => `${spec.id}: missing ${h}`),
    ...spec.needles.filter((n) => !text.includes(n)).map((n) => `${spec.id}: missing ${n}`),
  ];
}

function gitHookFailures(consumer: string): string[] {
  if (!fs.existsSync(path.join(consumer, GIT_HOOKS_DIR))) return [];

  return GIT_HOOKS.filter((rel) => !fs.existsSync(path.join(consumer, rel))).map((rel) => `git-hook missing: ${rel}`);
}

export function checkUnion(opts: UnionOptions | string = {}): string[] {
  const roots = resolveRoots(opts);
  const specs = fileSpecs(roots);

  return [
    ...staleCommands(roots.ws),
    ...specs.flatMap((spec) => specFailures(roots.ws, spec)),
    ...gitHookFailures(roots.consumer),
  ];
}
