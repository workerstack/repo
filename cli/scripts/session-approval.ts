/** The session gate: /ask and /away stamps, then an in-progress item's `approval:`, and the context naming both. */
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
} from "./orchestrate-session.ts";
import { resolveSessionGateStamp, sessionGateStampPath } from "./orchestrate-stamps.ts";
import { IN_PROGRESS, SESSION_GATE_STAMP } from "./orchestrate.constants.ts";
import { ASK, AWAY } from "./strategy.constants.ts";
import { parseApprovalSetting } from "./strategy.ts";
import type { Approval } from "./strategy.types.ts";

const SLASHES: readonly (readonly [RegExp, Approval])[] = [
  [/^\s*\/ask(?=\s|$)/, "ask"],
  [/^\s*\/away(?=\s|$)/, "away"],
];

/** A prompt that starts with /ask or /away stamps that approval as this session's gate. */
export function applySessionGateSlash(data: HookInput, prompt: string): void {
  const slash = SLASHES.find(([re]) => re.test(prompt))?.[1];

  if (slash === undefined) return;
  const p = sessionGateStampPath(data, SESSION_GATE_STAMP);

  if (p === null) return;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, slash);
}

/** The `approval:` of the newest in-progress plan or roadmap this session saved; null when none holds a valid one. */
function itemApproval(data: HookInput): Approval | null {
  const file = approvalsFile(data);

  for (const abs of file === null ? [] : readLines(file).toReversed()) {
    try {
      const fm = frontmatterOf(fs.readFileSync(abs, "utf8"));
      const approval = parseApprovalSetting(fm.approval);

      if (fm.status === IN_PROGRESS && approval !== null) return approval;
    } catch {
      // skip unreadable
    }
  }

  return null;
}

/** The approval a readable stamp holds: away when it says so, else ask, so a stamp left holding `auto` reads as ask. */
function stampedApproval(data: HookInput): Approval | null {
  try {
    const p = resolveSessionGateStamp(data);

    if (p === null) return null;

    return fs.readFileSync(p, "utf8").trim() === AWAY ? AWAY : ASK;
  } catch {
    // An unreadable stamp names no approval.
    return null;
  }
}

/**
 * The approval this session runs: the /ask or /away stamp, else the newest in-progress plan or roadmap in this
 * session's approvals with a valid `approval:`, else `defaultApproval`. Another session's files never count.
 */
export function effectiveApprovalOf(data: HookInput, defaultApproval: Approval): Approval {
  return stampedApproval(data) ?? itemApproval(data) ?? defaultApproval;
}

function sessionReceiptContext(data: HookInput): string {
  const sid = sessionIdOf(data);

  if (!isRealSession(sid)) return "";
  const dir = sessionDir(data, sid);

  if (!fs.existsSync(dir)) return "";

  return `${countsLine(dir)} session=${REPO}/${STATE}/sessions/${sid}/`;
}

export function effectiveSessionContext(data: HookInput, defaultApproval: Approval): string {
  const gate = effectiveApprovalOf(data, defaultApproval);
  const receipt = sessionReceiptContext(data);

  return receipt === "" ? `approval=${gate}` : `approval=${gate}. ${receipt}`;
}
