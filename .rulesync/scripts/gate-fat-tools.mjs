#!/usr/bin/env node
/** PreToolUse: fat Read/Grep/Glob/Bash gate. Fail-open: parse/crash → empty stdout, exit 0. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { patchIgnoreEdits, redundantIgnoreReason, shellIgnoreEdits, writeIgnoreEdits } from "./gitignore-guard.mjs";
import { persistOwner } from "./persist-tmp.mjs";
import { ENFORCED_HARNESSES, activeReview, implementerOf, parseStrategy, stampPath, writeStamp } from "./strategy.mjs";
import { canonicalPath, resolveRoots, resolveTyped } from "./workspace-root.mjs";
import { mainCheckoutWriteReason, sharedGitReason, worktreeAddReason } from "./worktree.mjs";

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
export function rereadReasonFor(harness, absPath, checkout) {
  if (harness !== "cursor") return REASON_REREAD;
  const slice = jobCommand(checkout, `--job exec --query ${quoteQuery(`sed -n 1,${DEFAULT_READ_LIMIT}p ${absPath}`)}`);
  return `already wrote this session; Cursor Read takes no offset or limit, so slice it with ${slice}`;
}

const SHELL = { kind: "bash", command: "command" };
// orchestrate-parent persists these itself, so the gate leaves their persist-owned redirects to it.
const SHARED_WRITE = { kind: "write", persistShared: true };
const WRITE = { kind: "write" };
// Cursor's Read and Grep take no offset, limit or head_limit, so the gate cannot inject or cap them.
const CURSOR_NO_LIMITS = { limits: false };

/**
 * The tools each harness sends, keyed by eventKey of the tool name. A harness only gets the kinds whose
 * fields it uses; anything else gets no answer. Claude also covers Grok, which sends the same shape.
 */
