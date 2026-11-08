#!/usr/bin/env bun
/** PreToolUse: fat Read/Grep/Glob/Bash gate. Fail-open: parse/crash → empty stdout, exit 0. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseHookInput, type HookAgent, type HookInput } from "./hook-input.ts";
import { patchIgnoreEdits, redundantIgnoreReason, shellIgnoreEdits, writeIgnoreEdits } from "./gitignore-guard.ts";
import { persistOwner } from "./persist-tmp.ts";
import { ENFORCED_HARNESSES, activeReview, implementerOf, parseStrategy, stampPath, writeStamp, type ActiveReview } from "./strategy.ts";
import { canonicalPath, resolveRoots, resolveTyped, type Roots } from "./workspace-root.ts";
import { gitAskedWords, mainCheckoutWriteReason, sharedGitReason, worktreeAddReason } from "./worktree.ts";

/** Which wire shape a hook payload came in; Grok sends Claude's. */
export type Harness = "claude" | "codex" | "antigravity" | "cursor";

/** What one tool of one harness is to the gate, and which input fields carry its command and cwd. */
export interface ToolSpec {
  kind: "bash" | "write" | "read" | "grep" | "glob" | "patch";
  command?: string;
  cwd?: string;
  persistShared?: boolean;
  limits?: boolean;
}

/** A tool call's argument bag; the shape varies per harness and tool, so each field is checked where it is read. */
export type ToolArgs = Record<string, unknown>;

/** The gate's verdict on one call: a deny reason, a rewritten input, or null to let it through. */
export type GateResult = { type: "deny"; reason: string } | { type: "rewrite"; updatedInput: ToolArgs } | null;

/** The part of a hook payload the gate reads; a payload that failed parsing is null. */
type Payload = HookInput | null | undefined;

/** Session Grep head_limit when the model omits one. */
export const DEFAULT_GREP_HEAD_LIMIT = 50;
/** Session Read line limit when the model omits one. */
export const DEFAULT_READ_LIMIT = 200;
/** Unknown non-scout child Grep head_limit when omitted. */
export const CHILD_GREP_HEAD_LIMIT = 150;
/** Unknown non-scout child Read line limit when omitted. */
export const CHILD_READ_LIMIT = 400;
/** Deny if requested Grep head_limit or Read limit exceeds this. */
export const MAX_REQUEST_LIMIT = 500;
/** Deny Read when the file is larger than this, even with a line limit. */
export const DENY_FILE_BYTES = 200 * 1024;

export const DENY_PATH_SEGMENTS = new Set([
  "node_modules",
  "dist",
  ".next",
  "build",
  "coverage",
]);
export const DENY_LOCKFILES = new Set(["bun.lock"]);

export const REASON_DENYLIST = "path denylist; use package API";
export const REASON_HEAD_LIMIT = "head_limit>500";
export const REASON_FILE_SIZE = "file >200KB";
export const REASON_REREAD =
  "already wrote this session; Read with offset+limit";
/** Cursor's Read takes no offset or limit, so its re-read reason names a command that does the slicing. */
export function rereadReasonFor(harness: Harness, absPath: string, checkout: string): string {
  if (harness !== "cursor") return REASON_REREAD;
  const slice = jobCommand(checkout, `--job exec --query ${quoteQuery(`sed -n 1,${DEFAULT_READ_LIMIT}p ${shellPath(absPath)}`)}`);
  return `already wrote this session; Cursor Read takes no offset or limit, so slice it with ${slice}`;
}

const SHELL: ToolSpec = { kind: "bash", command: "command" };
// orchestrate-parent persists these itself, so the gate leaves their persist-owned redirects to it.
const SHARED_WRITE: ToolSpec = { kind: "write", persistShared: true };
const WRITE: ToolSpec = { kind: "write" };
// Cursor's Read and Grep take no offset, limit or head_limit, so the gate cannot inject or cap them.
const CURSOR_NO_LIMITS = { limits: false } as const;

/**
 * The tools each harness sends, keyed by eventKey of the tool name. A harness only gets the kinds whose
 * fields it uses; anything else gets no answer. Claude also covers Grok, which sends the same shape.
 */
export const TOOLS: Record<Harness, Map<string, ToolSpec>> = {
  claude: new Map<string, ToolSpec>([
    ["write", SHARED_WRITE],
    ["edit", SHARED_WRITE],
    ["searchreplace", SHARED_WRITE],
    ["bash", SHELL],
    ["runterminalcommand", SHELL],
    ["read", { kind: "read" }],
    ["readfile", { kind: "read" }],
    ["grep", { kind: "grep" }],
    ["glob", { kind: "glob" }],
    ["listdir", { kind: "glob" }],
  ]),
  codex: new Map<string, ToolSpec>([
    ["applypatch", { kind: "patch" }],
    ["bash", SHELL],
  ]),
  cursor: new Map<string, ToolSpec>([
    ["shell", { kind: "bash", command: "command", cwd: "cwd" }],
    ["read", { kind: "read", ...CURSOR_NO_LIMITS }],
    ["grep", { kind: "grep", ...CURSOR_NO_LIMITS }],
    ["write", SHARED_WRITE],
  ]),
  antigravity: new Map<string, ToolSpec>([
    ["writefile", WRITE],
    ["editfile", WRITE],
    ["runcommand", { kind: "bash", command: "CommandLine", cwd: "Cwd" }],
  ]),
};
export const WRITE_PATH_FIELDS = [
  "path",
  "file_path",
  "filePath",
  "target_file",
  "targetFile",
  "Path",
];
const PATH_FIELDS = [
  "path",
  "file_path",
  "filePath",
  "target_file",
  "targetFile",
  "target_directory",
  "targetDirectory",
  "glob",
  "glob_pattern",
  "globPattern",
];
const BASH_DUMP_CMDS =
  /\b(cat|tac|less|more|head|tail|nl|bat|hexdump|xxd|rg|grep|egrep|fgrep|find|fd)\b/;
