#!/usr/bin/env bun
/** PreToolUse fat-gate + persist rewrite. Stop writes session receipt. SubagentStop intercepts need: search|exec|slice|fetch.
Fail-open: parse/crash → empty stdout, exit 0.
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MAX_PROMPT_CHARS,
  rewriteSpawnToolInput,
  spawnCapReason,
} from "../../.rulesync/scripts/scrub-spawn-prompt.ts";
import {
  answerDeny,
  answerRewrite,
  fatHookOutput,
  processFatTools,
  rewriteScratchPath,
  stampPlanSave,
  WRITE_PATH_FIELDS,
} from "../../.rulesync/scripts/gate-fat-tools.ts";
import { projectEdit } from "../../.rulesync/scripts/gitignore-guard.ts";
import { holdingCheckout, LESSONS_DIR, matchLessons, persistLesson } from "../../.rulesync/scripts/lessons.ts";
import { persistPlan, preparePlanUpdate, validatePlan } from "../../.rulesync/scripts/persist-plan.ts";
import { persistRoadmap, prepareRoadmapUpdate, validateRoadmap } from "../../.rulesync/scripts/persist-roadmap.ts";
import { persistHandoff } from "../../.rulesync/scripts/persist-handoff.ts";
import { persistImplementation, isFullImplementationBody, validateImplementation } from "../../.rulesync/scripts/persist-implementation.ts";
import {
  isUnderDir,
  isUnderHandoffs,
  isUnderImplementations,
  isUnderPlans,
  isUnderRoadmaps,
  isUnderTmp,
  persistTmp,
} from "../../.rulesync/scripts/persist-tmp.ts";
import { parseNeed } from "../../.rulesync/scripts/parse-need.ts";
import { resolveJobCwd, runJob } from "../../.rulesync/scripts/job.ts";
import { otherLines, recordHook } from "../../.rulesync/scripts/board.ts";
import { canonicalPath, resolveRoots, resolveTyped, type Roots } from "../../.rulesync/scripts/workspace-root.ts";
import { isRecord, parseHookInput, type HookInput } from "../../.rulesync/scripts/hook-input.ts";
import { gitAskedWords, mainCheckoutWriteReason } from "../../.rulesync/scripts/worktree.ts";
import { closingLine, parseApproval, parseClosingLine, parseStrategy, STRATEGIES, stampPath as strategyStampPath } from "../../.rulesync/scripts/strategy.ts";

type ToolInput = Record<string, unknown>;
type Strategy = (typeof STRATEGIES)[number];
/** A reviewed plan or roadmap, as the closing line names it. */
type Approvable = Parameters<typeof closingLine>[0][number];
interface ApprovalItem extends Approvable {
  path: string;
  mtime: number;
}
/** What every persist function answers to a full-content save. */
type PersistOutcome = { ok: true; path: string; content: string } | { ok: false; error?: string | undefined };
type Persist = (args: { workspaceRoot: string; checkout: string; content: string }) => PersistOutcome;
type StrategyWrite = { ok: true; content: string | null } | { ok: false; error: string };

export const ORCHESTRATOR_LOGS_DIR = ".tmp/repo/orchestrator-logs";
/** One-release dual-read; drop next release. */
export const LEGACY_ORCHESTRATOR_LOGS_DIR = ".tmp/orchestrator-logs";
export const DENY_REASON = "denied";
const TRANSCRIPT_TAIL_BYTES = 512 * 1024;
const SPAWN_TOOLS = new Set([
  "spawnsubagent",
  "task",
  "agent",
  "spawnagent",
]);
const WRITE_TOOLS = new Set([
  "write",
  "edit",
  "searchreplace",
]);
const INTERCEPT_JOBS = new Set(["search", "exec", "slice", "fetch"]);
const MAX_INTERCEPT = 3;
const MAX_STOP = 3;
const AUTO_RE = /^\s*\/auto\s*$/;
const ASK_RE = /^\s*\/ask\s*$/;
export const SESSION_GATE_STAMP = "session-gate";
/** One-release dual-read of 0.5 leftover stamp. */
export const AUTO_ASK_STAMP = "auto-ask";
export const ASK_STOP_REASON = "ask after this step";
const WAIT_SCOUT = "[orchestrator]: wait scout";

export function main(): number {
  try {
    const data = readHookInput() ?? {};
    const event = eventKey(process.env.GROK_HOOK_EVENT || data.hookEventName || data.hook_event_name || "");
    if (event === "pretooluse") return preToolUse(data);
    if (event === "userpromptsubmit") return userPromptSubmit(data);
    if (event === "beforesubmitprompt") return beforeSubmitPrompt(data);
    if (event === "stop") return stop(data);
    if (event === "subagentstop") return interceptNeed(data, "SubagentStop");
    return 0;
  } catch {
    return 0;
  }
}

