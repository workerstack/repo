/** The session gate: /ask and /away stamps, then an in-progress item's `mode:`, and the context naming both. */
import fs from "node:fs";
import path from "node:path";

import { REPO, STATE } from "../repo-dirs.ts";
import type { HookInput } from "./hook-input.ts";
import {
  approvalsFile,
  countsLine,
  frontmatterOf,
  isRealSession,
  readLines,
  sessionDir,
  sessionIdOf,
  unlinkQuiet,
} from "./orchestrate-session.ts";
import { resolveSessionGateStamp, sessionGateStampPath } from "./orchestrate-stamps.ts";
import { AUTO_ASK_STAMP, IN_PROGRESS, SESSION_GATE_STAMP } from "./orchestrate.constants.ts";
import { ASK_MODE, AWAY_MODE } from "./strategy.constants.ts";
import { parseMode } from "./strategy.ts";
import type { Mode } from "./strategy.types.ts";

const SLASHES: readonly (readonly [RegExp, Mode])[] = [
  [/^\s*\/ask\s*$/, "ask"],
  [/^\s*\/away\s*$/, "away"],
];

/** A prompt of exactly /ask or /away stamps that mode as this session's gate and drops the legacy stamp. */
export function applySessionGateSlash(data: HookInput, prompt: string): void {
  const slash = SLASHES.find(([re]) => re.test(prompt))?.[1];

  if (slash === undefined) return;
  const p = sessionGateStampPath(data, SESSION_GATE_STAMP);
  const legacy = sessionGateStampPath(data, AUTO_ASK_STAMP);

  if (p === null || legacy === null) return;
  unlinkQuiet(legacy);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, slash);
}

/** The `mode:` of the newest in-progress plan or roadmap this session saved; null when none holds a valid one. */
function itemMode(data: HookInput): Mode | null {
  const file = approvalsFile(data);

  for (const abs of file === null ? [] : readLines(file).toReversed()) {
    try {
      const fm = frontmatterOf(fs.readFileSync(abs, "utf8"));
      const mode = parseMode(fm.mode);

      if (fm.status === IN_PROGRESS && mode !== null) return mode;
    } catch {
      // skip unreadable
    }
  }

  return null;
}

/** The mode a readable stamp holds: away when it says so, else ask, so a stamp left holding `auto` reads as ask. */
function stampedMode(data: HookInput): Mode | null {
  try {
    const p = resolveSessionGateStamp(data);

    if (p === null) return null;

    return fs.readFileSync(p, "utf8").trim() === AWAY_MODE ? AWAY_MODE : ASK_MODE;
  } catch {
    // An unreadable stamp names no mode.
    return null;
  }
}

/**
 * The mode this session runs: the /ask or /away stamp, else the newest in-progress plan or roadmap in this
 * session's approvals with a valid `mode:`, else `defaultMode`. Another session's files never count.
 */
export function effectiveModeOf(data: HookInput, defaultMode: Mode): Mode {
  return stampedMode(data) ?? itemMode(data) ?? defaultMode;
}

function sessionReceiptContext(data: HookInput): string {
  const sid = sessionIdOf(data);

  if (!isRealSession(sid)) return "";
  const dir = sessionDir(data, sid);

  if (!fs.existsSync(dir)) return "";

  return `${countsLine(dir)} session=${REPO}/${STATE}/sessions/${sid}/`;
}

export function effectiveSessionContext(data: HookInput, defaultMode: Mode): string {
  const gate = effectiveModeOf(data, defaultMode);
  const receipt = sessionReceiptContext(data);

  return receipt === "" ? `sessionGate=${gate}` : `sessionGate=${gate}. ${receipt}`;
}
