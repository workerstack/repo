#!/usr/bin/env bun
/**
 * Overlay after `rulesync generate -f hooks`, for what hooks.jsonc cannot express.
 * Union, never replace: rulesync's own groups (scrub, gate, orchestrate-parent, session map)
 * are left as generated.
 *
 * Claude/Codex native event is UserPromptSubmit (mapped from SoT beforeSubmitPrompt).
 * Antigravity has neither beforeSubmitPrompt nor subagentStop.
 * Grok SessionStart stays empty on orchestrate-parent.json.
 * Claude/Codex SessionStart: session-map.ts (folder map) when shipped, first in the group.
 * Antigravity SessionStart is rulesync's flat entries, consumer extras appended flat.
 * Cursor's .cursor/hooks.json is all flat entries; consumer extras are appended flat under its own tool name.
 *
 * Consumer extras (if those scripts exist): SessionStart, check-behind,
 * validate+sim; Antigravity and Cursor get them under their own tool names.
 * Path deny from consumer `.repo/permissions.json`.
 * Claude WorktreeCreate / WorktreeRemove come from hooks.jsonc's claudecode block; --check needs them when worktree.ts ships.
 * Every repo hook command is hookCommand(name): the installed `repo` bin, run as `repo hook <name>`.
 * Every consumer script command is rootCmd(): the script in the project dir, else at its git top level.
 *
 *   bun .rulesync/scripts/hooks-union.ts           apply then check
 *   bun .rulesync/scripts/hooks-union.ts --check   keep-list only
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HOOK_SCRIPTS, hookCommand, hookNameOf, type HookName } from "./hook-command.ts";
import { stripJsonc } from "./jsonc.ts";

/** One hook command entry as this script writes it. */
export interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
}

/** A `{matcher, hooks}` group as this script writes it. */
interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}

/** A flat Antigravity entry: the consumer hook plus the event it joins. */
interface NamedHook {
  event: string;
  matcher?: string;
  command: string;
}

type JsonObject = Record<string, unknown>;

/**
 * `workspaceRoot` is where the hook files are read and written. `sourceRoot` is the stock package whose
 * `.rulesync/scripts/` says which repo hooks ship. `consumerRoot` owns `scripts/` hooks, `scripts/git-hooks`
 * and the path deny (`.repo/permissions.json`).
 * Both default to `workspaceRoot`.
 */
export interface UnionOptions {
  workspaceRoot?: string;
  sourceRoot?: string;
  consumerRoot?: string;
  check?: boolean;
}

/** The three roots one union run reads and writes. */
interface Roots {
  ws: string;
  src: string;
  consumer: string;
}

export interface UnionResult {
  ok: boolean;
  check: boolean;
  error?: string;
  failures?: string[];
}

export type ParsedArgv = { ok: true; check: boolean } | { ok: false; error: string };

export const ROOT_PREFIX = 'd="${GROK_WORKSPACE_ROOT:-${CLAUDE_PROJECT_DIR:-.}}"; [ -e "$d/';

/** Hook command for `rel`: the script in the project dir, else at that dir's git top level, else in the hook cwd. */
export function rootCmd(rel: string, args?: string): string {
  const cmd = `${ROOT_PREFIX}${rel}" ] || d="$(git -C "$d" rev-parse --show-toplevel 2>/dev/null || echo "$d")"; bun "$d/${rel}"`;
  return args ? `${cmd} ${args}` : cmd;
}

export const PULL = rootCmd("scripts/daily-pull-check.mjs");
export const RTK = rootCmd("scripts/rtk-check.mjs");
export const FLEET = rootCmd("scripts/daily-fleet-check.mjs");
export const BEHIND = rootCmd("scripts/check-behind.mjs", "--hook");
export const VALIDATE = rootCmd("scripts/validate.mjs", "--hook");
export const SIM = rootCmd("scripts/sim.mjs", "--hook");
export const MAP = hookCommand("session-map");

export const AUTORUN_NEEDLES = [
  "daily-pull-check.mjs",
  "rtk-check.mjs",
  "daily-fleet-check.mjs",
  "check-behind.mjs",
  "validate.mjs",
  "sim.mjs",
];
export const OWNED_HOOKS: readonly HookName[] = ["scrub-spawn-prompt", "gate-fat-tools"];
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