function preToolUse(data: HookInput): number {
  const toolName = String(data.toolName || data.tool_name || "");
  const toolKey = eventKey(toolName);
  const toolInput = data.toolInput ?? data.tool_input;

  if (SPAWN_TOOLS.has(toolKey)) {
    const updated = rewriteSpawn(toolInput, data);
    if (updated === "denied") return 0;
    if (updated) emit(answerRewrite(data, updated));
    return 0;
  }
  if (WRITE_TOOLS.has(toolKey)) {
    // A full-content plan Write is answered below, before the gate sees it, so the stamp is written here.
    if (typeof toolInput?.content === "string") stampPlanSave(data);
    const persistCode = parentWrite(data, toolInput);
    if (persistCode !== null) return persistCode;
  }
  const fatCode = emitFat(data);
  if (fatCode !== null) return fatCode;
  if (WRITE_TOOLS.has(toolKey)) lessonNotice(data, toolInput);
  return 0;
}

/** The path the host named, in whichever field it used; "" when none. */
function writeTarget(toolInput: ToolInput | undefined): string {
  if (!toolInput) return "";
  for (const key of ["file_path", "filePath", "path", "target_file"]) {
    const v = toolInput[key];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

export function isLessonFile(filePath: string, workspaceRoot: string | null | undefined): boolean {
  return isUnderDir(filePath, workspaceRoot, LESSONS_DIR.split("/"));
}

// Lessons that match a file this session edits, each shown once per session. Fails open.
function lessonNotice(data: HookInput, toolInput: ToolInput | undefined): void {
  try {
    const roots = resolveRoots(data);
    const target = writeTarget(toolInput);
    if (!target) return;
    const abs = resolveTyped(roots, target);
    const holder = holdingCheckout(abs, roots);
    if (isLessonFile(abs, holder) || rewriteScratchPath(abs, roots) || isUnderDir(abs, roots.root, [".tmp", "repo"])) return;
    const rows = matchLessons({ roots, files: [abs] });
    if (!rows.length) return;
    const sid = sessionIdOf(data);
    const seenFile = sid ? path.join(roots.root, ".tmp", "repo", "sessions", sid, "lessons-seen.json") : "";
    let seen: string[] = [];
    if (seenFile) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(seenFile, "utf8"));
        seen = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
      } catch {
        seen = [];
      }
    }
    const fresh = rows.filter((r) => !seen.includes(r.file));
    if (!fresh.length) return;
    if (seenFile) {
      fs.mkdirSync(path.dirname(seenFile), { recursive: true });
      fs.writeFileSync(seenFile, JSON.stringify([...seen, ...fresh.map((r) => r.file)]));
    }
    const rel = path.relative(holder, abs).split(path.sep).join("/");
    const lines = fresh.map((r) => `- ${r.file} (hits ${r.hits}): ${r.summary}`);
    emit({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: `Recorded lessons match ${rel}:\n${lines.join("\n")}`,
      },
    });
  } catch {
    // A lessons read error never blocks an edit.
  }
}

// A lesson Write is validated, rendered, and reindexed in the checkout that holds it, and the host saves it; an Edit
// cannot be reindexed before it lands. The main checkout takes none: the deny answers here, since the gate never sees this Write.
function lessonWrite(data: HookInput, roots: Roots, ws: string, rawPath: string, toolInput: ToolInput): number {
  const abs = path.resolve(ws, rawPath);
  const shared = mainCheckoutWriteReason(abs, roots);
  if (shared) {
    emit(answerDeny(data, shared));
    return 0;
  }
  const body = toolInput.content;
  if (typeof body !== "string") {
    emit(
      answerDeny(
        data,
        "Edit is not allowed on lesson files. Write the full lesson (60 lines max) or run bun repo lessons hit <slug> --evidence <text>",
      ),
    );
    return 0;
  }
  const result = persistLesson({ workspaceRoot: ws, filePath: canonicalPath(abs), content: body });
  if (!result.ok) {
    emit(answerDeny(data, result.error));
    return 0;
  }
  emit(answerRewrite(data, Object.assign(withPath(toolInput, abs), { content: result.content })));
  return 0;
}

function emitFat(data: HookInput): number | null {
  const fat = fatHookOutput(data, processFatTools(data));
  if (!fat) return null;
  emit(fat);
  return 0;
}

