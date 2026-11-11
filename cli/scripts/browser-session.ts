/** The browser session on disk: where it lives, its JSON, and whether its engine still runs. */
import fs from "node:fs";
import path from "node:path";

import { ENGINES, ERROR_PREFIX, JSON_INDENT, SESSION_FILE, SESSION_REL } from "./browser.constants.ts";
import type { BrowserResult, Engine, Rec, RefEntry, Session } from "./browser.types.ts";
import { isRecord } from "./hook-input.ts";
import { resolveRoots } from "./workspace-root.ts";

/** `v` when it is a record, else an empty one. */
export function asRec(v: unknown): Rec {
  return isRecord(v) ? v : {};
}

/** `v` as text: a string as is, a number or boolean spelled out, anything else empty. */
export function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  return typeof v === "number" || typeof v === "boolean" ? String(v) : "";
}

/** `v` as a number; 0 when it is not one. */
export function numberOf(v: unknown): number {
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

/** `s`, or undefined when it is empty. */
export function filled(s: string | undefined): string | undefined {
  return s === "" ? undefined : s;
}

/** The message of a thrown value. */
export function errMessage(e: unknown): string {
  return String(asRec(e).message);
}

/** The session dir under the root `cwd` sits in. */
export function sessionDir(cwd?: string): string {
  return path.join(resolveRoots({}, { cwd: filled(cwd) ?? process.cwd() }).root, SESSION_REL);
}

function sessionFile(cwd?: string): string {
  return path.join(sessionDir(cwd), SESSION_FILE);
}

function engineOf(v: unknown): Engine | null {
  return ENGINES.find((e) => e === v) ?? null;
}

function toRefs(v: unknown): Record<string, RefEntry> {
  const lastRefs: Record<string, RefEntry> = {};
  for (const [id, e] of Object.entries(asRec(v))) {
    if (!isRecord(e)) continue;
    lastRefs[id] = {
      backendNodeId: e.backendNodeId,
      name: textOf(e.name),
      nodeId: e.nodeId,
      role: textOf(e.role),
    };
  }
  return lastRefs;
}

function toSession(v: unknown): Session | null {
  if (!isRecord(v)) return null;
  const engine = engineOf(v.engine);
  const port = Number(v.port);
  if (engine === null || !Number.isFinite(port)) return null;
  return {
    engine,
    escalated: v.escalated === true,
    lastRefs: toRefs(v.lastRefs),
    lastURL: textOf(v.lastURL),
    pid: typeof v.pid === "number" ? v.pid : undefined,
    port,
    swapCount: numberOf(v.swapCount),
  };
}

/** A session just launched on `engine`, with no page and no refs. */
export function newSession(engine: Engine, pid: number | undefined, port: number): Session {
  return {
    engine,
    escalated: false,
    lastRefs: {},
    lastURL: "",
    pid,
    port,
    swapCount: 0,
  };
}

/** The stored session; null when there is none or it does not parse. */
export function readSession(cwd?: string): Session | null {
  const f = sessionFile(cwd);
  if (!fs.existsSync(f)) return null;
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(f, "utf8"));
    return toSession(raw);
  } catch {
    return null;
  }
}

/** Whether `pid` names a running process. */
export function alive(pid: number | undefined): boolean {
  if (pid === undefined || pid === 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The stored session when its engine still runs. */
export function liveSession(cwd: string): Session | null {
  const session = readSession(cwd);
  return session !== null && alive(session.pid) ? session : null;
}

export function writeSession(cwd: string, session: Session): void {
  fs.mkdirSync(sessionDir(cwd), { recursive: true });
  fs.writeFileSync(sessionFile(cwd), `${JSON.stringify(session, null, JSON_INDENT)}\n`);
}

export function clearSession(cwd: string): void {
  try {
    fs.unlinkSync(sessionFile(cwd));
  } catch {
    // no session to clear
  }
}

/** A verb that worked: its stdout, ending in one newline. */
export function ok(stdout: string): BrowserResult {
  return {
    code: 0,
    stderr: "",
    stdout: stdout.endsWith("\n") ? stdout : `${stdout}\n`,
  };
}

/** A verb that failed: its message without an `Error:` prefix, ending in one newline. */
export function fail(stderr: string): BrowserResult {
  const msg = stderr.replace(ERROR_PREFIX, "");
  return { code: 1, stderr: msg.endsWith("\n") ? msg : `${msg}\n`, stdout: "" };
}
