#!/usr/bin/env node
/**
 * Overlay after `rulesync generate -f hooks`, for what hooks.jsonc cannot express.
 * Union, never replace: rulesync's own groups (scrub, gate, orchestrate-parent, session map)
 * are left as generated.
 *
 * Claude/Codex native event is UserPromptSubmit (mapped from SoT beforeSubmitPrompt).
 * Antigravity has neither beforeSubmitPrompt nor subagentStop.
 * Grok SessionStart stays empty on orchestrate-parent.json.
 * Claude/Codex SessionStart: session-map.mjs (folder map) when shipped, first in the group.
 * Antigravity SessionStart is rulesync's flat entries, consumer extras appended flat.
 * Cursor's .cursor/hooks.json is all flat entries; consumer extras are appended flat under its own tool name.
 *
 * Consumer extras (if those scripts exist): SessionStart, check-behind,
 * validate+sim; Antigravity and Cursor get them under their own tool names.
 * Path deny from consumer `.rulesync/permissions.json`.
 * Claude WorktreeCreate / WorktreeRemove come from hooks.jsonc's claudecode block; --check needs them when worktree.mjs ships.
 * Every hook command is rootCmd(): the script in the project dir, else at its git top level.
 *
 *   node .rulesync/scripts/hooks-union.mjs           apply then check
 *   node .rulesync/scripts/hooks-union.mjs --check   keep-list only
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripJsonc } from "./jsonc.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const ROOT_PREFIX = 'd="${GROK_WORKSPACE_ROOT:-${CLAUDE_PROJECT_DIR:-.}}"; [ -e "$d/';

/** Hook command for `rel`: the script in the project dir, else at that dir's git top level, else in the hook cwd. */
export function rootCmd(rel, args) {
  const cmd = `${ROOT_PREFIX}${rel}" ] || d="$(git -C "$d" rev-parse --show-toplevel 2>/dev/null || echo "$d")"; node "$d/${rel}"`;
  return args ? `${cmd} ${args}` : cmd;
}

export const PULL = rootCmd("scripts/daily-pull-check.mjs");
export const RTK = rootCmd("scripts/rtk-check.mjs");
export const FLEET = rootCmd("scripts/daily-fleet-check.mjs");
export const BEHIND = rootCmd("scripts/check-behind.mjs", "--hook");
export const VALIDATE = rootCmd("scripts/validate.mjs", "--hook");
export const SIM = rootCmd("scripts/sim.mjs", "--hook");
export const MAP = rootCmd(".rulesync/scripts/session-map.mjs");
const MAP_NEEDLE = "session-map.mjs";

export const AUTORUN_NEEDLES = [
  "daily-pull-check.mjs",
  "rtk-check.mjs",
  "daily-fleet-check.mjs",
  "check-behind.mjs",
  "validate.mjs",
  "sim.mjs",
];
export const OWNED_NEEDLES = ["scrub-spawn-prompt.mjs", "gate-fat-tools.mjs"];
export const GIT_HOOKS = [
  "scripts/git-hooks/pre-commit",
  "scripts/git-hooks/pre-commit.mjs",
  "scripts/git-hooks/pre-push",
  "scripts/git-hooks/pre-push.mjs",
];
export const POST_WRITE_MATCHER = "Write|Edit|write|search_replace";
/** Antigravity's write tools. Matchers rulesync does not generate must use these names; it only translates its own. */
export const AGY_WRITE_MATCHER = "write_file|edit_file";

/** Cursor's write tool. Entries rulesync does not generate must use its name; Cursor has no Edit tool. */
export const CURSOR_WRITE_MATCHER = "Write";

