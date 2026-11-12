/** The browser session on disk: where it lives, its JSON, and whether its engine still runs. */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { isRecord, type Json, tryJson } from "../json.ts";
import { ENGINES, ERROR_PREFIX, JSON_INDENT, SESSION_FILE, SESSION_REL } from "./browser.constants.ts";
import type { BrowserResult, Engine, Rec, RefEntry, Session } from "./browser.types.ts";
import { resolveRoots } from "./workspace-root.ts";

/** `v` when it is a record, else an empty one. */
export function asRec(v: Json | undefined): Rec {
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

/** The port a server listening on TCP is bound to; `server.address()` is a pipe path or null only off TCP. */
export function boundPort(address: unknown): number {
  return z.object({ port: z.number() }).parse(address).port;
}

/** The message of a thrown value. */
export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The session dir under the root `cwd` sits in. */
export function sessionDir(cwd?: string): string {
  return path.join(resolveRoots({}, { cwd: filled(cwd) ?? process.cwd() }).root, SESSION_REL);
}

function sessionFile(cwd?: string): string {
  return path.join(sessionDir(cwd), SESSION_FILE);
}

/**
 * The stored session: a known engine and a numeric port, or no session. Every other field falls back as textOf and
 * numberOf read it, and a ref that is not an object is dropped.
 */
function sessionSchema() {
  const text = z.union([z.string(), z.number(), z.boolean()]).transform(String).catch("");

  const ref = z
    .object({ backendNodeId: z.json().optional(), name: text, nodeId: z.json().optional(), role: text })
    .transform((e): RefEntry => ({ backendNodeId: e.backendNodeId, name: e.name, nodeId: e.nodeId, role: e.role }));

  return z.object({
    engine: z.literal(ENGINES),
    escalated: z.boolean().catch(false),
    lastRefs: z
      .record(z.string(), ref.nullable().catch(null))
      .catch({})
      .transform((refs) => keptRefs(refs)),
    lastURL: text,
    pid: z.number().optional().catch(undefined),
    port: z.coerce.number(),
    swapCount: z.coerce.number().catch(0),
  });
}

function keptRefs(refs: Record<string, RefEntry | null>): Record<string, RefEntry> {
  return Object.fromEntries(Object.entries(refs).filter((entry): entry is [string, RefEntry] => entry[1] !== null));
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
  try {
    return tryJson(sessionSchema(), fs.readFileSync(sessionFile(cwd), "utf8")) ?? null;
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