// Hosts name the target differently; point every key the host sent at the absolute file.
function withPath(toolInput: ToolInput, abs: string): ToolInput {
  const next: ToolInput = Object.assign({}, toolInput);
  const keys: string[] = WRITE_PATH_FIELDS.filter((key) => typeof next[key] === "string" && next[key]);
  for (const key of keys.length ? keys : ["file_path"]) next[key] = abs;
  return next;
}

// An Edit of a saved plan is checked against the text it would produce; a valid one runs as sent.
function planEdit(data: HookInput, abs: string, toolInput: ToolInput): number | null {
  const previous = fs.readFileSync(abs, "utf8");
  const next = projectEdit(previous, toolInput);
  if (next == null) return null;
  const errors = validatePlan(path.basename(abs), next, { fresh: false, previous });
  if (!errors.length) return null;
  emit(answerDeny(data, errors.join("; ")));
  return 0;
}

// An Edit of a saved roadmap is checked the same way.
function roadmapEdit(data: HookInput, abs: string, toolInput: ToolInput): number | null {
  const previous = fs.readFileSync(abs, "utf8");
  const next = projectEdit(previous, toolInput);
  if (next == null) return null;
  const errors = validateRoadmap(path.basename(abs), next, { fresh: false, previous });
  if (!errors.length) return null;
  emit(answerDeny(data, errors.join("; ")));
  return 0;
}

function parentWrite(data: HookInput, toolInput: ToolInput | undefined): number | null {
  if (!toolInput) {
    emit(answerDeny(data, DENY_REASON));
    return 0;
  }
  const roots = resolveRoots(data);
  const ws = roots.root;
  const typed = writeTarget(toolInput);
  if (!typed) return null;
  const rawPath = rewriteScratchPath(typed, roots) || path.resolve(roots.cwd, typed);
  // Classify in the roots' spelling; answers keep the typed spelling, which Claude Code's read-before-write knows.
  const canon = canonicalPath(rawPath);
  let persist: Persist;
  let approvable = false;
  let invalid = "invalid plan";
  const holder = holdingCheckout(canon, roots);
  if (isLessonFile(canon, holder)) return lessonWrite(data, roots, holder, rawPath, toolInput);
  if (isUnderPlans(canon, ws)) {
    const abs = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(ws, rawPath);
    let exists = false;
    try {
      exists = fs.statSync(abs).isFile();
    } catch {
      exists = false;
    }
    if (exists && typeof toolInput.content !== "string") return approvedEdit(data, abs, planEdit(data, abs, toolInput));
    persist = exists ? (args: Parameters<Persist>[0]) => preparePlanUpdate({ ...args, filePath: abs }) : persistPlan;
    approvable = true;
    invalid = "invalid plan";
  } else if (isUnderRoadmaps(canon, ws)) {
    const roadmapPath = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(ws, rawPath);
    let exists = false;
    try {
      exists = fs.statSync(roadmapPath).isFile();
    } catch {
      exists = false;
    }
    if (exists && typeof toolInput.content !== "string") {
      return approvedEdit(data, roadmapPath, roadmapEdit(data, roadmapPath, toolInput));
    }
    persist = exists ? (args: Parameters<Persist>[0]) => prepareRoadmapUpdate({ ...args, filePath: roadmapPath }) : persistRoadmap;
    approvable = true;
    invalid = "invalid roadmap";
  } else if (isUnderHandoffs(canon, ws)) {
    persist = persistHandoff;
    invalid = "invalid handoff";
  } else if (isUnderImplementations(canon, ws)) {
    persist = persistImplementation;
    invalid = "invalid implementation";
    const abs = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(ws, rawPath);
    const content = typeof toolInput.content === "string" ? toolInput.content : "";
    const named = /^\s*IMPL_NAME:/m.test(content);
    let exists = false;
    try {
      exists = fs.statSync(abs).isFile();
    } catch {
      exists = false;
    }
    if (!named && exists) {
      if (!isFullImplementationBody(content)) return null;
      const errors = validateImplementation(path.basename(abs), content);
      if (errors.length) {
        emit(answerDeny(data, errors.join("; ") || invalid));
        return 0;
      }
      emit(answerRewrite(data, Object.assign(withPath(toolInput, abs), { content })));
      return 0;
    }
  } else if (isUnderTmp(canon, ws)) {
    persist = persistTmp;
    invalid = "invalid tmp";
  } else {
    return null;
  }
  const content = typeof toolInput.content === "string" ? toolInput.content : "";
  const result = persist({ workspaceRoot: ws, checkout: roots.checkout, content });
  if (!result.ok) {
    emit(answerDeny(data, result.error || invalid));
    return 0;
  }
  const saved = path.resolve(ws, result.path);
  if (approvable) recordApproval(data, saved);
  emit(answerRewrite(data, Object.assign(withPath(toolInput, saved), { content: result.content })));
  return 0;
}

