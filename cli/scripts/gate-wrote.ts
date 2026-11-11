/** The files a session wrote, kept in `<root>/.tmp/repo/sessions/<sid>/wrote.txt`, so a re-read can be sent to a slice. */
import fs from "node:fs";
import path from "node:path";

import type { Harness } from "./gate-harness.ts";
import { jobCommand, quoteQuery, shellPath } from "./gate-job.ts";
import { isUnder } from "./gate-paths.ts";
import { DEFAULT_READ_LIMIT, REASON_REREAD } from "./gate.constants.ts";
import { resolveTyped, type Roots } from "./workspace-root.ts";

export function wroteListPath(workspaceRoot: string | null | undefined, sid: string): string {
  if (!workspaceRoot || !sid) return "";
  return path.join(workspaceRoot, ".tmp", "repo", "sessions", sid, "wrote.txt");
}

/** Absolute posix key for a file this session wrote, or "" when it is outside the root and checkout. */
function wroteKey(roots: Roots, filePath: string): string {
  const abs = resolveTyped(roots, filePath);
  if (!isUnder(roots.root, abs) && !isUnder(roots.checkout, abs)) return "";
  return abs.replaceAll("\\", "/");
}

/** The non-empty lines of the list at `dest`, empty when it cannot be read. */
function wroteLines(dest: string): string[] {
  try {
    const lines = fs.readFileSync(dest, "utf8").split(/\n/);
    return lines.map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function recordWrote(roots: Roots | null | undefined, sid: string, filePath: string): void {
  if (!roots || !sid || !filePath) return;
  const key = wroteKey(roots, filePath);
  if (!key) return;
  const dest = wroteListPath(roots.root, sid);
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
  } catch {
    return;
  }
  const lines = wroteLines(dest);
  if (lines.includes(key)) return;
  lines.push(key);
  fs.writeFileSync(dest, `${lines.join("\n")}\n`);
}

export function wasWroteThisSession(roots: Roots | null | undefined, sid: string, filePath: string): boolean {
  if (!roots || !sid || !filePath) return false;
  const key = wroteKey(roots, filePath);
  return Boolean(key) && wroteLines(wroteListPath(roots.root, sid)).includes(key);
}

/** Cursor's Read takes no offset or limit, so its re-read reason names a command that does the slicing. */
export function rereadReasonFor(harness: Harness, absPath: string, checkout: string): string {
  if (harness !== "cursor") return REASON_REREAD;
  const slice = jobCommand(
    checkout,
    `--job exec --query ${quoteQuery(`sed -n 1,${DEFAULT_READ_LIMIT}p ${shellPath(absPath)}`)}`,
  );
  return `already wrote this session; Cursor Read takes no offset or limit, so slice it with ${slice}`;
}