export function parseArgv(argv: unknown): ParsedArgv {
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

function isPlainObject(v: unknown): v is JsonObject {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function resolveRoots(opts: UnionOptions | string): Roots {
  const given = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
  if (typeof opts === "string") return { ws: opts, src: opts, consumer: opts };
  const ws = given(opts?.workspaceRoot) ?? process.cwd();
  return { ws, src: given(opts?.sourceRoot) ?? ws, consumer: given(opts?.consumerRoot) ?? ws };
}

/** Consumer-owned extras live in the consumer's root `scripts/`. */
function hasScript(root: string, name: string): boolean {
  return fs.existsSync(path.join(root, "scripts", name));
}

/** A repo hook ships while its script is copied into `.rulesync/scripts/`. */
function ships(src: string, name: HookName): boolean {
  return fs.existsSync(path.join(src, ".rulesync", "scripts", HOOK_SCRIPTS[name]));
}

function withoutWritePath(arr: unknown[]): string[] {
  return arr.filter((x): x is string => typeof x === "string" && !x.startsWith("Write("));
}

function loadConsumerDeny({ consumer }: Roots): string[] {
  const data = loadJson(path.join(consumer, ".repo", "permissions.json"));
  return Array.isArray(data.deny) ? withoutWritePath(data.deny) : [];
}

function presentAutorun(root: string): string[] {
  return AUTORUN_NEEDLES.filter((n) => hasScript(root, n));
}

function hookCmd(command: string, timeout?: number): HookEntry {
  const h: HookEntry = { type: "command", command };
  if (timeout != null) h.timeout = timeout;
  return h;
}

function commandsIn(group: unknown): string[] {
  if (!isPlainObject(group)) return [];
  const out: string[] = [];
  if (typeof group.command === "string") out.push(group.command);
  const hooks = Array.isArray(group.hooks) ? group.hooks : [];
  for (const h of hooks) {
    if (isPlainObject(h) && typeof h.command === "string") out.push(h.command);
  }
  return out;
}

/** What makes two groups the same hook: the repo hook name in either command form, else the script file name. */
function needleOf(group: unknown): string {
  for (const c of commandsIn(group)) {
    const name = hookNameOf(c);
    if (name) return `hook:${name}`;
    const m = String(c).match(/([\w.-]+\.(?:ts|mjs|js)\b)/);
    if (m) return m[1]!; // group 1 always participates in a match
  }
  return commandsIn(group)[0] || JSON.stringify(group);
}

function upsertGroups(existing: unknown, desired: unknown[]): unknown[] {
  const prev = Array.isArray(existing) ? existing : [];
  const desiredNeedles = new Set(desired.map(needleOf));
  const extras = prev.filter((g) => !desiredNeedles.has(needleOf(g)));
  return [...desired, ...extras];
}

function uniq<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of arr) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function loadJson(p: string): JsonObject {
  if (!fs.existsSync(p)) return {};
  const raw = fs.readFileSync(p, "utf8");
  if (!String(raw).trim()) return {};
  const v: unknown = JSON.parse(raw);
  return isPlainObject(v) ? v : {};
}

function saveJson(p: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`);
}

function desiredPre(root: string, writeMatcher = "Write|Edit"): HookGroup[] {
  return hasScript(root, "check-behind.mjs") ? [{ matcher: writeMatcher, hooks: [hookCmd(BEHIND)] }] : [];
}

function mapHooks(src: string): HookName[] {
  return ships(src, "session-map") ? ["session-map"] : [];
}

/** `map: false` for Antigravity, where rulesync writes the map entry itself. */
function desiredSession({ src, consumer: root }: Roots, { map = true }: { map?: boolean } = {}): { hooks: HookEntry[] }[] | null {
  const hooks: HookEntry[] = [];
  if (map && ships(src, "session-map")) hooks.push(hookCmd(MAP, 5));
  if (hasScript(root, "daily-pull-check.mjs")) hooks.push(hookCmd(PULL));
  if (hasScript(root, "rtk-check.mjs")) hooks.push(hookCmd(RTK));
  if (hasScript(root, "daily-fleet-check.mjs")) hooks.push(hookCmd(FLEET));
  return hooks.length ? [{ hooks }] : null;
}

function desiredPost(root: string, matcher = POST_WRITE_MATCHER): HookGroup[] | null {
  const hooks: HookEntry[] = [];
  if (hasScript(root, "validate.mjs")) hooks.push(hookCmd(VALIDATE));
  if (hasScript(root, "sim.mjs")) hooks.push(hookCmd(SIM));
  return hooks.length ? [{ matcher, hooks }] : null;
}

function consumerNamed(root: string): Record<string, NamedHook> {
  const named: Record<string, NamedHook> = {};
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

function applyClaude(roots: Roots): void {
  const root = roots.consumer;
  const abs = path.join(roots.ws, ".claude/settings.json");
  const live = loadJson(abs);
  const hooks = isPlainObject(live.hooks) ? { ...live.hooks } : {};
  hooks.PreToolUse = upsertGroups(hooks.PreToolUse, desiredPre(root));
  const session = desiredSession(roots);
  if (session) hooks.SessionStart = session;
  const post = desiredPost(root);
  if (post) hooks.PostToolUse = upsertGroups(hooks.PostToolUse, post);
  const permissions = isPlainObject(live.permissions) ? { ...live.permissions } : {};
  const liveDeny: unknown[] = Array.isArray(permissions.deny) ? permissions.deny : [];
  permissions.deny = uniq([
    ...liveDeny.filter((x: unknown) => typeof x !== "string" || !x.startsWith("Write(")),
    ...loadConsumerDeny(roots),
  ]);
  const next = { ...live, permissions, hooks };
  saveJson(abs, next);
}

function applyCodex(roots: Roots): void {
  const root = roots.consumer;
  const abs = path.join(roots.ws, ".codex/hooks.json");
  const live = loadJson(abs);
  const liveHooks = isPlainObject(live.hooks) ? live.hooks : null;
  const nested = liveHooks !== null;
  const cur: JsonObject = liveHooks ? { ...liveHooks } : { ...live };
  cur.PreToolUse = upsertGroups(cur.PreToolUse, desiredPre(root));
  const session = desiredSession(roots);
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
function flatSession(existing: unknown, extra: HookEntry[]): unknown[] {
  const prev = (Array.isArray(existing) ? existing : []).flatMap((e: unknown): unknown[] =>
    isPlainObject(e) && Array.isArray(e.hooks) ? e.hooks : [e],
  );
  const added = new Set(extra.map((h) => h.command));
  return [...prev.filter((e) => !(isPlainObject(e) && typeof e.command === "string" && added.has(e.command))), ...extra];
}

/** `{matcher, hooks}` groups as the flat `{...hook, matcher}` entries Cursor reads. */
function flatEntries(groups: HookGroup[] | null): (HookEntry & { matcher?: string })[] {
  return (groups || []).flatMap((g) => g.hooks.map((h) => (g.matcher ? { ...h, matcher: g.matcher } : h)));
}

function applyCursor(roots: Roots): void {
  const root = roots.consumer;
  const abs = path.join(roots.ws, ".cursor/hooks.json");
  const live = loadJson(abs);
  const hooks = isPlainObject(live.hooks) ? { ...live.hooks } : {};
  hooks.preToolUse = upsertGroups(hooks.preToolUse, flatEntries(desiredPre(root, CURSOR_WRITE_MATCHER)));
  const session = desiredSession(roots, { map: false });
  if (session) hooks.sessionStart = flatSession(hooks.sessionStart, session[0]!.hooks) // desiredSession yields one group or null;
  const post = desiredPost(root, CURSOR_WRITE_MATCHER);
  if (post) hooks.postToolUse = upsertGroups(hooks.postToolUse, flatEntries(post));
  saveJson(abs, { version: 1, ...live, hooks });
}

function applyAgents(roots: Roots): void {
  const root = roots.consumer;
  const abs = path.join(roots.ws, ".agents/hooks.json");
  const live = loadJson(abs);
  const rulesync = isPlainObject(live.rulesync) ? { ...live.rulesync } : {};
  rulesync.PreToolUse = upsertGroups(rulesync.PreToolUse, desiredPre(root, AGY_WRITE_MATCHER));
  const session = desiredSession(roots, { map: false });
  if (session) rulesync.SessionStart = flatSession(rulesync.SessionStart, session[0]!.hooks) // desiredSession yields one group or null;
  const post = desiredPost(root, AGY_WRITE_MATCHER);
  if (post) rulesync.PostToolUse = post;
  saveJson(abs, { ...live, ...consumerNamed(root), rulesync });
}

export function applyUnion(opts: UnionOptions | string = {}): UnionResult {
  const roots = resolveRoots(opts);
  const check = typeof opts === "object" && opts && opts.check === true;
  if (check) {
    const failures = checkUnion({ workspaceRoot: roots.ws, sourceRoot: roots.src, consumerRoot: roots.consumer });
    if (failures.length) {
      return { ok: false, check: true, error: `drift: ${failures.join("; ")}`, failures };
    }
    return { ok: true, check: true, failures: [] };
  }
  applyClaude(roots);
  applyCodex(roots);
  applyAgents(roots);
  applyCursor(roots);
  return { ok: true, check: false };
}

/** Hook files whose repo commands must be `hookCommand` and whose autorun commands must be `rootCmd` strings. */
const COMMAND_FILES: [string, string][] = [
  ["claude", ".claude/settings.json"],
  ["codex", ".codex/hooks.json"],
  ["agents", ".agents/hooks.json"],
  ["cursor", ".cursor/hooks.json"],
  ["rulesync", ".rulesync/hooks.jsonc"],
  ["grok", ".grok/hooks/orchestrate-parent.json"],
  ["grok", ".grok/hooks/rtk.json"],
];

function allCommands(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) allCommands(v, out);
  else if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "command" && typeof v === "string") out.push(v);
      else allCommands(v, out);
    }
  }
  return out;
}

function isRootCmd(command: string): boolean {
  if (!command.startsWith(ROOT_PREFIX)) return false;
  const rel = command.slice(ROOT_PREFIX.length).split('"')[0]!; // split always yields one element
  const exact = rootCmd(rel);
  return command === exact || command.startsWith(`${exact} `);
}

function staleCommands(root: string): string[] {
  const failures: string[] = [];
  for (const [id, rel] of COMMAND_FILES) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    const data: unknown = JSON.parse(stripJsonc(fs.readFileSync(p, "utf8")));
    for (const command of allCommands(data)) {
      const hook = hookNameOf(command);
      if (hook) {
        if (command !== hookCommand(hook)) {
          failures.push(`${id}: ${hook} hook command does not run "$d/node_modules/.bin/repo" hook ${hook}: run bun repo sync`);
        }
        continue;
      }
      const script = AUTORUN_NEEDLES.find((n) => command.includes(n));
      if (script && !isRootCmd(command)) {
        failures.push(`${id}: ${script} hook command does not find its script from the repo root: run bun repo sync`);
      }
    }
  }
  return failures;
}

export function checkUnion(opts: UnionOptions | string = {}): string[] {
  const roots = resolveRoots(opts);
  const root = roots.ws;
  const failures: string[] = [];
  const autorun = presentAutorun(roots.consumer);
  const worktree: HookName[] = ships(roots.src, "worktree") ? ["worktree"] : [];
  const files = [
    {
      id: "claude",
      path: ".claude/settings.json",
      hooks: [...OWNED_HOOKS, ...mapHooks(roots.src), ...worktree],
      needles: [...autorun, ...loadConsumerDeny(roots)],
    },
    {
      id: "codex",
      path: ".codex/hooks.json",
      hooks: [...OWNED_HOOKS, ...mapHooks(roots.src)],
      needles: autorun,
    },
    {
      id: "agents",
      path: ".agents/hooks.json",
      hooks: OWNED_HOOKS,
      needles: autorun,
    },
    {
      id: "cursor",
      path: ".cursor/hooks.json",
      hooks: OWNED_HOOKS,
      needles: autorun,
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
    const present = new Set(allCommands(JSON.parse(text)).map(hookNameOf));
    for (const h of spec.hooks) {
      if (!present.has(h)) failures.push(`${spec.id}: missing ${h}`);
    }
    for (const n of spec.needles) {
      if (!text.includes(n)) failures.push(`${spec.id}: missing ${n}`);
    }
  }
  const gitDir = path.join(roots.consumer, "scripts/git-hooks");
  if (fs.existsSync(gitDir)) {
    for (const rel of GIT_HOOKS) {
      if (!fs.existsSync(path.join(roots.consumer, rel))) failures.push(`git-hook missing: ${rel}`);
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
    process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
    return 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  process.exit(main());
}