const BASH_SEARCH = /\b(rg|grep|egrep|fgrep|find|fd)\b/;
const BASH_WEB = /\b(curl|wget)\b/;
export const SHELL_META = /[|&;`$(){}<>\n\r]/;
const JOB_FLAGS = new Set([
  "--job",
  "--query",
  "--path",
  "--glob",
  "--cwd",
  "--stash",
  "--from",
  "--to",
]);
const PRODUCT_ROOT_NAMES = new Set([
  "README.md",
  "CHANGELOG.md",
  "AGENTS.md",
  "package.json",
  "LICENSE",
]);
const PRODUCT_ROOT_DIRS = new Set([
  "src",
  "scripts",
  ".rulesync",
  ".grok",
  ".claude",
  ".agents",
  "cli",
]);
const SCRATCH_ROOT_NAMES = new Set(["notes.md", "scratch.md", "output.txt"]);
const BASH_TREE = /\b(ls|tree)\b/;
const TEST_CMD = /^\s*(?:bun (?:run )?test|bunx? vitest|npx vitest|vitest|npm (?:run )?test|pnpm (?:run )?test)\b/;

export function eventKey(s: unknown): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const CHILD_TYPE_KEYS = [
  "subagentType",
  "subagent_type",
  "agentType",
  "agent_type",
  "agentName",
  "agent_name",
] as const satisfies readonly (keyof HookInput)[];
const CHILD_ID_KEYS = ["agentId", "agent_id", "spawnedBy", "spawned_by"] as const satisfies readonly (keyof HookInput & keyof HookAgent)[];
const AGENT_ID_KEYS = [...CHILD_ID_KEYS, "id"] as const satisfies readonly (keyof HookAgent)[];
const AGENT_TYPE_KEYS = ["subagentType", "subagent_type", "type", "name", "agentType"] as const satisfies readonly (keyof HookAgent)[];

function nonEmptyChildId(raw: unknown): boolean {
  if (raw == null) return false;
  return String(raw).trim() !== "";
}

/** True when PreToolUse names a child session (UUID ok). Not a fat-gate type. */
export function hasChildAgentMarker(data: Payload): boolean {
  if (!data || typeof data !== "object") return false;
  for (const k of CHILD_ID_KEYS) {
    if (nonEmptyChildId(data[k])) return true;
  }
  const agent = data.agent;
  if (agent && typeof agent === "object" && !Array.isArray(agent)) {
    for (const k of AGENT_ID_KEYS) {
      if (nonEmptyChildId(agent[k])) return true;
    }
  }
  return false;
}

function coerceChildType(raw: unknown): string {
  if (raw == null) return "";
  const s = String(raw).trim().toLowerCase();
  if (!s) return "";
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  ) {
    return "";
  }
  if (/^[0-9]+$/.test(s)) return "";
  if (s.length > 64 || /[\/\\]/.test(s)) return "";
  return s;
}

export function subagentTypeOf(data: Payload): string {
  if (!data || typeof data !== "object") return "";
  for (const k of [...CHILD_TYPE_KEYS, ...CHILD_ID_KEYS]) {
    const t = coerceChildType(data[k]);
    if (t) return t;
  }
  const agent = data.agent;
  if (agent && typeof agent === "object" && !Array.isArray(agent)) {
    for (const k of AGENT_TYPE_KEYS) {
      const t = coerceChildType(agent[k]);
      if (t) return t;
    }
  } else if (typeof agent === "string") {
    const t = coerceChildType(agent);
    if (t) return t;
  }
  return "";
}

export function isParentOrchestrator(data: Payload): boolean {
  return !subagentTypeOf(data) && !hasChildAgentMarker(data);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** What the gate prints for a deny or a rewrite; each harness reads its own subset of these fields. */
export interface HookOutput {
  decision?: string;
  reason?: string;
  permission?: string;
  user_message?: string;
  agent_message?: string;
  overwrite?: ToolArgs;
  hookSpecificOutput?: {
    hookEventName: string;
    permissionDecision?: string;
    permissionDecisionReason?: string;
    updatedInput?: ToolArgs;
  };
}

/** A payload object as the gate reads it; anything else (null, an array, a scalar) is not a hook call. */
function isHookObject(v: Payload): v is HookInput {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** Which wire shape the hook payload came in. */
export function harnessOf(data: HookInput): Harness {
  // Cursor also sends model and session_id, so it is told apart by its version before Codex's check.
  if (typeof data.cursor_version === "string") return "cursor";
  if (isPlainObject(data.toolCall)) return "antigravity";
  // Codex sends both on every tool hook; Claude would read Codex's `allow` as skipping its permission prompt.
  if (typeof data.turn_id === "string" && typeof data.model === "string") return "codex";
  return "claude";
}

/** The call in one shape for every harness: its tool key and args (null when absent or not an object). */
export function toolCallOf(data: HookInput): { harness: Harness; key: string; args: ToolArgs | null } {
  const harness = harnessOf(data);
  const call = harness === "antigravity" ? data.toolCall : null;
  const name = call ? call.name : data.toolName || data.tool_name;
  let args: unknown = call ? call.args : data.toolInput;
  if (!call && args == null) args = data.tool_input;
  return { harness, key: eventKey(name), args: isPlainObject(args) ? args : null };
}

/** A package's shipped `references/` dir under any `node_modules/@workerstack/<pkg>/`; the one `node_modules` path agents may read. */
export const STOCK_REFERENCES = /(?:^|\/)node_modules\/@workerstack\/[^/]+\/references(?:\/|$)/;

/** The typed path with backslashes swapped and `.`/`..` folded, so `references/../cli` is judged as `cli`. */
function typedPosix(p: unknown): string {
  const swapped = String(p).replace(/\\/g, "/").trim();
  return swapped ? path.posix.normalize(swapped) : "";
}

/** True when the typed path lies inside a stock references dir. */
function inStockReferences(p: unknown): boolean {
  return STOCK_REFERENCES.test(typedPosix(p));
}

export function pathIsDenied(p: unknown): boolean {
  if (p == null) return false;
  const raw = String(p).replace(/\\/g, "/").trim();
  if (!raw) return false;
  if (DENY_LOCKFILES.has(path.posix.basename(raw)) || gitDirIn(raw)) return true;
  // The match goes out as `/`, so what sat before and after it still reads as separate segments.
  const n = typedPosix(raw).replace(STOCK_REFERENCES, "/");
  if (DENY_LOCKFILES.has(path.posix.basename(n))) return true;
  if (gitDirIn(n)) return true;
  return n.split("/").some((seg) => DENY_PATH_SEGMENTS.has(seg));
}

/** Top-level "block" is the only legacy deny Claude/Codex validate; allow = empty stdout. */
function preToolUseDeny(reason: string): HookOutput {
  return {
    decision: "block",
    reason,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/**
 * How each harness takes a deny and a rewrite. Codex drops `updatedInput` without `allow`, while Claude
 * reads `allow` as approve-without-prompt, so only Codex gets it. Antigravity merges `overwrite` into its args.
 * Cursor denies with its own top-level reply and takes Claude's nested `updatedInput` only while no top-level
 * field is set, so its rewrite carries no `permission`.
 */
/** How one harness takes a deny and a rewrite of `args` into `next`. */
interface Answers {
  deny: (reason: string) => HookOutput;
  rewrite: (args: ToolArgs | null, next: ToolArgs) => HookOutput;
}

const nestedRewrite = (_args: ToolArgs | null, next: ToolArgs): HookOutput => ({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: next } });
const ANSWERS: Record<Harness, Answers> = {
  claude: {
    deny: preToolUseDeny,
    rewrite: nestedRewrite,
  },
  cursor: {
    deny: (reason: string) => ({ permission: "deny", user_message: reason, agent_message: reason }),
    rewrite: nestedRewrite,
  },
  codex: {
    deny: preToolUseDeny,
    rewrite: (_args, next) => ({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: next },
    }),
  },
  antigravity: {
    deny: (reason: string) => ({ decision: "deny", reason }),
    rewrite: (args, next) => ({
      decision: "allow",
      overwrite: Object.fromEntries(Object.entries(next).filter(([k, v]) => !args || args[k] !== v)),
    }),
  },
};

export function answerDeny(data: HookInput, reason: string): HookOutput {
  return ANSWERS[harnessOf(data)].deny(reason);
}

export function answerRewrite(data: HookInput, next: ToolArgs): HookOutput {
  return ANSWERS[harnessOf(data)].rewrite(toolCallOf(data).args, next);
}

/**
 * A Write aimed at any `.tmp/repo/` other than the root's goes to `<root>/.tmp/repo/<rest>`.
 * Relative paths resolve against the hook cwd. Null when it is already root scratch or not scratch.
 */
export function rewriteScratchPath(filePath: unknown, roots: Roots | null | undefined, p: typeof path = path): string | null {
  if (filePath == null || !roots) return null;
  const raw = String(filePath);
  if (!raw) return null;
  const destRoot = p.resolve(roots.root, ".tmp", "repo");
  const absIn = resolveTyped(roots, raw, p);
  const inRoot = p.relative(destRoot, absIn);
  if (!inRoot.startsWith("..") && !p.isAbsolute(inRoot)) return null;

  // Inside the root, look below it, so a root that itself sits under some `.tmp/repo` is not matched.
  const fromRoot = p.relative(roots.root, absIn);
  const inside = !fromRoot.startsWith("..") && !p.isAbsolute(fromRoot);
  const posix = (inside ? fromRoot : raw).replace(/\\/g, "/");
  const marker = /(^|\/)\.tmp\/repo\//.exec(posix);
  if (!marker) return null;

  const rel = posix.slice(marker.index + marker[0].length);
  if (!rel) return null;
  if (p.posix.isAbsolute(rel) || rel.startsWith("/")) return null;
  const relNorm = p.posix.normalize(rel);
  if (
    !relNorm ||
    relNorm === "." ||
    relNorm === ".." ||
    relNorm.startsWith("../") ||
    rel.split("/").includes("..") ||
    relNorm.split("/").includes("..")
  ) {
    return null;
  }
  if (p.posix.isAbsolute(relNorm)) return null;

  const dest = p.resolve(destRoot, relNorm);
  const check = p.relative(destRoot, dest);
  if (!check || check.startsWith("..") || p.isAbsolute(check)) return null;
  return dest;
}

// Antigravity sends its session id only as `conversationId` (phase 6 probe).
export function sessionIdOf(data: Payload): string {
  const sid = String(
    (data && (data.sessionId || data.session_id || data.conversationId)) || "",
  ).trim();
  if (!sid || sid === "default") return "";
  return sid;
}

export function wroteListPath(workspaceRoot: string | null | undefined, sid: string): string {
  if (!workspaceRoot || !sid) return "";
  return path.join(workspaceRoot, ".tmp", "repo", "sessions", sid, "wrote.txt");
}

/** Absolute posix key for a file this session wrote, or "" when it is outside the root and checkout. */
function wroteKey(roots: Roots, filePath: string): string {
  const abs = resolveTyped(roots, filePath);
  const inside = (base: string) => {
    const rel = path.relative(base, abs);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  };
  if (!inside(roots.root) && !inside(roots.checkout)) return "";
  return abs.replace(/\\/g, "/");
}

export function recordWrote(roots: Roots | null | undefined, sid: string, filePath: string): void {
  if (!roots || !sid || !filePath) return;
  const key = wroteKey(roots, filePath);
  if (!key) return;
  const dest = wroteListPath(roots.root, sid);
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
  } catch {
    return;
  }
  let cur = "";
  try {
    cur = fs.readFileSync(dest, "utf8");
  } catch {
    cur = "";
  }
  const lines = cur.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.includes(key)) return;
  lines.push(key);
  fs.writeFileSync(dest, lines.join("\n") + "\n");
}

export function wasWroteThisSession(roots: Roots | null | undefined, sid: string, filePath: string): boolean {
  if (!roots || !sid || !filePath) return false;
  let cur = "";
  try {
    cur = fs.readFileSync(wroteListPath(roots.root, sid), "utf8");
  } catch {
    return false;
  }
  const key = wroteKey(roots, filePath);
  return Boolean(key) && cur.split(/\n/).some((l) => l.trim() === key);
}

const SCRATCH_ROOT_RE = /^(dump|scratch|notes|output)(\.|$)/i;

/** Stray scratch names and `tmp/` dirs at the checkout top go under the root's `.tmp/repo`. */
export function rewriteScratchWrite(filePath: unknown, roots: Roots | null | undefined, p: typeof path = path): string | null {
  const existing = rewriteScratchPath(filePath, roots, p);
  if (existing) return existing;
  if (typeof filePath !== "string" || !roots) return null;
  const wsRoot = p.resolve(roots.checkout);
  const scratch = p.resolve(roots.root, ".tmp", "repo");
  const abs = resolveTyped(roots, filePath, p);
  const rel = p.relative(wsRoot, abs).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..") || p.isAbsolute(rel)) return null;
  const segs = rel.split("/");
  const base = segs[segs.length - 1] || "";
  if (PRODUCT_ROOT_NAMES.has(base) && segs.length === 1) return null;
  if (PRODUCT_ROOT_DIRS.has(segs[0]!)) return null; // rel is non-empty, so segs has an element
  if (rel.startsWith(".tmp/repo/")) return null;
  if (segs[0] === "tmp" || (segs[0] === ".tmp" && segs[1] !== "repo")) {
    const rest = segs[0] === "tmp" ? segs.slice(1) : segs.slice(2);
    const dest = p.resolve(scratch, ...rest);
    const check = p.relative(scratch, dest);
    if (!check || check.startsWith("..") || p.isAbsolute(check)) return null;
    return dest;
  }
  if (
    segs.length === 1 &&
    (SCRATCH_ROOT_NAMES.has(base) ||
      /\.tmp$/i.test(base) ||
      SCRATCH_ROOT_RE.test(base))
  ) {
    return p.resolve(scratch, base);
  }
  return null;
}

const PATCH_PATH_RE = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/gm;
const PATCH_HEREDOC_RE = /^\s*apply_patch\s*<<\s*(['"]?)(\w+)\1[ \t]*\n([\s\S]*?)\n\2\s*$/;

/** The patch inside a Codex `apply_patch <<'EOF' … EOF` shell command, else null. */
export function patchOfCommand(command: unknown): string | null {
  const m = PATCH_HEREDOC_RE.exec(String(command || ""));
  return m ? m[3]! : null; // group 3 always participates
}

/**
 * Add and Move headers whose path is scratch get the root scratch path, the same rule a Write gets.
 * Update and Delete headers stay, since they act on a file that exists where it is.
 * Returns the rewritten patch (null when nothing moved) and every final path.
 */
export function rewritePatch(patch: unknown, roots: Roots, p: typeof path = path): { patch: string | null; paths: string[] } {
  const paths: string[] = [];
  let changed = false;
  const next = String(patch).replace(PATCH_PATH_RE, (line: string, op: string, target: string) => {
    const dest = op === "Add File" || op === "Move to" ? rewriteScratchWrite(target, roots, p) : null;
    if (op !== "Delete File") paths.push(dest || resolveTyped(roots, target, p));
    if (!dest) return line;
    changed = true;
    return `*** ${op}: ${dest}`;
  });
  return { patch: changed ? next : null, paths };
}

/** Every file a write or patch lands on, in the roots' spelling, after the scratch rewrite has moved what it moves. */
function writeTargets(tool: ToolSpec, input: ToolArgs | null, patch: string | null, roots: Roots): string[] {
  if (tool.kind === "write") {
    return WRITE_PATH_FIELDS.flatMap((k) => {
      const v = input?.[k];
      return typeof v === "string" && v ? [rewriteScratchWrite(v, roots) || resolveTyped(roots, v)] : [];
    });
  }
  if (!patch) return [];
  // Both groups of PATCH_PATH_RE always participate in a match.
  return [...patch.matchAll(PATCH_PATH_RE)].map(
    ([, op, target]) => (op === "Add File" || op === "Move to" ? rewriteScratchWrite(target!, roots) : null) || resolveTyped(roots, target!),
  );
}

/** The strategy a plan's frontmatter holds when it is a review one, else null. */
function reviewStrategyOf(text: string): "review-fast" | "review-deep" | null {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const line = front && /^strategy:[ \t]*(\S+)/m.exec(front[1]!); // group 1 always participates
  const strategy = line && parseStrategy(line[1]);
  return strategy && strategy !== "default" ? strategy : null;
}

/** A parent's save of a plan that holds a review strategy points the session at it: the Write content, else the file on disk. */
function stampReviewPlan(tool: ToolSpec, input: ToolArgs, targets: string[], roots: Roots, sid: string): void {
  const plans = canonicalPath(path.join(roots.root, ".tmp", "repo", "plans"));
  const given = [input.content, input.Content, input.contents, input.file_text].find((v): v is string => typeof v === "string");
  for (const target of targets) {
    if (path.dirname(target) !== plans || path.extname(target) !== ".md") continue;
    const text = tool.kind === "write" && given !== undefined ? given : fs.readFileSync(target, "utf8");
    if (!reviewStrategyOf(text)) continue;
    writeStamp(roots.root, sid, target);
    return;
  }
}

/**
 * Stamp the session for a full-content Write of a plan. orchestrate-parent persists that Write itself and answers
 * before the gate runs, so it calls this first; every other save reaches the gate. Fails open.
 */
export function stampPlanSave(data: Payload): void {
  try {
    if (!isHookObject(data)) return;
    const sid = sessionIdOf(data);
    if (!sid || !isParentOrchestrator(data)) return;
    const { harness, key, args: input } = toolCallOf(data);
    const tool = TOOLS[harness].get(key);
    if (!tool || tool.kind !== "write" || !input) return;
    const roots = resolveRoots(data);
    stampReviewPlan(tool, input, writeTargets(tool, input, null, roots), roots, sid);
  } catch {
    // A stamp error never blocks a save.
  }
}

/** The git grant words the user's latest message named, from the session's `git-asked.json`; empty when anything is missing or malformed. */
function gitAskedBy(root: string, sid: string): Set<string> {
  try {
    if (!sid) return new Set();
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(path.dirname(stampPath(root, sid)), "git-asked.json"), "utf8"));
    // A file that is not an object throws in the destructure the gate always used, which lands in the catch below.
    if (!isPlainObject(parsed)) return new Set();
    const words = parsed.words;
    return new Set(Array.isArray(words) ? words.filter((w): w is string => typeof w === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * The deny reason for a write or patch that lands in the main checkout, or a shell command that commits or destroys
 * work there or hits shared refs. Ahead of every early return, so scouts, implementers and every harness are held to it.
 * An error in here lets the call through, as the gate does everywhere else.
 * Antigravity has no prompt event, so its git grant is the words in the call's own `lastUserInput` (empty in a
 * subagent's calls); every other harness's grant is the session's `git-asked.json`.
 */
function sharedCheckoutReason(
  tool: ToolSpec,
  input: ToolArgs,
  patch: string | null,
  text: string,
  roots: Roots,
  sid: string,
  shellCwd: string,
  harness: Harness,
  lastUserInput: string | undefined,
): string | null {
  try {
    if (tool.kind === "write" || patch) {
      for (const target of writeTargets(tool, input, patch, roots)) {
        const reason = mainCheckoutWriteReason(target, roots);
        if (reason) return reason;
      }
    }
    if (tool.kind === "bash" && /\bgit\b/.test(text)) {
      const asked = harness === "antigravity" ? new Set(gitAskedWords(lastUserInput)) : gitAskedBy(roots.root, sid);
      return sharedGitReason(text, roots, shellCwd, asked);
    }
    return null;
  } catch {
    return null;
  }
}

export const REASON_IMPLEMENTER_WRITE = "implementer writes product files and tests only; the reviewer writes the plan and the journal";
export const REASON_IMPLEMENTER_GIT = "implementer never stages or commits; report the changed files and the reviewer stages them";
const GIT_STAGE = /(?:^|[\s;&|(])git(?:\s+(?:-[Cc]\s+\S+|--[\w-]+(?:=\S+)?|-\w))*\s+(?:add|commit)(?![\w-])/;

/** True for a child spawned from an implementer-* agent. */
export function isImplementer(sub: unknown): boolean {
  return String(sub).startsWith("implementer-");
}

/** True when `target` is not inside `<root>/.tmp`; both in the roots' spelling. */
export function isOutsideRootTmp(target: string, root: string, p: typeof path = path): boolean {
  return isOutside(p, canonicalPath(p.resolve(root, ".tmp"), p), target);
}

function isOutside(p: typeof path, dir: string, target: string): boolean {
  const rel = p.relative(dir, target);
  return rel === ".." || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel);
}

const reviewDenyReason = (review: ActiveReview): string =>
  `plan ${review.serial} runs strategy ${review.strategy}: this session reviews. Spawn ${implementerOf(review.strategy, 1)} for product writes; the plan, the journal and .tmp/ stay writable.`;

/**
 * What a review strategy asks of a write, and of an implementer's shell. Ahead of the write branch and the scout
 * return, so no early return skips it. An error in here lets the call through, as the gate does everywhere else.
 *   implementer-*  never writes the plan or the journal, never runs git add or git commit (every strategy)
 *   parent         a save of a review plan stamps the session; while that plan runs, no write outside `<root>/.tmp`
 */
function reviewGuard(
  data: HookInput,
  tool: ToolSpec,
  input: ToolArgs,
  patch: string | null,
  roots: Roots,
  sid: string,
  harness: Harness,
  command: string,
): GateResult {
  try {
    const sub = subagentTypeOf(data);
    const implementer = isImplementer(sub);
    if (implementer && tool.kind === "bash" && GIT_STAGE.test(command)) return { type: "deny", reason: REASON_IMPLEMENTER_GIT };
    if (tool.kind !== "write" && !patch) return null;
    if (!implementer && !(sid && isParentOrchestrator(data))) return null;
    const targets = writeTargets(tool, input, patch, roots);
    if (implementer) {
      const owned = ["plans", "implementations"].map((d) => canonicalPath(path.join(roots.root, ".tmp", "repo", d)));
      const hit = targets.some((t) => owned.some((dir) => !isOutside(path, dir, t)));
      return hit ? { type: "deny", reason: REASON_IMPLEMENTER_WRITE } : null;
    }
    stampReviewPlan(tool, input, targets, roots, sid);
    const review = ENFORCED_HARNESSES.has(harness) ? activeReview(roots.root, sid) : null;
    if (review && targets.some((t) => isOutsideRootTmp(t, roots.root))) return { type: "deny", reason: reviewDenyReason(review) };
    return null;
  } catch {
    return null;
  }
}

/** POSIX single-quote so `, $, and \ stay literal. */
export function quoteQuery(q: unknown): string {
  return `'${String(q).replace(/'/g, "'\\''")}'`;
}

/** The checkout's installed `repo` bin. Absolute, because the rewritten command runs from the agent's cwd. */
function repoBin(checkout: string, p: typeof path = path): string {
  return p.join(checkout, "node_modules", ".bin", "repo");
}

/** Bash eats unquoted backslashes, so a command an agent runs spells every path with forward slashes. */
function shellPath(p: string): string {
  return p.split(path.sep).join("/");
}

export function jobCommand(workspaceRoot: string, args: string): string {
  return `${shellPath(repoBin(workspaceRoot))} job ${args}`;
}

function asNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function requestedLimit(input: ToolArgs, snake: string, camel: string): number | null {
  return asNumber(input[snake] ?? input[camel]);
}

function hasLimitField(input: ToolArgs, snake: string, camel: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(input, snake) ||
    Object.prototype.hasOwnProperty.call(input, camel)
  );
}

