/** Per-session stamps under the orchestrator logs dir. */
import fs from "node:fs";
import path from "node:path";

import type { HookInput } from "./hook-input.ts";
import { isRealSession, sessionIdOf, unlinkQuiet } from "./orchestrate-session.ts";
import { DECIMAL, NO_SESSION, ORCHESTRATOR_LOGS_DIR, SESSION_GATE_STAMP } from "./orchestrate.constants.ts";
import { resolveRoots } from "./workspace-root.ts";

/** The stamp `prefix`, for this session or the default one. */
function stampIn(data: HookInput, prefix: string): string {
  const sid = sessionIdOf(data);

  return path.join(resolveRoots(data).root, ORCHESTRATOR_LOGS_DIR, `${prefix}-${sid === "" ? NO_SESSION : sid}`);
}

/** The stamp when it exists; null when it does not. */
export function resolveStamp(data: HookInput, prefix: string): string | null {
  const p = stampIn(data, prefix);

  return fs.existsSync(p) ? p : null;
}

export function writeStamp(data: HookInput, prefix: string, body: string): void {
  const p = stampIn(data, prefix);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

/** The count a stamp holds; 0 when it is missing or holds no count. */
export function readStampInt(data: HookInput, prefix: string): number {
  const p = resolveStamp(data, prefix);

  if (p === null) return 0;
  const n = parseInt(fs.readFileSync(p, "utf8"), DECIMAL);

  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function unlinkStamp(data: HookInput, prefix: string): void {
  unlinkQuiet(stampIn(data, prefix));
}

export function stampMtime(data: HookInput, prefix: string): number | null {
  const p = resolveStamp(data, prefix);

  return p === null ? null : fs.statSync(p).mtimeMs;
}

/** A session gate stamp in the new dir; null when the payload names no real session. */
export function sessionGateStampPath(data: HookInput, prefix: string): string | null {
  const root = resolveRoots(data).root;
  const sid = sessionIdOf(data);

  if (root === "" || !isRealSession(sid)) return null;

  return path.join(root, ORCHESTRATOR_LOGS_DIR, `${prefix}-${sid}`);
}

/** The /ask or /away stamp this session holds; null when none. */
export function resolveSessionGateStamp(data: HookInput): string | null {
  const p = sessionGateStampPath(data, SESSION_GATE_STAMP);

  return p !== null && fs.existsSync(p) ? p : null;
}