// A valid Edit (null) passes through to the host; it still counts as a save.
function approvedEdit(data: HookInput, abs: string, code: number | null): number | null {
  if (code === null) recordApproval(data, abs);
  return code;
}

// One closing line asks for approval; a bare `y` approves exactly what it names.
const APPROVABLE_STATUS: Record<Approvable["kind"], Set<string>> = { plan: new Set(["ready"]), roadmap: new Set(["draft", "locked"]) };
const TURN_START_STAMP = "turn-start";
const APPROVAL_BLOCK_STAMP = "approval-block";

export function closingLineOf(msg: unknown) {
  const lines = String(msg || "")
    .split("\n")
    .map((l) => l.replace(/^[\s`*_>]+/, "").replace(/[\s`*_]+$/, ""))
    .filter(Boolean);
  return parseClosingLine(lines.at(-1) || "");
}

const itemKey = (item: Approvable): string => `${item.kind} ${item.serial}`;
const queueText = (items: Approvable[]): string => items.map(itemKey).join(", then ");

function approvalsFile(data: HookInput): string | null {
  const sid = sessionIdOf(data);
  if (!sid || sid === "default") return null;
  return path.join(resolveRoots(data).root, ".tmp", "repo", "sessions", sid, "approvals.txt");
}

function readLines(file: string): string[] {
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

function recordApproval(data: HookInput, abs: string): void {
  const file = approvalsFile(data);
  if (!file || readLines(file).includes(abs)) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, abs + "\n");
  } catch {
    /* fail-open */
  }
}

function frontmatterOf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return out;
  // Group 1 always participates in a match, so m[1] is a string.
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([a-z]+):\s*(.*)$/.exec(line);
    // Both groups always participate in a match.
    if (kv) out[kv[1]!] = kv[2]!.trim();
  }
  return out;
}

// True when a roadmap slice's Location names this plan; Windows paths compare case-insensitively.
export function isSliceOf(planPath: string, roadmapText: string, impl: typeof path = path): boolean {
  const norm = (p: string): string => {
    const n = impl.normalize(impl.resolve(p));
    return impl === path.win32 ? n.toLowerCase() : n;
  };
  const target = norm(planPath);
  for (const m of String(roadmapText).matchAll(/^\s*Location:\s*(.+?)\s*$/gm)) {
    // The Location group always participates in a match.
    if (norm(m[1]!) === target) return true;
  }
  return false;
}

function inProgressRoadmaps(ws: string): string[] {
  const dir = path.join(ws, ".tmp", "repo", "roadmaps");
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".md"));
  } catch {
    return [];
  }
  const texts: string[] = [];
  for (const name of names) {
    try {
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      if (frontmatterOf(text).status === "in-progress") texts.push(text);
    } catch {
      /* skip unreadable */
    }
  }
  return texts;
}

// Reviewed plans and roadmaps this session saved that still wait for a `y`, in first-save order.
function approvableItems(data: HookInput): ApprovalItem[] {
  const file = approvalsFile(data);
  if (!file) return [];
  const ws = resolveRoots(data).root;
  const running = inProgressRoadmaps(ws);
  const items: ApprovalItem[] = [];
  for (const abs of readLines(file)) {
    const kind: Approvable["kind"] | null = isUnderPlans(abs, ws) ? "plan" : isUnderRoadmaps(abs, ws) ? "roadmap" : null;
    if (!kind) continue;
    let text: string;
    let mtime: number;
    try {
      text = fs.readFileSync(abs, "utf8");
      mtime = fs.statSync(abs).mtimeMs;
    } catch {
      continue;
    }
    const fm = frontmatterOf(text);
    if (!APPROVABLE_STATUS[kind].has(fm.status ?? "") || !(Number(fm.reviews) >= 1)) continue;
    if (kind === "plan" && running.some((t) => isSliceOf(abs, t))) continue;
    const strategy = parseStrategy(fm.strategy);
    if (!strategy) continue;
    items.push({ kind, serial: Number(fm.serial), strategy, path: abs, mtime });
  }
  return items;
}

