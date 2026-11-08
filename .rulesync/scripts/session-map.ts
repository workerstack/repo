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

/** First line of the injected map; `depth` = levels per package, null when nothing was cut. */
export function header(depth: number | null | undefined): string {
  const scope = depth == null ? "complete" : `${depth} levels per package`;
  return `Folder map (code folders, ${scope}; \`…\` = deeper, run \`bun .rulesync/scripts/folder-map.ts <dir>\`):`;
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

function main() {
  const data = readStdin();
  recordHook(data, process.env);
  try {
    const roots = resolveRoots(data);
    const out = folderMap({ root: roots.checkout, maxChars: HOOK_CONTEXT_CHARS - RESERVE });
    if (!out || !out.text) return 0;
    try {
      logSize(roots.root, data, out);
    } catch {
      // Logging is best-effort; the map still ships.
    }
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: `${header(/ {2}…$/m.test(out.text) ? out.depth : null)}\n${out.text}`,
        },
      }),
    );
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
