#!/usr/bin/env node
/** PreToolUse: fat Read/Grep/Glob/Bash gate. Fail-open: parse/crash → empty stdout, exit 0. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { persistOwner } from "./persist-tmp.mjs";
import { resolveRoots } from "./workspace-root.mjs";

/** Session Grep head_limit when the model omits one. */
export const DEFAULT_GREP_HEAD_LIMIT = 50;
/** Session Read line limit when the model omits one. */
export const DEFAULT_READ_LIMIT = 200;
/** Unknown non-grunt child Grep head_limit when omitted. */
export const CHILD_GREP_HEAD_LIMIT = 150;
/** Unknown non-grunt child Read line limit when omitted. */
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
export const DENY_LOCKFILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

export const REASON_DENYLIST = "path denylist; use package API";
export const REASON_HEAD_LIMIT = "head_limit>500";
export const REASON_FILE_SIZE = "file >200KB";
export const REASON_IMPLEMENTER_BASH = "need: grunt job:exec|test query:…";
export const REASON_BASH_DUMP = REASON_IMPLEMENTER_BASH;
export const REASON_REREAD =
  "already wrote this session; Read with offset+limit";

const READ_TOOLS = new Set(["read", "readfile"]);
const GREP_TOOLS = new Set(["grep", "grepsearch"]);
const GLOB_TOOLS = new Set(["glob", "listdir"]);
const BASH_TOOLS = new Set(["bash", "runterminalcommand"]);
const WRITE_TOOLS = new Set(["write", "edit", "searchreplace"]);
export const WRITE_PATH_FIELDS = [
  "path",
  "file_path",
  "filePath",
  "target_file",
  "targetFile",
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
const BASH_TEST =
  /\b(?:npm|pnpm|yarn|bun)\s+test\b|\bcargo\s+test\b|\bpytest\b|\bvitest\b|\bjest\b/;
export const SHELL_META = /[|&;`$(){}<>\n\r]/;
const GRUNT_JOB_FLAGS = new Set([
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
  "CLAUDE.md",
  "GEMINI.md",
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

export function toolInputOf(data) {
  if (!data || typeof data !== "object") return null;
  let toolInput = data.toolInput;
  if (toolInput == null) toolInput = data.tool_input;
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    return null;
  }
  return toolInput;
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
export function denyResponse(reason) {
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

export function hookResponse(updated) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: updated,
    },
  };
}

/**
 * A Write aimed at any `.tmp/grunt/` other than the root's goes to `<root>/.tmp/grunt/<rest>`.
 * Relative paths resolve against the hook cwd. Null when it is already root scratch or not scratch.
 */
export function rewriteGruntScratchPath(filePath, roots, p = path) {
  if (filePath == null || !roots) return null;
  const raw = String(filePath);
  if (!raw) return null;
  const destRoot = p.resolve(roots.root, ".tmp", "grunt");
  const absIn = p.resolve(roots.cwd, raw);
  const inRoot = p.relative(destRoot, absIn);
  if (!inRoot.startsWith("..") && !p.isAbsolute(inRoot)) return null;

  // Inside the root, look below it, so a root that itself sits under some `.tmp/grunt` is not matched.
  const fromRoot = p.relative(roots.root, absIn);
  const inside = !fromRoot.startsWith("..") && !p.isAbsolute(fromRoot);
  const posix = (inside ? fromRoot : raw).replace(/\\/g, "/");
  const marker = /(^|\/)\.tmp\/grunt\//.exec(posix);
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

export function sessionIdOf(data) {
  const sid = String(
    (data && (data.sessionId || data.session_id)) || "",
  ).trim();
  if (!sid || sid === "default") return "";
  return sid;
}

export function wroteListPath(workspaceRoot, sid) {
  if (!workspaceRoot || !sid) return "";
  return path.join(workspaceRoot, ".tmp", "grunt", "sessions", sid, "wrote.txt");
}

/** Absolute posix key for a file this session wrote, or "" when it is outside the root and checkout. */
function wroteKey(roots, filePath) {
  const abs = path.resolve(roots.cwd, filePath);
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

/** Stray scratch names and `tmp/` dirs at the checkout top go under the root's `.tmp/grunt`. */
export function rewriteScratchWrite(filePath, roots) {
  const existing = rewriteGruntScratchPath(filePath, roots);
  if (existing) return existing;
  if (filePath == null || !roots) return null;
  const wsRoot = path.resolve(roots.checkout);
  const scratch = path.resolve(roots.root, ".tmp", "grunt");
  const abs = path.resolve(roots.cwd, filePath);
  const rel = path.relative(wsRoot, abs).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const segs = rel.split("/");
  const base = segs[segs.length - 1] || "";
  if (PRODUCT_ROOT_NAMES.has(base) && segs.length === 1) return null;
  if (PRODUCT_ROOT_DIRS.has(segs[0])) return null;
  if (rel.startsWith(".tmp/grunt/")) return null;
  if (segs[0] === "tmp" || (segs[0] === ".tmp" && segs[1] !== "grunt")) {
    const rest = segs[0] === "tmp" ? segs.slice(1) : segs.slice(2);
    const dest = path.resolve(scratch, ...rest);
    const check = path.relative(scratch, dest);
    if (!check || check.startsWith("..") || path.isAbsolute(check)) return null;
    return dest;
  }
  if (
    segs.length === 1 &&
    (SCRATCH_ROOT_NAMES.has(base) ||
      /\.tmp$/i.test(base) ||
      SCRATCH_ROOT_RE.test(base))
  ) {
    return path.resolve(scratch, base);
  }
  return null;
}

/** POSIX single-quote so `, $, and \ stay literal. */
export function quoteQuery(q) {
  return `'${String(q).replace(/'/g, "'\\''")}'`;
}

export function gruntJobCommand(workspaceRoot, args) {
  const script = path.join(workspaceRoot, ".rulesync", "scripts", "grunt-job.mjs");
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
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(roots.cwd, filePath);
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
  return /\b(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)\b/.test(cmd);
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

/** Args after `node <checkout>/.rulesync/scripts/grunt-job.mjs`; a relative script path resolves against the hook cwd. */
function gruntJobRest(command, roots) {
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
  const abs = path.resolve(roots.cwd, scriptArg);
  const expected = path.resolve(roots.checkout, ".rulesync", "scripts", "grunt-job.mjs");
  if (abs !== expected) return null;
  return parts.slice(i + 1);
}

/** True when argv targets workspace .rulesync/scripts/grunt-job.mjs (flags may be messy). */
export function isWorkspaceGruntJobScript(command, roots) {
  return gruntJobRest(command, roots) != null;
}

export function parseGruntJobCommand(command, roots) {
  const cmd = String(command || "").trim();
  if (!cmd || !roots) return null;
  if (SHELL_META.test(stripFlagValue(cmd, "--query"))) return null;
  const rest = gruntJobRest(cmd, roots);
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
    if (!GRUNT_JOB_FLAGS.has(flag)) return null;
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

export function isWorkspaceGruntJob(command, roots, allowedJobs) {
  const parsed = parseGruntJobCommand(command, roots);
  if (!parsed) return false;
  const allow = allowedJobs || ["search", "exec", "test", "slice", "fetch"];
  if (!allow.includes(parsed.job)) return false;
  if (parsed.job === "slice") return parsed.hasStash || parsed.hasQuery;
  return parsed.hasQuery;
}

export function implementerBashReason(command, roots) {
  const cmd = String(command || "");
  if (bashTargetsDenylist(cmd)) return REASON_DENYLIST;
  if (alreadyRtk(cmd)) return null;
  if (isWorkspaceGruntJob(cmd, roots, ["search", "exec", "test", "slice", "fetch"])) {
    return null;
  }
  const wsGrunt = isWorkspaceGruntJobScript(cmd, roots);
  if (BASH_WEB.test(cmd)) return REASON_IMPLEMENTER_BASH;
  if (!wsGrunt && (BASH_SEARCH.test(cmd) || BASH_TEST.test(cmd))) {
    return REASON_IMPLEMENTER_BASH;
  }
  return null;
}

/**
 * @returns {null | { type: "deny", reason: string } | { type: "rewrite", updatedInput: object }}
 */
export function processFatTools(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const toolKey = eventKey(data.toolName || data.tool_name || "");
  const input = toolInputOf(data);
  if (!input) return null;
  const roots = resolveRoots(data);
  const isWrite = WRITE_TOOLS.has(toolKey);
  if (isWrite) {
    const next = Object.assign({}, input);
    const wrote = [];
    let changed = false;
    for (const key of WRITE_PATH_FIELDS) {
      if (typeof next[key] !== "string" || !next[key]) continue;
      const dest = rewriteScratchWrite(next[key], roots);
      wrote.push(dest || next[key]);
      if (!dest || dest === next[key]) continue;
      // orchestrate-parent redirects the same `.tmp/grunt` path, persists it, and answers the Write itself.
      if (dest === rewriteGruntScratchPath(next[key], roots) && persistOwner(dest, roots.root)) continue;
      next[key] = dest;
      changed = true;
    }
    const sid = sessionIdOf(data);
    if (sid) for (const p of wrote) recordWrote(roots, sid, p);
    return changed ? { type: "rewrite", updatedInput: next } : null;
  }
  const sub = subagentTypeOf(data);
  if (sub === "grunt") return null;

  const parent = isParentOrchestrator(data);
  const isRead = READ_TOOLS.has(toolKey);
  const isGrep = GREP_TOOLS.has(toolKey);
  const isGlob = GLOB_TOOLS.has(toolKey);
  const isBash = BASH_TOOLS.has(toolKey);

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
      const sid = sessionIdOf(data);
      const hasSlice =
        hasLimitField(input, "offset", "offset") ||
        hasLimitField(input, "limit", "limit");
      if (
        sid &&
        abs &&
        !hasSlice &&
        wasWroteThisSession(roots, sid, abs)
      ) {
        return { type: "deny", reason: REASON_REREAD };
      }
    }

    const grepDefault = parent ? DEFAULT_GREP_HEAD_LIMIT : CHILD_GREP_HEAD_LIMIT;
    const readDefault = parent ? DEFAULT_READ_LIMIT : CHILD_READ_LIMIT;
    const next = Object.assign({}, input);
    let changed = false;
    if (isGrep) {
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
    if (isRead) {
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
    const cmd = typeof input.command === "string" ? input.command : "";
    if (bashTargetsDenylist(cmd)) {
      return { type: "deny", reason: REASON_DENYLIST };
    }
    if (isWorkspaceGruntJobScript(cmd, roots)) return null;
    const next = Object.assign({}, input);
    if (BASH_WEB.test(cmd)) {
      const url = (cmd.match(/https?:\/\/\S+/) || [])[0] || "";
      if (url) {
        next.command = gruntJobCommand(
          roots.checkout,
          `--job fetch --query ${quoteQuery(url)}`,
        );
        return { type: "rewrite", updatedInput: next };
      }
      return { type: "deny", reason: REASON_DENYLIST };
    }
    // grunt-job and rtk take one plain command; compound shell passes through.
    const compound = SHELL_META.test(cmd);
    if (BASH_DUMP_CMDS.test(cmd) && !alreadyRtk(cmd) && !compound) {
      const job = BASH_SEARCH.test(cmd) ? "search" : "exec";
      const q = cmd.replace(/^\s*(rtk\s+)?/, "").trim();
      next.command = gruntJobCommand(roots.checkout, `--job ${job} --query ${quoteQuery(q)}`);
      return { type: "rewrite", updatedInput: next };
    }
    if (BASH_TREE.test(cmd) && !alreadyRtk(cmd) && !compound) {
      next.command = `rtk ${cmd.trim()}`;
      return { type: "rewrite", updatedInput: next };
    }
    if (sub === "implementer") {
      const reason = implementerBashReason(cmd, roots);
      if (reason) return { type: "deny", reason };
    }
    return null;
  }

  return null;
}

export function fatHookOutput(result) {
  if (!result) return null;
  if (result.type === "deny") return denyResponse(result.reason);
  if (result.type === "rewrite") return hookResponse(result.updatedInput);
  return null;
}

export function processHookPayload(data) {
  return fatHookOutput(processFatTools(data));
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
