/** The session gate: /auto, /ask and /away stamps, an in-progress item's `mode:`, and the context naming both. */
import fs from "node:fs";
import path from "node:path";

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
import { parseMode, type Mode } from "./strategy.ts";

const SLASHES: readonly (readonly [RegExp, Mode])[] = [
  [/^\s*\/auto\s*$/, "auto"],
  [/^\s*\/ask\s*$/, "ask"],
  [/^\s*\/away\s*$/, "away"],
];

/** A prompt of exactly /auto, /ask or /away sets this session's gate; /auto clears the stamp. */
export function applySessionGateSlash(data: HookInput, prompt: string): void {
  const slash = SLASHES.find(([re]) => re.test(prompt))?.[1];
  if (!slash) return;
  const p = sessionGateStampPath(data, SESSION_GATE_STAMP);
  const legacy = sessionGateStampPath(data, AUTO_ASK_STAMP);
  if (!p || !legacy) return;
  unlinkQuiet(legacy);
  if (slash === "auto") {
    unlinkQuiet(p);
    return;
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, slash);
}

/** The `mode:` of the newest in-progress plan or roadmap this session saved; null when none holds a valid one. */
function itemMode(data: HookInput): Mode | null {
  const file = approvalsFile(data);
  for (const abs of file ? readLines(file).reverse() : []) {
    try {
      const fm = frontmatterOf(fs.readFileSync(abs, "utf8"));
      const mode = parseMode(fm.mode);
      if (fm.status === IN_PROGRESS && mode) return mode;
    } catch {
      // skip unreadable
    }
  }
  return null;
}

function stampedMode(data: HookInput): Mode | null {
  let mode: Mode | null = null;
  try {
    const p = resolveSessionGateStamp(data);
    mode = p ? parseMode(fs.readFileSync(p, "utf8").trim()) : null;
  } catch {
    // An unreadable stamp names no mode.
  }
  return mode;
}

/**
 * The mode this session runs: the newest in-progress plan or roadmap in this session's approvals with a valid `mode:`,
 * else the /ask or /away stamp, else auto. Another session's files never count.
 */
export function effectiveModeOf(data: HookInput): Mode {
  return itemMode(data) ?? stampedMode(data) ?? "auto";
}

function sessionReceiptContext(data: HookInput): string {
  const sid = sessionIdOf(data);
  if (!isRealSession(sid)) return "";
  const dir = sessionDir(data, sid);
  if (!fs.existsSync(dir)) return "";
  return `${countsLine(dir)} session=.tmp/repo/sessions/${sid}/`;
}

export function effectiveSessionContext(data: HookInput): string {
  const gate = effectiveModeOf(data);
  const receipt = sessionReceiptContext(data);
  return receipt ? `sessionGate=${gate}. ${receipt}` : `sessionGate=${gate}`;
}