function stampMtime(data: HookInput, prefix: string): number | null {
  const p = resolveStamp(data, prefix);
  if (!p) return null;
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

// Stop reason when this turn saved a reviewed item and the reply does not end with a closing line covering it.
function approvalBlockReason(data: HookInput, msg: string): string | null {
  if (!approvalsFile(data) || resolveStamp(data, APPROVAL_BLOCK_STAMP)) return null;
  const turnStart = stampMtime(data, TURN_START_STAMP);
  if (turnStart == null) return null;
  const items = approvableItems(data);
  const pending = items.filter((i) => i.mtime >= turnStart);
  if (!pending.length) return null;
  const named = closingLineOf(msg);
  const known = new Set(items.map(itemKey));
  // The strategy a line shows must be the one the file holds, so a bare `y` never runs one the person did not see.
  const shownTruly = (n: Approvable): boolean => items.some((i) => itemKey(i) === itemKey(n) && i.strategy === n.strategy);
  const covered =
    named &&
    pending.every((p) => named.some((n) => itemKey(n) === itemKey(p))) &&
    named.every((n) => known.has(itemKey(n)) && shownTruly(n));
  if (covered) return null;
  return `end with: ${closingLine(items)}`;
}

const runOf = (i: ApprovalItem): string =>
  i.kind === "plan"
    ? `run /implement-plan ${i.serial} (${i.path})`
    : `set status locked, then run /implement-roadmap ${i.serial} (${i.path})`;
const approveStep = (i: ApprovalItem): string => `${itemKey(i)}: ${runOf(i)}`;
const strategyStep = (i: ApprovalItem, strategy: Strategy): string =>
  `${itemKey(i)}: strategy ${strategy} was written to its frontmatter; re-read the ${i.kind}, then ${runOf(i)}`;

// The file's text with its `strategy:` frontmatter line set, validated through the persist module; null when nothing would change.
function strategyWrite(ws: string, item: ApprovalItem, strategy: Strategy): StrategyWrite {
  const previous = fs.readFileSync(item.path, "utf8");
  const m = /^---\r?\n[\s\S]*?\r?\n---(?=\r?\n)/.exec(previous);
  if (!m) return { ok: false, error: "no frontmatter" };
  const next = m[0].replace(/^strategy:.*$/m, `strategy: ${strategy}`) + previous.slice(m[0].length);
  if (next === previous) return { ok: true, content: null };
  const prepare = item.kind === "plan" ? preparePlanUpdate : prepareRoadmapUpdate;
  const result = prepare({ workspaceRoot: ws, filePath: item.path, content: next });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, content: result.content === previous ? null : result.content };
}

// Context for a reply of `y` or `y <strategy>` that answers the previous reply's closing line.
function approvalContext(data: HookInput, prompt: string): string {
  const reply = parseApproval(prompt);
  if (!reply) return "";
  const tp = data.transcript_path || data.transcriptPath;
  if (!tp) return "";
  const named = closingLineOf(lastAssistantFromTranscript(tp));
  if (!named) return "";
  if (reply.kind === "unknown") {
    return `unknown strategy "${reply.word}"; use y, ${STRATEGIES.map((s) => `y ${s}`).slice(0, -1).join(", ")} or y ${STRATEGIES.at(-1)}`;
  }
  const items = approvableItems(data);
  const resolved: ApprovalItem[] = [];
  for (const n of named) {
    const hit = items.find((i) => itemKey(i) === itemKey(n));
    if (!hit) return "";
    resolved.push(hit);
  }
  const approves = `y approves ${queueText(named)}: `;
  const wanted = reply.strategy;
  // A bare `y` runs the strategy each file holds, so it must be the one the line showed.
  if (wanted === null) {
    // resolved is built one-to-one from named, so named[k] exists.
    if (resolved.some((i, k) => i.strategy !== named[k]!.strategy)) return "";
    return approves + resolved.map(approveStep).join("; ");
  }
  const ws = resolveRoots(data).root;
  const writes: { item: ApprovalItem; content: string | null }[] = [];
  for (const i of resolved) {
    const w = strategyWrite(ws, i, wanted);
    if (!w.ok) return `y did not approve ${itemKey(i)}: strategy ${wanted} could not be written (${w.error})`;
    writes.push({ item: i, content: w.content });
  }
  try {
    for (const w of writes) if (w.content !== null) fs.writeFileSync(w.item.path, w.content);
  } catch (err) {
    return `y did not approve ${queueText(named)}: strategy ${wanted} could not be written (${err instanceof Error ? err.message : String(err)})`;
  }
  return approves + writes.map((w) => (w.content === null ? approveStep(w.item) : strategyStep(w.item, wanted))).join("; ");
}

function rewriteSpawn(toolInput: ToolInput | undefined, data: HookInput): ToolInput | "denied" | null {
  const updated = rewriteSpawnToolInput(toolInput);
  const prompt =
    updated && typeof updated.prompt === "string"
      ? updated.prompt
      : toolInput && typeof toolInput.prompt === "string"
        ? toolInput.prompt
        : "";
  if (prompt.length > MAX_PROMPT_CHARS) {
    emit(answerDeny(data, spawnCapReason(resolveRoots(data).root)));
    return "denied";
  }
  return updated;
}

