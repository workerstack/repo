#!/usr/bin/env node
/**
 * SessionStart hook: inject the code-only folder map as additionalContext.
 * Logs { rows, tokens } to .tmp/grunt/sessions/<sid>/map.json for tuning.
 * Fail-open: any error, no git, or an empty map → empty stdout, exit 0.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { folderMap } from "./folder-map.mjs";

export const HEADER =
  "Folder map (code folders only; `…` = more inside, run `node scripts/folder-map.mjs <dir>`):";

function readStdin() {
  try {
    const v = JSON.parse(fs.readFileSync(0, "utf8"));
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function workspaceRootOf(data) {
  return (
    process.env.GROK_WORKSPACE_ROOT ||
    data.workspaceRoot ||
    data.workspace_root ||
    data.cwd ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd()
  );
}

function logSize(root, data, out) {
  const sid = String(data.session_id || data.sessionId || "").replace(/[^\w-]/g, "");
  if (!sid) return;
  const dir = path.join(root, ".tmp", "grunt", "sessions", sid);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "map.json"), `${JSON.stringify({ rows: out.rows, tokens: out.tokens })}\n`);
}

function main() {
  try {
    const data = readStdin();
    const root = workspaceRootOf(data);
    const out = folderMap({ root });
    if (!out || !out.text) return 0;
    try {
      logSize(root, data, out);
    } catch {
      // Logging is best-effort; the map still ships.
    }
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: `${HEADER}\n${out.text}`,
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
