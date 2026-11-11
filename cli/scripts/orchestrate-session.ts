/** The session's own files under .tmp/repo/sessions/<sid>/, and the frontmatter reads they share. */
import fs from "node:fs";
import path from "node:path";

import { readEnv } from "../env.ts";
import { firstNonEmpty } from "./first-non-empty.ts";
import type { HookInput } from "./hook-input.ts";
import { NO_SESSION } from "./orchestrate.constants.ts";
import { resolveRoots } from "./workspace-root.ts";

const LINE_BREAK = /\r?\n/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const FRONTMATTER_LINE = /^([a-z]+):\s*(.*)$/;

export function sessionIdOf(data: HookInput): string {
  return firstNonEmpty(readEnv().GROK_SESSION_ID, data.sessionId, data.session_id) ?? "";
}

/** A session id that names a real session. */
export function isRealSession(sid: string): boolean {
  return Boolean(sid) && sid !== NO_SESSION;
}

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
export function approvalsFile(data: HookInput): string | null {
  return sessionFile(data, "approvals.txt");
}

/** A file's trimmed non-empty lines; none when it cannot be read. */
export function readLines(file: string): string[] {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split(LINE_BREAK)
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
  if (file === null || readLines(file).includes(abs)) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${abs}\n`);
  } catch {
    // fail-open
  }
}

/** The `key: value` lines of a file's leading frontmatter block. */
export function frontmatterOf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const [, body = ""] = FRONTMATTER.exec(text) ?? [];
  for (const line of body.split(LINE_BREAK)) {
    const [, key, value = ""] = FRONTMATTER_LINE.exec(line) ?? [];
    if (key !== undefined) out[key] = value.trim();
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