function usesCamelInput(input: ToolArgs): boolean {
  return Object.keys(input).some(
    (k) =>
      k === "targetFile" ||
      k === "filePath" ||
      k === "headLimit" ||
      k === "targetDirectory" ||
      k === "globPattern" ||
      k === "ignoreGlobs",
  );
}

function setMissingLimit(next: ToolArgs, input: ToolArgs, snake: string, camel: string, value: number): boolean {
  if (hasLimitField(input, snake, camel)) return false;
  if (usesCamelInput(input) && snake !== camel) next[camel] = value;
  else next[snake] = value;
  return true;
}

export const GLOB_IGNORE = [...DENY_PATH_SEGMENTS, ".git"];

function setMissingIgnore(next: ToolArgs, input: ToolArgs): boolean {
  if (hasLimitField(input, "ignore", "ignoreGlobs")) return false;
  // A search rooted in the stock references would otherwise ignore its own base.
  const list = collectPathValues(input).some(inStockReferences) ? GLOB_IGNORE.filter((seg) => seg !== "node_modules") : GLOB_IGNORE.slice();
  if (usesCamelInput(input)) next.ignoreGlobs = list;
  else next.ignore = list;
  return true;
}

function collectPathValues(input: ToolArgs): string[] {
  const out: string[] = [];
  for (const key of PATH_FIELDS) {
    const v = input[key];
    if (typeof v === "string" && v) out.push(v);
  }
  return out;
}

