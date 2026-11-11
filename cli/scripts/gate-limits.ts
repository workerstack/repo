/** Read, Grep and Glob: which calls are denied, and the limits and ignores the gate adds to the rest. */
import path from "node:path";

import type { GateCall, GuardResult } from "./gate-call.ts";
import type { ToolArgs, ToolSpec } from "./gate-harness.ts";
import {
  DENY_PATH_SEGMENTS,
  collectPathValues,
  fileSizeBytes,
  inStockReferences,
  pathIsDenied,
  readFilePath,
  resolveReadPath,
} from "./gate-paths.ts";
import { rereadReasonFor, wasWroteThisSession } from "./gate-wrote.ts";
import {
  CAMEL_INPUT_KEYS,
  CHILD_GREP_HEAD_LIMIT,
  CHILD_READ_LIMIT,
  DEFAULT_GREP_HEAD_LIMIT,
  DEFAULT_READ_LIMIT,
  DENY_FILE_BYTES,
  MAX_REQUEST_LIMIT,
  NODE_MODULES,
  REASON_DENYLIST,
  REASON_FILE_SIZE,
} from "./gate.constants.ts";
import type { Roots } from "./workspace-root.ts";

export const GLOB_IGNORE: string[] = [...DENY_PATH_SEGMENTS, ".git"];

const SEARCH_KINDS: readonly ToolSpec["kind"][] = ["read", "grep", "glob"];
const deny = (reason: string): GuardResult => ({ reason, type: "deny" });

/** A limit field the gate may add or cap: its snake and camel spellings and the value it injects. */
interface Limit {
  input: ToolArgs;
  snake: string;
  camel: string;
  value: number;
}

function asNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hasEither(input: ToolArgs, a: string, b: string): boolean {
  return Object.hasOwn(input, a) || Object.hasOwn(input, b);
}

function usesCamelInput(input: ToolArgs): boolean {
  return Object.keys(input).some((k) => CAMEL_INPUT_KEYS.includes(k));
}

/** Sets a limit in the spelling the input uses. */
function setLimit(next: ToolArgs, { input, snake, camel, value }: Limit): void {
  next[usesCamelInput(input) ? camel : snake] = value;
}

/** Caps a limit over the maximum or adds a missing one; true when `next` changed. */
function applyLimit(next: ToolArgs, limit: Limit): boolean {
  const { input, snake, camel } = limit;
  const requested = asNumber(input[snake] ?? input[camel]);
  const over = requested !== null && requested > MAX_REQUEST_LIMIT;
  if (!over && hasEither(input, snake, camel)) return false;
  setLimit(next, limit);
  return true;
}

function setMissingIgnore(next: ToolArgs, input: ToolArgs): boolean {
  if (hasEither(input, "ignore", "ignoreGlobs")) return false;
  // A search rooted in the stock references would otherwise ignore its own base.
  const list = collectPathValues(input).some(inStockReferences)
    ? GLOB_IGNORE.filter((seg) => seg !== NODE_MODULES)
    : GLOB_IGNORE.slice();
  next[usesCamelInput(input) ? "ignoreGlobs" : "ignore"] = list;
  return true;
}

/** Applies the limit or ignore the call's kind takes; true when `next` changed. */
function applyKind({ tool, input, parent }: GateCall, next: ToolArgs): boolean {
  const limited = tool.limits !== false;
  if (tool.kind === "grep") {
    const value = parent ? DEFAULT_GREP_HEAD_LIMIT : CHILD_GREP_HEAD_LIMIT;
    return limited && applyLimit(next, { camel: "headLimit", input, snake: "head_limit", value });
  }
  if (tool.kind === "read") {
    const value = parent ? DEFAULT_READ_LIMIT : CHILD_READ_LIMIT;
    return limited && applyLimit(next, { camel: "limit", input, snake: "limit", value });
  }
  return setMissingIgnore(next, input);
}

/** Adds the default limit and ignore the call lacks and caps one above the maximum; null when nothing changed. */
export function limitsGuard(call: GateCall): GuardResult {
  if (!SEARCH_KINDS.includes(call.tool.kind)) return undefined;
  const next = { ...call.input };
  return applyKind(call, next) ? { type: "rewrite", updatedInput: next } : null;
}

/** True when the Glob names a directory, or a leaf of it, on the denylist. */
function globDirDenied(input: ToolArgs, roots: Roots): boolean {
  const raw = input.target_directory || input.targetDirectory || input.path || "";
  if (typeof raw !== "string" || !raw) return false;
  const abs = path.isAbsolute(raw) ? raw : path.resolve(roots.cwd, raw);
  return pathIsDenied(abs) || pathIsDenied(path.basename(abs));
}

/** The deny for a Read of a file over the size cap, or of one this session wrote and reads whole. */
function readDeny({ input, roots, sid, harness }: GateCall): GuardResult {
  const abs = resolveReadPath(readFilePath(input), roots);
  const size = fileSizeBytes(abs);
  if (size !== null && size > DENY_FILE_BYTES) return deny(REASON_FILE_SIZE);
  const sliced = hasEither(input, "offset", "limit");
  if (sid && abs && !sliced && wasWroteThisSession(roots, sid, abs)) {
    return deny(rereadReasonFor(harness, abs, roots.checkout));
  }
  return undefined;
}

/** Denies a Read, Grep or Glob that names a denylisted path; a Read also by size and by re-reading a file it wrote. */
export function pathGuard(call: GateCall): GuardResult {
  const { tool, input, roots } = call;
  if (!SEARCH_KINDS.includes(tool.kind)) return undefined;
  if (collectPathValues(input).some(pathIsDenied)) return deny(REASON_DENYLIST);
  if (tool.kind === "glob" && globDirDenied(input, roots)) return deny(REASON_DENYLIST);
  return tool.kind === "read" ? readDeny(call) : undefined;
}
