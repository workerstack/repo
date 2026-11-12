/** Per-session stamps under the orchestrator logs dir, read from the legacy dir for one release. */
import fs from "node:fs";
import path from "node:path";

import type { HookInput } from "./hook-input.ts";
import { isRealSession, sessionIdOf, unlinkQuiet } from "./orchestrate-session.ts";
import {
  AUTO_ASK_STAMP,
  DECIMAL,
  LEGACY_ORCHESTRATOR_LOGS_DIR,
  NO_SESSION,
  ORCHESTRATOR_LOGS_DIR,
  SESSION_GATE_STAMP,
} from "./orchestrate.constants.ts";
import { resolveRoots } from "./workspace-root.ts";

/** The stamp `prefix` in `dir`, for this session or the default one. */
function stampIn(data: HookInput, dir: string, prefix: string): string {
  const sid = sessionIdOf(data);

  return path.join(resolveRoots(data).root, dir, `${prefix}-${sid === "" ? NO_SESSION : sid}`);
}

/** The stamp that exists, new dir first; null when neither does. */
export function resolveStamp(data: HookInput, prefix: string): string | null {
  for (const dir of [ORCHESTRATOR_LOGS_DIR, LEGACY_ORCHESTRATOR_LOGS_DIR]) {
    const p = stampIn(data, dir, prefix);

    if (fs.existsSync(p)) return p;
  }

  return null;
}

export function writeStamp(data: HookInput, prefix: string, body: string): void {
  const p = stampIn(data, ORCHESTRATOR_LOGS_DIR, prefix);
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
  unlinkQuiet(stampIn(data, ORCHESTRATOR_LOGS_DIR, prefix));
  unlinkQuiet(stampIn(data, LEGACY_ORCHESTRATOR_LOGS_DIR, prefix));
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

/** The /ask or /away stamp this session holds, new name and dir first; null when none. */
export function resolveSessionGateStamp(data: HookInput): string | null {
  for (const prefix of [SESSION_GATE_STAMP, AUTO_ASK_STAMP]) {
    const neu = sessionGateStampPath(data, prefix);

    if (neu !== null && fs.existsSync(neu)) return neu;
    const old = path.join(resolveRoots(data).root, LEGACY_ORCHESTRATOR_LOGS_DIR, `${prefix}-${sessionIdOf(data)}`);

    if (sessionIdOf(data) !== "" && fs.existsSync(old)) return old;
  }

  return null;
}