export function parseArgv(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let check = false;
  for (const a of args) {
    if (a === "--check") {
      check = true;
      continue;
    }
    return { ok: false, error: `unknown flag: ${a}` };
  }
  return { ok: true, check };
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function resolveRoot(opts) {
  if (typeof opts === "string") return opts;
  if (opts && typeof opts.workspaceRoot === "string" && opts.workspaceRoot) {
    return opts.workspaceRoot;
  }
  return process.cwd();
}

/** Consumer-owned extras live in the consumer's root `scripts/`. */
function hasScript(root, name) {
  return fs.existsSync(path.join(root, "scripts", name));
}

function hasOwnedScript(root, name) {
  return fs.existsSync(path.join(root, ".rulesync", "scripts", name));
}

function withoutWritePath(arr) {
  return arr.filter((x) => typeof x === "string" && !x.startsWith("Write("));
}

function loadConsumerDeny(root) {
  const data = loadJson(path.join(root, ".rulesync/permissions.json"));
  return Array.isArray(data.deny) ? withoutWritePath(data.deny) : [];
}

function presentAutorun(root) {
  return AUTORUN_NEEDLES.filter((n) => hasScript(root, n));
}

function hookCmd(command, timeout) {
  const h = { type: "command", command };
  if (timeout != null) h.timeout = timeout;
  return h;
}

function commandsIn(group) {
  if (!isPlainObject(group)) return [];
  const out = [];
  if (typeof group.command === "string") out.push(group.command);
  const hooks = Array.isArray(group.hooks) ? group.hooks : [];
  for (const h of hooks) {
    if (isPlainObject(h) && typeof h.command === "string") out.push(h.command);
  }
  return out;
}

function needleOf(group) {
  for (const c of commandsIn(group)) {
    const m = String(c).match(/([\w.-]+\.mjs|orchestrate-parent\.js)/);
    if (m) return m[1];
  }
  return commandsIn(group)[0] || JSON.stringify(group);
}

function upsertGroups(existing, desired) {
  const prev = Array.isArray(existing) ? existing : [];
  const desiredNeedles = new Set(desired.map(needleOf));
  const extras = prev.filter((g) => !desiredNeedles.has(needleOf(g)));
  return [...desired, ...extras];
}

function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function loadJson(p) {
  if (!fs.existsSync(p)) return {};
  const raw = fs.readFileSync(p, "utf8");
  if (!String(raw).trim()) return {};
  const v = JSON.parse(raw);
  return isPlainObject(v) ? v : {};
}

function saveJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`);
}

function desiredPre(root, writeMatcher = "Write|Edit") {
  return hasScript(root, "check-behind.mjs") ? [{ matcher: writeMatcher, hooks: [hookCmd(BEHIND)] }] : [];
}

function mapNeedles(root) {
  return hasOwnedScript(root, MAP_NEEDLE) ? [MAP_NEEDLE] : [];
}

/** `map: false` for Antigravity, where rulesync writes the map entry itself. */
function desiredSession(root, { map = true } = {}) {
  const hooks = [];
  if (map && hasOwnedScript(root, MAP_NEEDLE)) hooks.push(hookCmd(MAP, 5));
  if (hasScript(root, "daily-pull-check.mjs")) hooks.push(hookCmd(PULL));
  if (hasScript(root, "rtk-check.mjs")) hooks.push(hookCmd(RTK));
  if (hasScript(root, "daily-fleet-check.mjs")) hooks.push(hookCmd(FLEET));
  return hooks.length ? [{ hooks }] : null;
}

function desiredPost(root, matcher = POST_WRITE_MATCHER) {
  const hooks = [];
  if (hasScript(root, "validate.mjs")) hooks.push(hookCmd(VALIDATE));
  if (hasScript(root, "sim.mjs")) hooks.push(hookCmd(SIM));
  return hooks.length ? [{ matcher, hooks }] : null;
}

function consumerNamed(root) {
  const named = {};
  if (hasScript(root, "daily-pull-check.mjs")) {
    named["daily-pull-all"] = { event: "SessionStart", command: PULL };
  }
  if (hasScript(root, "rtk-check.mjs")) {
    named["rtk-check"] = { event: "SessionStart", command: RTK };
  }
  if (hasScript(root, "daily-fleet-check.mjs")) {
    named["daily-fleet-digest"] = { event: "SessionStart", command: FLEET };
  }
  if (hasScript(root, "check-behind.mjs")) {
    named["check-behind"] = { event: "PreToolUse", matcher: AGY_WRITE_MATCHER, command: BEHIND };
  }
  if (hasScript(root, "validate.mjs")) {
    named["validate-artifact"] = { event: "PostToolUse", matcher: AGY_WRITE_MATCHER, command: VALIDATE };
  }
  if (hasScript(root, "sim.mjs")) {
    named["simulate-artifact"] = { event: "PostToolUse", matcher: AGY_WRITE_MATCHER, command: SIM };
  }
  return named;
}

const WORKTREE_NEEDLE = "worktree.mjs";

function applyClaude(root) {
  const abs = path.join(root, ".claude/settings.json");
  const live = loadJson(abs);
  const hooks = isPlainObject(live.hooks) ? { ...live.hooks } : {};
  hooks.PreToolUse = upsertGroups(hooks.PreToolUse, desiredPre(root));
  const session = desiredSession(root);
  if (session) hooks.SessionStart = session;
  const post = desiredPost(root);
  if (post) hooks.PostToolUse = upsertGroups(hooks.PostToolUse, post);
  const permissions = isPlainObject(live.permissions) ? { ...live.permissions } : {};
  const liveDeny = Array.isArray(permissions.deny) ? permissions.deny : [];
  permissions.deny = uniq([
    ...liveDeny.filter((x) => typeof x !== "string" || !x.startsWith("Write(")),
    ...loadConsumerDeny(root),
  ]);
  const next = { ...live, permissions, hooks };
  saveJson(abs, next);
}

function applyCodex(root) {
  const abs = path.join(root, ".codex/hooks.json");
  const live = loadJson(abs);
  const nested = isPlainObject(live.hooks);
  const cur = nested ? { ...live.hooks } : { ...live };
  cur.PreToolUse = upsertGroups(cur.PreToolUse, desiredPre(root));
  const session = desiredSession(root);
  if (session) cur.SessionStart = session;
  const post = desiredPost(root);
  if (post) {
    const codexPost = post.map((g) => ({ hooks: g.hooks }));
    cur.PostToolUse = upsertGroups(cur.PostToolUse, codexPost);
  }
  if (nested) saveJson(abs, { ...live, hooks: cur });
  else saveJson(abs, { ...live, ...cur });
}

/** Antigravity rejects the `{matcher, hooks}` group form for SessionStart: flat entries, `extra` after what is there. */
function flatSession(existing, extra) {
  const prev = (Array.isArray(existing) ? existing : []).flatMap((e) =>
    isPlainObject(e) && Array.isArray(e.hooks) ? e.hooks : [e],
  );
  const added = new Set(extra.map((h) => h.command));
  return [...prev.filter((e) => !(isPlainObject(e) && added.has(e.command))), ...extra];
}

/** `{matcher, hooks}` groups as the flat `{...hook, matcher}` entries Cursor reads. */
function flatEntries(groups) {
  return (groups || []).flatMap((g) => g.hooks.map((h) => (g.matcher ? { ...h, matcher: g.matcher } : h)));
}

function applyCursor(root) {
  const abs = path.join(root, ".cursor/hooks.json");
  const live = loadJson(abs);
  const hooks = isPlainObject(live.hooks) ? { ...live.hooks } : {};
  hooks.preToolUse = upsertGroups(hooks.preToolUse, flatEntries(desiredPre(root, CURSOR_WRITE_MATCHER)));
  const session = desiredSession(root, { map: false });
  if (session) hooks.sessionStart = flatSession(hooks.sessionStart, session[0].hooks);
  const post = desiredPost(root, CURSOR_WRITE_MATCHER);
  if (post) hooks.postToolUse = upsertGroups(hooks.postToolUse, flatEntries(post));
  saveJson(abs, { version: 1, ...live, hooks });
}

function applyAgents(root) {
  const abs = path.join(root, ".agents/hooks.json");
  const live = loadJson(abs);
  const rulesync = isPlainObject(live.rulesync) ? { ...live.rulesync } : {};
  rulesync.PreToolUse = upsertGroups(rulesync.PreToolUse, desiredPre(root, AGY_WRITE_MATCHER));
  const session = desiredSession(root, { map: false });
  if (session) rulesync.SessionStart = flatSession(rulesync.SessionStart, session[0].hooks);
  const post = desiredPost(root, AGY_WRITE_MATCHER);
  if (post) rulesync.PostToolUse = post;
  saveJson(abs, { ...live, ...consumerNamed(root), rulesync });
}

export function applyUnion(opts = {}) {
  const root = resolveRoot(opts);
  const check = typeof opts === "object" && opts && opts.check === true;
  if (check) {
    const failures = checkUnion({ workspaceRoot: root });
    if (failures.length) {
      return { ok: false, check: true, error: `drift: ${failures.join("; ")}`, failures };
    }
    return { ok: true, check: true, failures: [] };
  }
  applyClaude(root);
  applyCodex(root);
  applyAgents(root);
  applyCursor(root);
  return { ok: true, check: false };
}

/** Hook files whose repo and autorun commands must be `rootCmd` strings. */
const COMMAND_FILES = [
  ["claude", ".claude/settings.json"],
  ["codex", ".codex/hooks.json"],
  ["agents", ".agents/hooks.json"],
  ["cursor", ".cursor/hooks.json"],
  ["rulesync", ".rulesync/hooks.jsonc"],
  ["grok", ".grok/hooks/orchestrate-parent.json"],
  ["grok", ".grok/hooks/rtk.json"],
];
const ROOT_SCRIPTS = [...OWNED_NEEDLES, MAP_NEEDLE, WORKTREE_NEEDLE, ...AUTORUN_NEEDLES, "orchestrate-parent.js", "rtk-grok.js"];

function allCommands(value, out = []) {
  if (Array.isArray(value)) for (const v of value) allCommands(v, out);
  else if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "command" && typeof v === "string") out.push(v);
      else allCommands(v, out);
    }
  }
  return out;
}

function isRootCmd(command) {
  if (!command.startsWith(ROOT_PREFIX)) return false;
  const rel = command.slice(ROOT_PREFIX.length).split('"')[0];
  const exact = rootCmd(rel);
  return command === exact || command.startsWith(`${exact} `);
}

function staleCommands(root) {
  const failures = [];
  for (const [id, rel] of COMMAND_FILES) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    const data = JSON.parse(stripJsonc(fs.readFileSync(p, "utf8")));
    for (const command of allCommands(data)) {
      const script = ROOT_SCRIPTS.find((n) => command.includes(n));
      if (script && !isRootCmd(command)) {
        failures.push(`${id}: ${script} hook command does not find its script from the repo root: run repo upgrade`);
      }
    }
  }
  return failures;
}

export function checkUnion(opts = {}) {
  const root = resolveRoot(opts);
  const failures = [];
  const autorun = presentAutorun(root);
  const worktree = hasOwnedScript(root, WORKTREE_NEEDLE) ? [WORKTREE_NEEDLE] : [];
  const files = [
    {
      id: "claude",
      path: ".claude/settings.json",
      needles: [...OWNED_NEEDLES, ...mapNeedles(root), ...worktree, ...autorun, ...loadConsumerDeny(root)],
    },
    {
      id: "codex",
      path: ".codex/hooks.json",
      needles: [...OWNED_NEEDLES, ...mapNeedles(root), ...autorun],
    },
    {
      id: "agents",
      path: ".agents/hooks.json",
      needles: [...OWNED_NEEDLES, ...autorun],
    },
    {
      id: "cursor",
      path: ".cursor/hooks.json",
      needles: [...OWNED_NEEDLES, ...autorun],
    },
  ];
  failures.push(...staleCommands(root));
  for (const spec of files) {
    const p = path.join(root, spec.path);
    if (!fs.existsSync(p)) {
      failures.push(`${spec.id}: missing ${spec.path}`);
      continue;
    }
    const text = fs.readFileSync(p, "utf8");
    for (const n of spec.needles) {
      if (!text.includes(n)) failures.push(`${spec.id}: missing ${n}`);
    }
  }
  const gitDir = path.join(root, "scripts/git-hooks");
  if (fs.existsSync(gitDir)) {
    for (const rel of GIT_HOOKS) {
      if (!fs.existsSync(path.join(root, rel))) failures.push(`git-hook missing: ${rel}`);
    }
  }
  return failures;
}

function main() {
  try {
    const parsed = parseArgv(process.argv.slice(2));
    if (!parsed.ok) {
      process.stderr.write((parsed.error || "invalid argv") + "\n");
      return 1;
    }
    if (!parsed.check) {
      applyUnion({ workspaceRoot: process.cwd() });
      process.stdout.write("hooks-union: applied\n");
    }
    const failures = checkUnion({ workspaceRoot: process.cwd() });
    if (failures.length) {
      for (const f of failures) process.stderr.write(`hooks-union FAIL ${f}\n`);
      return 1;
    }
    process.stdout.write("hooks-union: check ok\n");
    return 0;
  } catch (err) {
    process.stderr.write(String(err && err.message ? err.message : err) + "\n");
    return 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  process.exit(main());
}
