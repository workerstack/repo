/** The session's own files under .tmp/repo/sessions/<sid>/, and the frontmatter reads they share. */
import fs from "node:fs";
import path from "node:path";

import { readEnv } from "../env.ts";
import type { HookInput } from "./hook-input.ts";
import { NO_SESSION } from "./orchestrate.constants.ts";
import { resolveRoots } from "./workspace-root.ts";

export function sessionIdOf(data: HookInput): string {
  return readEnv().GROK_SESSION_ID || data.sessionId || data.session_id || "";
}

/** A session id that names a real session. */
export const isRealSession = (sid: string): boolean => Boolean(sid) && sid !== NO_SESSION;

/** The session's dir under the workspace's .tmp/repo/sessions. */
export function sessionDir(data: HookInput, sid: string): string {
  return path.join(resolveRoots(data).root, ".tmp", "repo", "sessions", sid);
}

/** A file in this session's dir; null when the payload names no real session. */
export function sessionFile(data: HookInput, name: string): string | null {
  const sid = sessionIdOf(data);
  return isRealSession(sid) ? path.join(sessionDir(data, sid), name) : null;
}

/** The plans and roadmaps this session saved, one absolute path a line, in first-save order. */
export const approvalsFile = (data: HookInput): string | null => sessionFile(data, "approvals.txt");

/** A file's trimmed non-empty lines; none when it cannot be read. */
export function readLines(file: string): string[] {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function countLines(file: string): number {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean).length;
  } catch {
    return 0;
  }
}

/** What the session wrote and read, as the receipt and the prompt context both say it. */
export function countsLine(dir: string): string {
  return `${countLines(path.join(dir, "wrote.txt"))} wrote, ${countLines(path.join(dir, "read.txt"))} read.`;
}

export function recordApproval(data: HookInput, abs: string): void {
  const file = approvalsFile(data);
  if (!file || readLines(file).includes(abs)) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, abs + "\n");
  } catch {
    // fail-open
  }
}

/** The `key: value` lines of a file's leading frontmatter block. */
export function frontmatterOf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const [, body = ""] = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text) ?? [];
  for (const line of body.split(/\r?\n/)) {
    const [, key, value = ""] = /^([a-z]+):\s*(.*)$/.exec(line) ?? [];
    if (key) out[key] = value.trim();
  }
  return out;
}

export function unlinkQuiet(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch {
    // missing is fine
  }
}