export const TOOLS = {
  claude: new Map([
    ["write", SHARED_WRITE],
    ["edit", SHARED_WRITE],
    ["searchreplace", SHARED_WRITE],
    ["replacefilecontent", SHARED_WRITE],
    ["bash", SHELL],
    ["runterminalcommand", SHELL],
    ["read", { kind: "read" }],
    ["readfile", { kind: "read" }],
    ["grep", { kind: "grep" }],
    ["grepsearch", { kind: "grep" }],
    ["glob", { kind: "glob" }],
    ["listdir", { kind: "glob" }],
  ]),
  codex: new Map([
    ["applypatch", { kind: "patch" }],
    ["bash", SHELL],
  ]),
  cursor: new Map([
    ["shell", { kind: "bash", command: "command", cwd: "cwd" }],
    ["read", { kind: "read", ...CURSOR_NO_LIMITS }],
    ["grep", { kind: "grep", ...CURSOR_NO_LIMITS }],
    ["write", SHARED_WRITE],
  ]),
  antigravity: new Map([
    ["writetofile", WRITE],
    ["replacefilecontent", WRITE],
    ["multireplacefilecontent", WRITE],
    ["runcommand", { kind: "bash", command: "CommandLine", cwd: "Cwd" }],
  ]),
};
export const WRITE_PATH_FIELDS = [
  "path",
  "file_path",
  "filePath",
  "target_file",
  "targetFile",
  "TargetFile",
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

export function eventKey(s) {
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
];
const CHILD_ID_KEYS = ["agentId", "agent_id", "spawnedBy", "spawned_by"];

function nonEmptyChildId(raw) {
  if (raw == null) return false;
  return String(raw).trim() !== "";
}

/** True when PreToolUse names a child session (UUID ok). Not a fat-gate type. */
export function hasChildAgentMarker(data) {
  if (!data || typeof data !== "object") return false;
  for (const k of CHILD_ID_KEYS) {
    if (nonEmptyChildId(data[k])) return true;
  }
  if (data.agent && typeof data.agent === "object" && !Array.isArray(data.agent)) {
    for (const k of [...CHILD_ID_KEYS, "id"]) {
      if (nonEmptyChildId(data.agent[k])) return true;
    }
  }
  return false;
}

function coerceChildType(raw) {
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

export function subagentTypeOf(data) {
  if (!data || typeof data !== "object") return "";
  for (const k of [...CHILD_TYPE_KEYS, ...CHILD_ID_KEYS]) {
    const t = coerceChildType(data[k]);
    if (t) return t;
  }
  if (data.agent && typeof data.agent === "object" && !Array.isArray(data.agent)) {
    for (const k of ["subagentType", "subagent_type", "type", "name", "agentType"]) {
      const t = coerceChildType(data.agent[k]);
      if (t) return t;
    }
  } else if (typeof data.agent === "string") {
    const t = coerceChildType(data.agent);
    if (t) return t;
  }
  return "";
}

export function isParentOrchestrator(data) {
  return !subagentTypeOf(data) && !hasChildAgentMarker(data);
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** @returns {"claude" | "codex" | "antigravity" | "cursor"} which wire shape the hook payload came in */
export function harnessOf(data) {
  // Cursor also sends model and session_id, so it is told apart by its version before Codex's check.
  if (typeof data.cursor_version === "string") return "cursor";
  if (isPlainObject(data.toolCall)) return "antigravity";
  // Codex sends both on every tool hook; Claude would read Codex's `allow` as skipping its permission prompt.
  if (typeof data.turn_id === "string" && typeof data.model === "string") return "codex";
  return "claude";
}

/** The call in one shape for every harness: its tool key and args (null when absent or not an object). */
export function toolCallOf(data) {
  const harness = harnessOf(data);
  const call = harness === "antigravity" ? data.toolCall : null;
  const name = call ? call.name : data.toolName || data.tool_name;
  let args = call ? call.args : data.toolInput;
  if (!call && args == null) args = data.tool_input;
  return { harness, key: eventKey(name), args: isPlainObject(args) ? args : null };
}

export function pathIsDenied(p) {
  if (p == null) return false;
  const n = String(p).replace(/\\/g, "/").trim();
  if (!n) return false;
  if (DENY_LOCKFILES.has(path.posix.basename(n))) return true;
  if (gitDirIn(n)) return true;
  return n.split("/").some((seg) => DENY_PATH_SEGMENTS.has(seg));
}

/** Top-level "block" is the only legacy deny Claude/Codex validate; allow = empty stdout. */
function preToolUseDeny(reason) {
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
const nestedRewrite = (args, next) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: next } });
const ANSWERS = {
  claude: {
    deny: preToolUseDeny,
    rewrite: nestedRewrite,
  },
  cursor: {
    deny: (reason) => ({ permission: "deny", user_message: reason, agent_message: reason }),
    rewrite: nestedRewrite,
  },
  codex: {
    deny: preToolUseDeny,
    rewrite: (args, next) => ({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: next },
    }),
  },
  antigravity: {
    deny: (reason) => ({ decision: "deny", reason }),
    rewrite: (args, next) => ({
      decision: "allow",
      overwrite: Object.fromEntries(Object.entries(next).filter(([k, v]) => !args || args[k] !== v)),
    }),
  },
};

export function answerDeny(data, reason) {
  return ANSWERS[harnessOf(data)].deny(reason);
}

export function answerRewrite(data, next) {
  return ANSWERS[harnessOf(data)].rewrite(toolCallOf(data).args, next);
}

/**
 * A Write aimed at any `.tmp/repo/` other than the root's goes to `<root>/.tmp/repo/<rest>`.
 * Relative paths resolve against the hook cwd. Null when it is already root scratch or not scratch.
 */
