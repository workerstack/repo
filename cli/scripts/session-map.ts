#!/usr/bin/env bun
/**
 * SessionStart hook: inject the code-only folder map as additionalContext.
 * Logs { rows, tokens } to .tmp/repo/sessions/<sid>/map.json for tuning.
 * Fail-open: any error, no git, or an empty map → empty stdout, exit 0.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseHookInput, type HookInput } from "./hook-input.ts";
import { resolveRoots } from "./workspace-root.ts";
import { recordHook } from "./board.ts";
import { folderMap, type FolderMapResult } from "./folder-map.ts";
import { resolveRepoBin } from "./gate-fat-tools.ts";

/** First line of the injected map; `depth` = levels per package, null when nothing was cut. */
export function header(depth: number | null | undefined): string {
  const scope = depth == null ? "complete" : `${depth} levels per package`;
  return `Folder map (code folders, ${scope}; \`…\` = deeper, run \`bun repo map <dir>\`):`;
}
/** Claude Code caps each hook's additionalContext at 10,000 chars; above it, only a 2KB preview stays inline. */
export const HOOK_CONTEXT_CHARS = 10000;
// Covers the header (depth is one or two digits) plus slack.
const RESERVE = header(99).length + 1 + 100;

function readStdin(): HookInput {
  try {
    return parseHookInput(fs.readFileSync(0, "utf8")) ?? {};
  } catch {
    return {};
  }
}

function logSize(root: string, data: HookInput, out: FolderMapResult): void {
  const sid = String(data.session_id || data.sessionId || "").replace(/[^\w-]/g, "");
  if (!sid) return;
  const dir = path.join(root, ".tmp", "repo", "sessions", sid);
  fs.mkdirSync(dir, { recursive: true });
  const size = { rows: out.rows, tokens: out.tokens, depth: out.depth };
  fs.writeFileSync(path.join(dir, "map.json"), `${JSON.stringify(size)}\n`);
}

/** The one line a person reads when an uninstalled worktree runs the main checkout's hooks; "" otherwise. */
export function fallbackNotice(checkout: string): string {
  const { bin, fallback } = resolveRepoBin(checkout);
  return fallback ? `repo: hooks run ${bin} (this worktree has no install); run \`bun install\` here to use its own code\n` : "";
}

/** The SessionStart context: the fallback notice, then the folder map; "" when there is neither. */
export function sessionContext(notice: string, out: FolderMapResult | null): string {
  if (!out?.text) return notice;
  return `${notice}${header(/ {2}…$/m.test(out.text) ? out.depth : null)}\n${out.text}`;
}

export function main(): number {
  const data = readStdin();
  recordHook(data, process.env);
  try {
    const roots = resolveRoots(data);
    const notice = fallbackNotice(roots.checkout);
    const out = folderMap({ root: roots.checkout, maxChars: HOOK_CONTEXT_CHARS - RESERVE - notice.length });
    const additionalContext = sessionContext(notice, out);
    if (!additionalContext) return 0;
    try {
      if (out?.text) logSize(roots.root, data, out);
    } catch {
      // Logging is best-effort; the map still ships.
    }
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
  } catch {
    // Fail open.
  }
  return 0;
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  process.exit(main());
}