function userPromptOf(data: HookInput): string {
  return String(data.prompt ?? data.userPrompt ?? data.user_prompt ?? data.content ?? "");
}

function isHostStopBanner(prompt: string): boolean {
  const p = String(prompt || "");
  if (/^\s*Stop hook feedback:/.test(p)) return true;
  if (/Blocked by stop hook/.test(p)) return true;
  if (/task[-_ ]?notification/i.test(p)) return true;
  return false;
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

function sessionReceiptContext(data: HookInput): string {
  const sid = sessionIdOf(data);
  if (!sid || sid === "default") return "";
  const dir = path.join(
    resolveRoots(data).root,
    ".tmp",
    "repo",
    "sessions",
    sid,
  );
  if (!fs.existsSync(dir)) return "";
  const wrote = countLines(path.join(dir, "wrote.txt"));
  const read = countLines(path.join(dir, "read.txt"));
  return `${wrote} wrote, ${read} read. session=.tmp/repo/sessions/${sid}/`;
}

function writeSessionReceipt(data: HookInput, msg: string): void {
  const sid = sessionIdOf(data);
  if (!sid || sid === "default") return;
  const dir = path.join(
    resolveRoots(data).root,
    ".tmp",
    "repo",
    "sessions",
    sid,
  );
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return;
  }
  const wrote = countLines(path.join(dir, "wrote.txt"));
  const read = countLines(path.join(dir, "read.txt"));
  const first = firstNonEmptyStripped(msg).slice(0, 200);
  const lines = [
    first,
    `${wrote} wrote, ${read} read.`,
    `session=.tmp/repo/sessions/${sid}/`,
  ].filter(Boolean);
  try {
    fs.writeFileSync(path.join(dir, "receipt.txt"), lines.join("\n") + "\n");
  } catch {
    /* fail-open */
  }
}

// What git the user's latest message asked for, read by the gate; each prompt overwrites it, so an empty list clears it.
function writeGitAsked(data: HookInput, prompt: string): void {
  const sid = sessionIdOf(data);
  // The gate finds this file beside the session's strategy stamp, with the sid cleaned the same way.
  if (!sid.replace(/[^\w-]/g, "")) return;
  try {
    const dir = path.dirname(strategyStampPath(resolveRoots(data).root, sid));
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, "git-asked.json");
    const tmp = `${dest}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ words: gitAskedWords(prompt) }));
    fs.renameSync(tmp, dest);
  } catch {
    /* fail-open: no stamp means no grant */
  }
}

// Cursor's beforeSubmitPrompt does only this: no /ask stamp, board line, approval or reply.
function beforeSubmitPrompt(data: HookInput): number {
  writeGitAsked(data, userPromptOf(data));
  return 0;
}

function userPromptSubmit(data: HookInput): number {
  const prompt = userPromptOf(data);
  if (isHostStopBanner(prompt)) return 0;
  writeGitAsked(data, prompt);
  unlinkStamp(data, "stop-block");
  const approval = approvalContext(data, prompt);
  if (approvalsFile(data)) {
    writeStamp(data, TURN_START_STAMP, String(Date.now()));
    unlinkStamp(data, APPROVAL_BLOCK_STAMP);
  }
  applySessionGateSlash(data, prompt);
  let ctx = effectiveSessionContext(data);
  if (approval) ctx = ctx ? `${ctx}\n${approval}` : approval;
  try {
    recordHook(data, process.env);
    const others = otherLines(data, process.env);
    if (others) ctx = ctx ? `${ctx}\n${others}` : others;
  } catch {
    // Board is best-effort. The session receipt still ships.
  }
  if (!ctx) return 0;
  emit({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: ctx,
    },
  });
  return 0;
}

export function isWaitScoutExact(msg: unknown): boolean {
  const nonempty = String(msg || "")
    .split("\n")
    .filter((l) => l.trim());
  if (nonempty.length !== 1) return false;
  // The length check above leaves exactly one line.
  return nonempty[0]!.replace(/^[\s`*_>]+/, "") === WAIT_SCOUT;
}

export function hasStepAsk(msg: unknown): boolean {
  if (isWaitScoutExact(msg) || closingLineOf(msg)) return true;
  return String(msg || "")
    .split("\n")
    .map((l) => l.replace(/^[\s`*_>]+/, "").trim())
    .filter(Boolean)
    .some((l) => l.includes("?"));
}

function firstNonEmptyStripped(msg: unknown): string {
  for (const line of String(msg || "").split("\n")) {
    if (!line.trim()) continue;
    return line.replace(/^[\s`*_>]+/, "");
  }
  return "";
}