export function rewriteScratchPath(filePath, roots, p = path) {
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
export function sessionIdOf(data) {
  const sid = String(
    (data && (data.sessionId || data.session_id || data.conversationId)) || "",
  ).trim();
  if (!sid || sid === "default") return "";
  return sid;
}

export function wroteListPath(workspaceRoot, sid) {
  if (!workspaceRoot || !sid) return "";
  return path.join(workspaceRoot, ".tmp", "repo", "sessions", sid, "wrote.txt");
}

/** Absolute posix key for a file this session wrote, or "" when it is outside the root and checkout. */
function wroteKey(roots, filePath) {
  const abs = resolveTyped(roots, filePath);
  const inside = (base) => {
    const rel = path.relative(base, abs);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  };
  if (!inside(roots.root) && !inside(roots.checkout)) return "";
  return abs.replace(/\\/g, "/");
}

export function recordWrote(roots, sid, filePath) {
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

export function wasWroteThisSession(roots, sid, filePath) {
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
export function rewriteScratchWrite(filePath, roots, p = path) {
  const existing = rewriteScratchPath(filePath, roots, p);
  if (existing) return existing;
  if (filePath == null || !roots) return null;
  const wsRoot = p.resolve(roots.checkout);
  const scratch = p.resolve(roots.root, ".tmp", "repo");
  const abs = resolveTyped(roots, filePath, p);
  const rel = p.relative(wsRoot, abs).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..") || p.isAbsolute(rel)) return null;
  const segs = rel.split("/");
  const base = segs[segs.length - 1] || "";
  if (PRODUCT_ROOT_NAMES.has(base) && segs.length === 1) return null;
  if (PRODUCT_ROOT_DIRS.has(segs[0])) return null;
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
export function patchOfCommand(command) {
  const m = PATCH_HEREDOC_RE.exec(String(command || ""));
  return m ? m[3] : null;
}

/**
 * Add and Move headers whose path is scratch get the root scratch path, the same rule a Write gets.
 * Update and Delete headers stay, since they act on a file that exists where it is.
 * @returns {{ patch: string | null, paths: string[] }} the rewritten patch (null when nothing moved) and every final path
 */
export function rewritePatch(patch, roots, p = path) {
  const paths = [];
  let changed = false;
  const next = String(patch).replace(PATCH_PATH_RE, (line, op, target) => {
    const dest = op === "Add File" || op === "Move to" ? rewriteScratchWrite(target, roots, p) : null;
    if (op !== "Delete File") paths.push(dest || resolveTyped(roots, target, p));
    if (!dest) return line;
    changed = true;
    return `*** ${op}: ${dest}`;
  });
  return { patch: changed ? next : null, paths };
}

/** Every file a write or patch lands on, in the roots' spelling, after the scratch rewrite has moved what it moves. */
function writeTargets(tool, input, patch, roots) {
  if (tool.kind === "write") {
    return WRITE_PATH_FIELDS.flatMap((k) =>
      typeof input[k] === "string" && input[k] ? [rewriteScratchWrite(input[k], roots) || resolveTyped(roots, input[k])] : [],
    );
  }
  if (!patch) return [];
  return [...patch.matchAll(PATCH_PATH_RE)].map(
    ([, op, target]) => (op === "Add File" || op === "Move to" ? rewriteScratchWrite(target, roots) : null) || resolveTyped(roots, target),
  );
}

/** The strategy a plan's frontmatter holds when it is a review one, else null. */
function reviewStrategyOf(text) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const line = front && /^strategy:[ \t]*(\S+)/m.exec(front[1]);
  const strategy = line && parseStrategy(line[1]);
  return strategy && strategy !== "default" ? strategy : null;
}

/** A parent's save of a plan that holds a review strategy points the session at it: the Write content, else the file on disk. */
function stampReviewPlan(tool, input, targets, roots, sid) {
  const plans = canonicalPath(path.join(roots.root, ".tmp", "repo", "plans"));
  const given = [input.content, input.CodeContent, input.contents, input.file_text].find((v) => typeof v === "string");
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
export function stampPlanSave(data) {
  try {
    const sid = isPlainObject(data) ? sessionIdOf(data) : "";
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
function gitAskedBy(root, sid) {
  try {
    if (!sid) return new Set();
    const { words } = JSON.parse(fs.readFileSync(path.join(path.dirname(stampPath(root, sid)), "git-asked.json"), "utf8"));
    return new Set(Array.isArray(words) ? words.filter((w) => typeof w === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * The deny reason for a write or patch that lands in the main checkout, or a shell command that commits or destroys
 * work there or hits shared refs. Ahead of every early return, so scouts, implementers and every harness are held to it.
 * An error in here lets the call through, as the gate does everywhere else.
 */
function sharedCheckoutReason(tool, input, patch, text, roots, sid, shellCwd) {
  try {
    if (tool.kind === "write" || patch) {
      for (const target of writeTargets(tool, input, patch, roots)) {
        const reason = mainCheckoutWriteReason(target, roots);
        if (reason) return reason;
      }
    }
    if (tool.kind === "bash" && /\bgit\b/.test(text)) return sharedGitReason(text, roots, shellCwd, gitAskedBy(roots.root, sid));
    return null;
  } catch {
    return null;
  }
}

export const REASON_IMPLEMENTER_WRITE = "implementer writes product files and tests only; the reviewer writes the plan and the journal";
export const REASON_IMPLEMENTER_GIT = "implementer never stages or commits; report the changed files and the reviewer stages them";
const GIT_STAGE = /(?:^|[\s;&|(])git(?:\s+(?:-[Cc]\s+\S+|--[\w-]+(?:=\S+)?|-\w))*\s+(?:add|commit)(?![\w-])/;

/** True for a child spawned from an implementer-* agent. */
export function isImplementer(sub) {
  return String(sub).startsWith("implementer-");
}

/** True when `target` is not inside `<root>/.tmp`; both in the roots' spelling. */
export function isOutsideRootTmp(target, root, p = path) {
  return isOutside(p, canonicalPath(p.resolve(root, ".tmp"), p), target);
}

function isOutside(p, dir, target) {
  const rel = p.relative(dir, target);
  return rel === ".." || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel);
}

const reviewDenyReason = (review) =>
  `plan ${review.serial} runs strategy ${review.strategy}: this session reviews. Spawn ${implementerOf(review.strategy, 1)} for product writes; the plan, the journal and .tmp/ stay writable.`;

/**
 * What a review strategy asks of a write, and of an implementer's shell. Ahead of the write branch and the scout
 * return, so no early return skips it. An error in here lets the call through, as the gate does everywhere else.
 *   implementer-*  never writes the plan or the journal, never runs git add or git commit (every strategy)
 *   parent         a save of a review plan stamps the session; while that plan runs, no write outside `<root>/.tmp`
 */
function reviewGuard(data, tool, input, patch, roots, sid, harness, command) {
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
export function quoteQuery(q) {
  return `'${String(q).replace(/'/g, "'\\''")}'`;
}

export function jobCommand(workspaceRoot, args) {
  const script = path.join(workspaceRoot, ".rulesync", "scripts", "job.mjs");
  return `node ${script} ${args}`;
}

function asNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function requestedLimit(input, snake, camel) {
  return asNumber(input[snake] ?? input[camel]);
}

function hasLimitField(input, snake, camel) {
  return (
    Object.prototype.hasOwnProperty.call(input, snake) ||
    Object.prototype.hasOwnProperty.call(input, camel)
  );
}

function usesCamelInput(input) {
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

function setMissingLimit(next, input, snake, camel, value) {
  if (hasLimitField(input, snake, camel)) return false;
  if (usesCamelInput(input) && snake !== camel) next[camel] = value;
  else next[snake] = value;
  return true;
}

export const GLOB_IGNORE = [...DENY_PATH_SEGMENTS, ".git"];

function setMissingIgnore(next, input) {
  if (hasLimitField(input, "ignore", "ignoreGlobs")) return false;
  if (usesCamelInput(input)) next.ignoreGlobs = GLOB_IGNORE.slice();
  else next.ignore = GLOB_IGNORE.slice();
  return true;
}

function collectPathValues(input) {
  const out = [];
  for (const key of PATH_FIELDS) {
    const v = input[key];
    if (typeof v === "string" && v) out.push(v);
  }
  return out;
}

function readFilePath(input) {
  return (
    input.target_file ||
    input.file_path ||
    input.targetFile ||
    input.filePath ||
    ""
  );
}

export function resolveReadPath(filePath, roots) {
  if (!filePath || typeof filePath !== "string") return null;
  return resolveTyped(roots, filePath);
}

export function fileSizeBytes(absPath) {
  if (!absPath) return null;
  try {
    const st = fs.statSync(absPath);
    if (!st.isFile()) return null;
    return st.size;
  } catch {
    return null;
  }
}

export function bashTargetsDenylist(command) {
  const cmd = String(command || "");
  if (!cmd.trim()) return false;
  if (!BASH_DUMP_CMDS.test(cmd) && !DENY_LOCKFILES_IN_CMD(cmd)) return false;
  if (DENY_LOCKFILES_IN_CMD(cmd) && BASH_DUMP_CMDS.test(cmd)) return true;
  if (gitDirIn(cmd) && BASH_DUMP_CMDS.test(cmd)) return true;
  for (const seg of DENY_PATH_SEGMENTS) {
    const re = new RegExp(
      `(^|[\\/\\s'"\`])${escapeRe(seg)}([\\/\\s'"\`]|$)`,
    );
    if (re.test(cmd) && BASH_DUMP_CMDS.test(cmd)) return true;
  }
  return false;
}

function gitDirIn(s) {
  return /(^|[\s/])\.git(\/|$)/.test(String(s).replace(/\\/g, "/"));
}

function DENY_LOCKFILES_IN_CMD(cmd) {
  return /\bbun\.lock\b/.test(cmd);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function alreadyRtk(command) {
  const first = String(command || "")
    .trim()
    .split(/\s+/, 1)[0] || "";
  return first === "rtk" || first.endsWith("/rtk");
}

export function stripFlagValue(cmd, flag) {
  const f = escapeRe(flag);
  const val = `(?:"[^"]*"|'[^']*'|\\S+)`;
  return String(cmd || "")
    .replace(new RegExp(`${f}=${val}`, "g"), `${flag}=_`)
    .replace(new RegExp(`${f}\\s+${val}`, "g"), `${flag} _`);
}

/** Args after `node <checkout>/.rulesync/scripts/job.mjs`; a relative script path resolves against the hook cwd. */
function jobRest(command, roots) {
  const cmd = String(command || "").trim();
  if (!cmd || !roots) return null;
  const parts = cmd.split(/\s+/).filter(Boolean);
  let i = 0;
  const first = parts[0] || "";
  if (first === "rtk" || first.endsWith("/rtk")) i = 1;
  const bin = parts[i] || "";
  if (bin !== "node" && !bin.endsWith("/node")) return null;
  i += 1;
  const scriptArg = parts[i];
  if (!scriptArg) return null;
  const abs = resolveTyped(roots, scriptArg);
  const expected = path.resolve(roots.checkout, ".rulesync", "scripts", "job.mjs");
  if (abs !== expected) return null;
  return parts.slice(i + 1);
}

/** True when argv targets workspace .rulesync/scripts/job.mjs (flags may be messy). */
export function isWorkspaceJobScript(command, roots) {
  return jobRest(command, roots) != null;
}

export function parseJobCommand(command, roots) {
  const cmd = String(command || "").trim();
  if (!cmd || !roots) return null;
  if (SHELL_META.test(stripFlagValue(cmd, "--query"))) return null;
  const rest = jobRest(cmd, roots);
  if (!rest) return null;
  let job = "";
  let hasQuery = false;
  let hasStash = false;
  for (let j = 0; j < rest.length; j++) {
    const a = rest[j];
    let flag = a;
    let inline = false;
    if (typeof a === "string" && a.startsWith("--") && a.includes("=")) {
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

/**
 * @returns {null | { type: "deny", reason: string } | { type: "rewrite", updatedInput: object }}
 */
export function processFatTools(data) {
  if (!isPlainObject(data)) return null;
  const { harness, key, args: input } = toolCallOf(data);
  const tool = TOOLS[harness].get(key);
  if (!tool || !input) return null;
  const roots = resolveRoots(data);
  const sid = sessionIdOf(data);
  // A Codex patch is a write, whether sent as the apply_patch tool or as a shell heredoc.
  const field = tool.kind === "patch" ? "command" : tool.command;
  const text = field && typeof input[field] === "string" ? input[field] : "";
  const patch = tool.kind === "patch" ? text : tool.kind === "bash" ? patchOfCommand(text) : null;
  const shellCwd = tool.cwd && typeof input[tool.cwd] === "string" ? resolveTyped(roots, input[tool.cwd]) : roots.cwd;
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
  const shared = sharedCheckoutReason(tool, input, patch, text, roots, sid, shellCwd);
  if (shared) return { type: "deny", reason: shared };
  const guarded = reviewGuard(data, tool, input, patch, roots, sid, harness, text);
  if (guarded) return guarded;
  if (tool.kind === "write") {
    const next = Object.assign({}, input);
    const wrote = [];
    let changed = false;
    for (const key of WRITE_PATH_FIELDS) {
      if (typeof next[key] !== "string" || !next[key]) continue;
      const dest = rewriteScratchWrite(next[key], roots);
      wrote.push(dest || next[key]);
      if (!dest || dest === next[key]) continue;
      // orchestrate-parent redirects the same `.tmp/repo` path, persists it, and answers the Write itself.
      if (tool.persistShared && dest === rewriteScratchPath(next[key], roots) && persistOwner(dest, roots.root)) continue;
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
    return { type: "rewrite", updatedInput: { ...input, [field]: text.replace(patch, () => out.patch) } };
  }
  if (tool.kind === "patch") return null;
  const sub = subagentTypeOf(data);
  if (sub === "scout") return null;

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
      if (raw) {
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
      next[field] = jobCommand(roots.checkout, `--job test --query ${quoteQuery(cmd.trim())}`);
      return { type: "rewrite", updatedInput: next };
    }
    if (BASH_WEB.test(cmd)) {
      const url = (cmd.match(/https?:\/\/\S+/) || [])[0] || "";
      if (url) {
        next[field] = jobCommand(
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
      next[field] = jobCommand(roots.checkout, `--job ${job} --query ${quoteQuery(q)}`);
      return { type: "rewrite", updatedInput: next };
    }
    if (BASH_TREE.test(cmd) && !alreadyRtk(cmd) && !compound) {
      next[field] = `rtk ${cmd.trim()}`;
      return { type: "rewrite", updatedInput: next };
    }
    return null;
  }

  return null;
}

/** The hook answer for a gate result, in the shape the payload's harness takes. */
export function fatHookOutput(data, result) {
  if (!result) return null;
  if (result.type === "deny") return answerDeny(data, result.reason);
  if (result.type === "rewrite") return answerRewrite(data, result.updatedInput);
  return null;
}

export function processHookPayload(data) {
  return fatHookOutput(data, processFatTools(data));
}

function main() {
  try {
    const data = readJsonValue();
    const out = processHookPayload(data);
    if (!out) return 0;
    process.stdout.write(JSON.stringify(out));
    return 0;
  } catch {
    return 0;
  }
}

function readJsonValue() {
  let buf = Buffer.alloc(0);
  const tmp = Buffer.alloc(8192);
  for (;;) {
    let n;
    try {
      n = fs.readSync(0, tmp, 0, tmp.length, null);
    } catch {
      break;
    }
    if (n === 0) break;
    buf = Buffer.concat([buf, tmp.subarray(0, n)]);
    try {
      return JSON.parse(buf.toString("utf8"));
    } catch {
      // incomplete
    }
  }
  if (!buf.length) return undefined;
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return undefined;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  process.exit(main());
}