function readFilePath(input: ToolArgs): unknown {
  return (
    input.target_file ||
    input.file_path ||
    input.targetFile ||
    input.filePath ||
    ""
  );
}

export function resolveReadPath(filePath: unknown, roots: Roots): string | null {
  if (!filePath || typeof filePath !== "string") return null;
  return resolveTyped(roots, filePath);
}

export function fileSizeBytes(absPath: string | null | undefined): number | null {
  if (!absPath) return null;
  try {
    const st = fs.statSync(absPath);
    if (!st.isFile()) return null;
    return st.size;
  } catch {
    return null;
  }
}

export function bashTargetsDenylist(command: unknown): boolean {
  const cmd = String(command || "");
  if (!cmd.trim()) return false;
  if (!BASH_DUMP_CMDS.test(cmd) && !DENY_LOCKFILES_IN_CMD(cmd)) return false;
  if (DENY_LOCKFILES_IN_CMD(cmd) && BASH_DUMP_CMDS.test(cmd)) return true;
  if (gitDirIn(cmd) && BASH_DUMP_CMDS.test(cmd)) return true;
  if (!BASH_DUMP_CMDS.test(cmd)) return false;
  return cmd.split(/[\s'"`|&;$(){}<>]+/).some((token) => pathIsDenied(token));
}

function gitDirIn(s: unknown): boolean {
  return /(^|[\s/])\.git(\/|$)/.test(String(s).replace(/\\/g, "/"));
}

function DENY_LOCKFILES_IN_CMD(cmd: string): boolean {
  return /\bbun\.lock\b/.test(cmd);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function alreadyRtk(command: unknown): boolean {
  const first = String(command || "")
    .trim()
    .split(/\s+/, 1)[0] || "";
  return first === "rtk" || first.endsWith("/rtk");
}

export function stripFlagValue(cmd: unknown, flag: string): string {
  const f = escapeRe(flag);
  const val = `(?:"[^"]*"|'[^']*'|\\S+)`;
  return String(cmd || "")
    .replace(new RegExp(`${f}=${val}`, "g"), `${flag}=_`)
    .replace(new RegExp(`${f}\\s+${val}`, "g"), `${flag} _`);
}

/**
 * Args after the job command, optionally behind `rtk`: `bun repo job` or `[bun] <checkout>/node_modules/.bin/repo job`.
 * A relative path resolves against the hook cwd, and both sides compare in their canonical spelling.
 */
function jobRest(command: unknown, roots: Roots | null | undefined, p: typeof path = path): string[] | null {
  const cmd = String(command || "").trim();
  if (!cmd || !roots) return null;
  const parts = cmd.split(/\s+/).filter(Boolean);
  let i = isBin(parts[0], "rtk") ? 1 : 0;
  const viaBun = isBin(parts[i], "bun");
  if (viaBun) i += 1;
  const target = parts[i];
  if (!target) return null;
  if (viaBun && target === "repo") return parts[i + 1] === "job" ? parts.slice(i + 2) : null;
  const abs = resolveTyped(roots, target, p);
  const bin = canonicalPath(repoBin(roots.checkout, p), p);
  if (abs !== bin && abs !== `${bin}.exe`) return null;
  return parts[i + 1] === "job" ? parts.slice(i + 2) : null;
}

/** True when `token` is the bare command `name` or a path ending in it, with POSIX or Windows separators. */
function isBin(token: string | undefined, name: string): boolean {
  return token === name || new RegExp(`[\\\\/]${name}(?:\\.exe)?$`).test(token || "");
}

/** True when argv runs the workspace's job command (flags may be messy). */
export function isWorkspaceJobScript(command: unknown, roots: Roots | null | undefined, p: typeof path = path): boolean {
  return jobRest(command, roots, p) != null;
}

export function parseJobCommand(command: unknown, roots: Roots | null | undefined): { job: string; hasQuery: boolean; hasStash: boolean } | null {
  const cmd = String(command || "").trim();
  if (!cmd || !roots) return null;
  if (SHELL_META.test(stripFlagValue(cmd, "--query"))) return null;
  const rest = jobRest(cmd, roots);
  if (!rest) return null;
  let job = "";
  let hasQuery = false;
  let hasStash = false;
  for (let j = 0; j < rest.length; j++) {
    const a = rest[j]!; // j < rest.length
    let flag = a;
    let inline = false;
    if (a.startsWith("--") && a.includes("=")) {
      flag = a.slice(0, a.indexOf("="));
      inline = true;
    }
    if (!JOB_FLAGS.has(flag)) return null;
    if (!inline) j += 1;
    if (flag === "--job") {
      job = String(inline ? a.slice(a.indexOf("=") + 1) : rest[j] || "").toLowerCase();
    } else if (flag === "--query") {
      hasQuery = true;
    } else if (flag === "--stash") {
      hasStash = true;
    }
  }
  return { job, hasQuery, hasStash };
}

export function processFatTools(data: Payload): GateResult {
  if (!isHookObject(data)) return null;
  const { harness, key, args: input } = toolCallOf(data);
  const tool = TOOLS[harness].get(key);
  if (!tool || !input) return null;
  const roots = resolveRoots(data);
  const sid = sessionIdOf(data);
  // A Codex patch is a write, whether sent as the apply_patch tool or as a shell heredoc.
  const field = tool.kind === "patch" ? "command" : tool.command;
  const fieldValue = field ? input[field] : undefined;
  const text = typeof fieldValue === "string" ? fieldValue : "";
  const patch = tool.kind === "patch" ? text : tool.kind === "bash" ? patchOfCommand(text) : null;
  const cwdValue = tool.cwd ? input[tool.cwd] : undefined;
  const shellCwd = typeof cwdValue === "string" ? resolveTyped(roots, cwdValue) : roots.cwd;
  // Ahead of every early return, so scout subagents are held to it too.
  const redundant = redundantIgnoreReason(
    tool.kind === "write"
      ? writeIgnoreEdits(input, roots.cwd, WRITE_PATH_FIELDS)
      : patch
        ? patchIgnoreEdits(patch, shellCwd)
        : tool.kind === "bash" && text.includes(".gitignore")
          ? shellIgnoreEdits(text, shellCwd)
          : [],
  );
  if (redundant) return { type: "deny", reason: redundant };
  const stray = tool.kind === "bash" && text.includes("worktree") ? worktreeAddReason(text, roots, shellCwd) : null;
  if (stray) return { type: "deny", reason: stray };
  const shared = sharedCheckoutReason(tool, input, patch, text, roots, sid, shellCwd, harness, data.lastUserInput);
  if (shared) return { type: "deny", reason: shared };
  const guarded = reviewGuard(data, tool, input, patch, roots, sid, harness, text);
  if (guarded) return guarded;
  if (tool.kind === "write") {
    const next = Object.assign({}, input);
    const wrote: string[] = [];
    let changed = false;
    for (const key of WRITE_PATH_FIELDS) {
      const current = next[key];
      if (typeof current !== "string" || !current) continue;
      const dest = rewriteScratchWrite(current, roots);
      wrote.push(dest || current);
      if (!dest || dest === current) continue;
      // orchestrate-parent redirects the same `.tmp/repo` path, persists it, and answers the Write itself.
      if (tool.persistShared && dest === rewriteScratchPath(current, roots) && persistOwner(dest, roots.root)) continue;
      next[key] = dest;
      changed = true;
    }
    if (sid) for (const p of wrote) recordWrote(roots, sid, p);
    return changed ? { type: "rewrite", updatedInput: next } : null;
  }
  if (patch) {
    const out = rewritePatch(patch, roots);
    if (sid) for (const p of out.paths) recordWrote(roots, sid, p);
    if (!out.patch) return null;
    return { type: "rewrite", updatedInput: { ...input, [field!]: text.replace(patch, () => out.patch!) } }; // a patch only comes from tools that name a command field
  }
  if (tool.kind === "patch") return null;
  const sub = subagentTypeOf(data);
  if (sub === "scout" || sub === "researcher") return null;

  const parent = isParentOrchestrator(data);
  const isRead = tool.kind === "read";
  const isGrep = tool.kind === "grep";
  const isGlob = tool.kind === "glob";
  const isBash = tool.kind === "bash";

  if (isRead || isGrep || isGlob) {
    for (const v of collectPathValues(input)) {
      if (pathIsDenied(v)) return { type: "deny", reason: REASON_DENYLIST };
    }
    if (isGlob) {
      const raw =
        input.target_directory ||
        input.targetDirectory ||
        input.path ||
        "";
      if (typeof raw === "string" && raw) {
        const abs = path.isAbsolute(raw)
          ? raw
          : path.resolve(roots.cwd, raw);
        if (pathIsDenied(abs) || pathIsDenied(path.basename(abs))) {
          return { type: "deny", reason: REASON_DENYLIST };
        }
      }
    }

    if (isRead) {
      const abs = resolveReadPath(readFilePath(input), roots);
      const size = fileSizeBytes(abs);
      if (size != null && size > DENY_FILE_BYTES) {
        return { type: "deny", reason: REASON_FILE_SIZE };
      }
      const hasSlice =
        hasLimitField(input, "offset", "offset") ||
        hasLimitField(input, "limit", "limit");
      if (
        sid &&
        abs &&
        !hasSlice &&
        wasWroteThisSession(roots, sid, abs)
      ) {
        return { type: "deny", reason: rereadReasonFor(harness, abs, roots.checkout) };
      }
    }

    const grepDefault = parent ? DEFAULT_GREP_HEAD_LIMIT : CHILD_GREP_HEAD_LIMIT;
    const readDefault = parent ? DEFAULT_READ_LIMIT : CHILD_READ_LIMIT;
    const next = Object.assign({}, input);
    let changed = false;
    if (isGrep && tool.limits !== false) {
      const n = requestedLimit(input, "head_limit", "headLimit");
      if (n != null && n > MAX_REQUEST_LIMIT) {
        if (usesCamelInput(input)) next.headLimit = grepDefault;
        else next.head_limit = grepDefault;
        changed = true;
      } else {
        changed =
          setMissingLimit(
            next,
            input,
            "head_limit",
            "headLimit",
            grepDefault,
          ) || changed;
      }
    }
    if (isRead && tool.limits !== false) {
      const n = requestedLimit(input, "limit", "limit");
      if (n != null && n > MAX_REQUEST_LIMIT) {
        next.limit = readDefault;
        changed = true;
      } else {
        changed =
          setMissingLimit(
            next,
            input,
            "limit",
            "limit",
            readDefault,
          ) || changed;
      }
    }
    if (isGlob) {
      changed = setMissingIgnore(next, input) || changed;
    }
    return changed ? { type: "rewrite", updatedInput: next } : null;
  }

  if (isBash) {
    const cmd = text;
    if (bashTargetsDenylist(cmd)) {
      return { type: "deny", reason: REASON_DENYLIST };
    }
    if (isWorkspaceJobScript(cmd, roots)) return null;
    const next = Object.assign({}, input);
    // A test run's full log goes to the stash and the caller sees the failing lines: for implementers, and for a
    // parent while its session reviews. job takes one plain command; compound shell passes through.
    if (TEST_CMD.test(cmd) && !SHELL_META.test(cmd) && (isImplementer(sub) || (parent && sid && activeReview(roots.root, sid)))) {
      next[field!] = jobCommand(roots.checkout, `--job test --query ${quoteQuery(cmd.trim())}`);
      return { type: "rewrite", updatedInput: next };
    }
    if (BASH_WEB.test(cmd)) {
      const url = (cmd.match(/https?:\/\/\S+/) || [])[0] || "";
      if (url) {
        next[field!] = jobCommand(
          roots.checkout,
          `--job fetch --query ${quoteQuery(url)}`,
        );
        return { type: "rewrite", updatedInput: next };
      }
      return { type: "deny", reason: REASON_DENYLIST };
    }
    // job and rtk take one plain command; compound shell passes through.
    const compound = SHELL_META.test(cmd);
    if (BASH_DUMP_CMDS.test(cmd) && !alreadyRtk(cmd) && !compound) {
      const job = BASH_SEARCH.test(cmd) ? "search" : "exec";
      const q = cmd.replace(/^\s*(rtk\s+)?/, "").trim();
      next[field!] = jobCommand(roots.checkout, `--job ${job} --query ${quoteQuery(q)}`);
      return { type: "rewrite", updatedInput: next };
    }
    if (BASH_TREE.test(cmd) && !alreadyRtk(cmd) && !compound) {
      next[field!] = `rtk ${cmd.trim()}`; // bash tools name their command field
      return { type: "rewrite", updatedInput: next };
    }
    return null;
  }

  return null;
}

/** The hook answer for a gate result, in the shape the payload's harness takes. */
export function fatHookOutput(data: HookInput, result: GateResult): HookOutput | null {
  if (!result) return null;
  if (result.type === "deny") return answerDeny(data, result.reason);
  if (result.type === "rewrite") return answerRewrite(data, result.updatedInput);
  return null;
}

export function processHookPayload(data: Payload): HookOutput | null {
  const result = processFatTools(data);
  return data && result ? fatHookOutput(data, result) : null;
}

export function main(): number {
  try {
    const data = readHookInput();
    const out = processHookPayload(data);
    if (!out) return 0;
    process.stdout.write(JSON.stringify(out));
    return 0;
  } catch {
    return 0;
  }
}

/** Reads stdin until it holds one JSON object payload; null when it never does. */
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
    // Incomplete input does not parse yet; keep reading.
    const parsed = parseHookInput(buf.toString("utf8"));
    if (parsed) return parsed;
  }
  if (!buf.length) return null;
  return parseHookInput(buf.toString("utf8"));
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  process.exit(main());
}