function payloadAssistantMessage(data: HookInput): string {
  return data.lastAssistantMessage || data.last_assistant_message || "";
}

function isAssistantRecord(obj: unknown): obj is Record<string, unknown> {
  if (!isRecord(obj)) return false;
  const type = String(obj.type || "").toLowerCase();
  if (type === "user" || type === "human" || type === "tool" || type === "tool_result") {
    return false;
  }
  if (type === "assistant") return true;
  const role = String(obj.role || (isRecord(obj.message) && obj.message.role) || "").toLowerCase();
  if (role === "user" || role === "human") return false;
  return role === "assistant";
}

function assistantTextFromRecord(obj: unknown): string | null {
  if (!isAssistantRecord(obj)) return null;
  const msg = isRecord(obj.message) ? obj.message : obj;
  const content = msg.content ?? obj.content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const part of content) {
      if (!isRecord(part)) continue;
      const pt = String(part.type || "");
      if (pt === "tool_use" || pt === "tool_result" || pt === "function_call") continue;
      if (typeof part.text === "string" && part.text) texts.push(part.text);
    }
    const joined = texts.join("\n").trim();
    return joined ? joined : null;
  }
  if (typeof content === "string" && content.trim()) return content;
  if (typeof obj.text === "string" && obj.text.trim()) return obj.text;
  return null;
}

