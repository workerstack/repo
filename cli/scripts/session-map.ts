#!/usr/bin/env bun
/**
 * SessionStart hook: inject the code-only folder map as additionalContext.
 * Logs { rows, tokens } to .tmp/repo/sessions/<sid>/map.json for tuning.
 * Fail-open: any error, no git, or an empty map → empty stdout, exit 0.
 */
import fs from "node:fs";
import path from "node:path";

import { repoEnv } from "../repo-env.ts";
import { recordHook } from "./board-hook.ts";
import { nonEmptyOr } from "./emit-inputs.ts";
import { folderMap } from "./folder-map.ts";
import type { FolderMapResult } from "./folder-map.types.ts";
import { resolveRepoBin } from "./gate-job.ts";
import type { HookInput } from "./hook-input.ts";
import { processHookIo, readHookInput, type HookIo } from "./hook-io.ts";
import { HEADER_SLACK, WIDEST_DEPTH } from "./session-map.constants.ts";
import { resolveRoots } from "./workspace-root.ts";

/** Any char a session id may not carry into a folder name. */
const UNSAFE_SID_CHAR = /[^\w-]/g;

/** A map row cut short: two spaces, then the `…` the map puts where it stopped descending. */
const CUT_ROW = / {2}…$/m;

/** First line of the injected map; `depth` = levels per package, null when nothing was cut. */
export function header(depth: number | null | undefined): string {
  const scope = depth == null ? "complete" : `${depth} levels per package`;

  return `Folder map (code folders, ${scope}; \`…\` = deeper, run \`bun repo map <dir>\`):`;
}

/** Claude Code caps each hook's additionalContext at 10,000 chars; above it, only a 2KB preview stays inline. */
export const HOOK_CONTEXT_CHARS = 10000;

/** The chars the header and its newline take, at the widest depth, plus slack. */
function reserve(): number {
  return header(WIDEST_DEPTH).length + 1 + HEADER_SLACK;
}

function logSize(root: string, data: HookInput, out: FolderMapResult): void {
  const sid = (nonEmptyOr(data.session_id, data.sessionId) ?? "").replaceAll(UNSAFE_SID_CHAR, "");

  if (sid === "") return;
  const dir = path.join(root, ".tmp", "repo", "sessions", sid);
  fs.mkdirSync(dir, { recursive: true });
  const size = { depth: out.depth, rows: out.rows, tokens: out.tokens };
  fs.writeFileSync(path.join(dir, "map.json"), `${JSON.stringify(size)}\n`);
}

/** The one line a person reads when an uninstalled worktree runs the main checkout's hooks; "" otherwise. */
export function fallbackNotice(checkout: string): string {
  const { bin, fallback } = resolveRepoBin(checkout);

  return fallback
    ? `repo: hooks run ${bin} (this worktree has no install); run \`bun install\` here to use its own code\n`
    : "";
}

/** The SessionStart context: the fallback notice, then the folder map; "" when there is neither. */
export function sessionContext(notice: string, out: FolderMapResult | null): string {
  if (out === null || out.text === "") return notice;

  return `${notice}${header(CUT_ROW.test(out.text) ? out.depth : null)}\n${out.text}`;
}

export function main(_argv: string[] = [], io: HookIo = processHookIo()): number {
  const data = readHookInput(io) ?? {};
  recordHook(data, repoEnv.process);

  try {
    const roots = resolveRoots(data);
    const notice = fallbackNotice(roots.checkout);
    const out = folderMap({ maxChars: HOOK_CONTEXT_CHARS - reserve() - notice.length, root: roots.checkout });
    const additionalContext = sessionContext(notice, out);

    if (additionalContext === "") return 0;

    try {
      if (out !== null && out.text !== "") logSize(roots.root, data, out);
    } catch {
      // Logging is best-effort; the map still ships.
    }

    io.write(JSON.stringify({ hookSpecificOutput: { additionalContext, hookEventName: "SessionStart" } }));
  } catch {
    // Fail open.
  }

  return 0;
}