export function lastAssistantFromTranscript(filePath: string): string {
  try {
    if (!filePath) return "";
    const st = fs.statSync(filePath);
    const start = Math.max(0, st.size - TRANSCRIPT_TAIL_BYTES);
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(st.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const text = buf.toString("utf8");
      const lines = text.split("\n");
      if (start > 0 && lines.length) lines.shift();
      let last = "";
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        let rec: unknown;
        try {
          rec = JSON.parse(t);
        } catch {
          continue;
        }
        const extracted = assistantTextFromRecord(rec);
        if (extracted) last = extracted;
      }
      return last;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

function stop(data: HookInput): number {
  if (data.subagentType || data.subagent_type) {
    return interceptNeed(data, "Stop");
  }
  if (data.stopHookActive || data.stop_hook_active) {
    return 0;
  }
  const reason = String(data.reason || "");
  if (reason && reason !== "end_turn") return 0;

  const payloadMsg = payloadAssistantMessage(data);
  let msg = payloadMsg;
  if (!msg) {
    const tp = data.transcript_path || data.transcriptPath || "";
    msg = lastAssistantFromTranscript(tp);
  }
  writeSessionReceipt(data, msg);
  if (isWaitScoutExact(msg)) return 0;
  const approvalReason = approvalBlockReason(data, msg);
  if (approvalReason) {
    writeStamp(data, APPROVAL_BLOCK_STAMP, "1");
    emit({ decision: "block", reason: approvalReason });
    return 0;
  }
  if (sessionGateOf(data) === "ask" && !hasStepAsk(msg)) {
    let n = readStampInt(data, "stop-block");
    if (n >= MAX_STOP) return 0;
    writeStamp(data, "stop-block", String(n + 1));
    emit({ decision: "block", reason: ASK_STOP_REASON });
    return 0;
  }
  return 0;
}

function interceptNeed(data: HookInput, hookEventName: string): number {
  const roots = resolveRoots(data);
  if (data.stopHookActive || data.stop_hook_active) {
    return 0;
  }
  const msg = data.lastAssistantMessage || data.last_assistant_message || "";
  const parsed = parseNeed(msg);
  if (!parsed.ok) {
    return 0;
  }
  const jobs = parsed.jobs;
  if (
    jobs.length > 4 ||
    !jobs.every((j) => INTERCEPT_JOBS.has(j.job))
  ) {
    return 0;
  }

  let n = readStampInt(data, "need-intercept");
  if (n >= MAX_INTERCEPT) {
    return 0;
  }

  const cwd = roots.cwd;
  const parts: string[] = [];
  for (const job of jobs) {
    let result: { fallback: boolean; text: string };
    try {
      const jobCwd = job.cwd ? resolveJobCwd(job.cwd, cwd) : cwd;
      if (job.cwd && !jobCwd) {
        result = { fallback: true, text: "FALLBACK\n" };
      } else {
        result = runJob({
          job: job.job,
          query: job.query,
          cwd: jobCwd || cwd,
          root: roots.root,
          path: job.path,
          glob: job.glob,
          stash: job.stash,
          from: job.from,
          to: job.to,
        });
      }
    } catch {
      result = { fallback: true, text: "FALLBACK\n" };
    }
    if (!result || result.fallback) {
      return 0;
    }
    parts.push(String(result.text || "").trimEnd());
  }
  writeStamp(data, "need-intercept", String(n + 1));
  const reason = parts.join("\n");
  emit({
    decision: "block",
    hookSpecificOutput: {
      hookEventName,
      additionalContext: reason,
    },
  });
  return 0;
}

function stampPath(data: HookInput, prefix: string): string | null {
  const root = resolveRoots(data).root;
  const sid = sessionIdOf(data) || "default";
  if (!root) return null;
  return path.join(root, ORCHESTRATOR_LOGS_DIR, prefix + "-" + sid);
}

function legacyStampPath(data: HookInput, prefix: string): string | null {
  const root = resolveRoots(data).root;
  const sid = sessionIdOf(data) || "default";
  if (!root) return null;
  return path.join(root, LEGACY_ORCHESTRATOR_LOGS_DIR, prefix + "-" + sid);
}

function resolveStamp(data: HookInput, prefix: string): string | null {
  const neu = stampPath(data, prefix);
  if (neu && fs.existsSync(neu)) return neu;
  const old = legacyStampPath(data, prefix);
  if (old && fs.existsSync(old)) return old;
  return null;
}

function writeStamp(data: HookInput, prefix: string, body: string): string | null {
  const p = stampPath(data, prefix);
  if (!p) return null;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
}

function readStampInt(data: HookInput, prefix: string): number {
  const p = resolveStamp(data, prefix);
  if (!p) return 0;
  const n = parseInt(fs.readFileSync(p, "utf8"), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function sessionIdOf(data: HookInput): string {
  return process.env.GROK_SESSION_ID || data.sessionId || data.session_id || "";
}

function unlinkQuiet(p: string | null): void {
  if (!p) return;
  try {
    fs.unlinkSync(p);
  } catch {
    /* missing is fine */
  }
}

function unlinkStamp(data: HookInput, prefix: string): void {
  unlinkQuiet(stampPath(data, prefix));
  unlinkQuiet(legacyStampPath(data, prefix));
}

function sessionGateStampPath(data: HookInput, prefix: string): string | null {
  const root = resolveRoots(data).root;
  const sid = sessionIdOf(data);
  if (!root || !sid || sid === "default") return null;
  return path.join(root, ORCHESTRATOR_LOGS_DIR, prefix + "-" + sid);
}

function resolveSessionGateStamp(data: HookInput): string | null {
  for (const prefix of [SESSION_GATE_STAMP, AUTO_ASK_STAMP]) {
    const neu = sessionGateStampPath(data, prefix);
    if (neu && fs.existsSync(neu)) return neu;
    const old = path.join(
      resolveRoots(data).root,
      LEGACY_ORCHESTRATOR_LOGS_DIR,
      prefix + "-" + sessionIdOf(data),
    );
    if (sessionIdOf(data) && fs.existsSync(old)) return old;
  }
  return null;
}

function applySessionGateSlash(data: HookInput, prompt: string): void {
  let slash = "";
  if (AUTO_RE.test(prompt)) slash = "auto";
  else if (ASK_RE.test(prompt)) slash = "ask";
  if (!slash) return;
  const p = sessionGateStampPath(data, SESSION_GATE_STAMP);
  if (!p) return;
  unlinkQuiet(sessionGateStampPath(data, AUTO_ASK_STAMP));
  if (slash === "auto") {
    unlinkQuiet(p);
    return;
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, slash);
}

export function sessionGateOf(data: HookInput): "auto" | "ask" {
  try {
    const p = resolveSessionGateStamp(data);
    if (p) {
      const body = fs.readFileSync(p, "utf8").trim();
      if (body === "auto" || body === "ask") return body;
    }
  } catch {
    /* fall through */
  }
  return "auto";
}

export function effectiveSessionContext(data: HookInput): string {
  const gate = sessionGateOf(data);
  const receipt = sessionReceiptContext(data);
  return receipt ? `sessionGate=${gate}. ${receipt}` : `sessionGate=${gate}`;
}

function eventKey(s: unknown): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function emit(obj: object): void {
  process.stdout.write(JSON.stringify(obj));
}

/** Read stdin until it parses as one JSON object, without waiting for EOF; null when it never does. */
function readHookInput(): HookInput | null {
  let buf = Buffer.alloc(0);
  const tmp = Buffer.alloc(8192);
  for (;;) {
    let n: number;
    try {
      n = fs.readSync(0, tmp, 0, tmp.length, null);
    } catch {
      break;
    }
    if (n === 0) break;
    buf = Buffer.concat([buf, tmp.subarray(0, n)]);
    const parsed = parseHookInput(buf.toString("utf8"));
    if (parsed) return parsed;
  }
  return buf.length ? parseHookInput(buf.toString("utf8")) : null;
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  process.exit(main());
}
