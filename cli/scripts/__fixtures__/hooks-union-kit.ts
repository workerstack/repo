// Shared setup for the hooks-union suites: typed hook files, a repo's generated hook files and consumer scripts.
import fs from "node:fs";
import path from "node:path";
import { expandHookCommand, hookCommand } from "../hook-command.ts";
import { AUTORUN_NEEDLES } from "../hooks-union.constants.ts";
import { stripJsonc } from "../strip-jsonc.ts";

export const REPO_ROOT: string = path.resolve(import.meta.dirname, "..", "..", "..");
export const SCRUB = "scrub-spawn-prompt";
export const GATE = "gate-fat-tools";
export const PARENT = "orchestrate-parent";
export const MCP_DENY = "mcp__*";
export const EDIT_PLATFORM = "Edit(platform/**)";
export const WRITE_PLATFORM = "Write(platform/**)";

export interface HookCommand {
  type?: string;
  command: string;
  timeout?: number;
}
export interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
}
/** A flat entry (Cursor, Antigravity SessionStart): the hook fields at the top, no `hooks` array. */
export interface FlatEntry {
  type: string;
  command: string;
  timeout?: number;
  matcher?: string;
  hooks?: undefined;
}
export interface ClaudeDoc {
  permissions: { deny: string[] };
  hooks: {
    PreToolUse: HookGroup[];
    PostToolUse?: HookGroup[];
    UserPromptSubmit?: HookGroup[];
    Stop?: HookGroup[];
    SessionStart?: HookGroup[];
    beforeSubmitPrompt?: HookGroup[];
    WorktreeCreate?: HookGroup[];
    WorktreeRemove?: HookGroup[];
  };
}
export interface AgentsDoc {
  rulesync: {
    PreToolUse: HookGroup[];
    PostToolUse: HookGroup[];
    Stop?: HookGroup[];
    stop?: HookGroup[];
    SessionStart: FlatEntry[];
  };
  "check-behind": HookGroup;
  "validate-artifact": HookGroup;
  "simulate-artifact": HookGroup;
}
export interface CursorDoc {
  version: number;
  hooks: { sessionStart: FlatEntry[]; preToolUse: FlatEntry[]; postToolUse: FlatEntry[]; stop: unknown };
}
export interface GrokDoc {
  hooks: { SessionStart?: unknown };
}
export interface SsotFile {
  hooks: Record<string, { matcher?: string; command: string; timeout?: number }[]>;
  claudecode: { hooks: unknown };
}

const SCRUB_MATCHER = "spawn_subagent|Task|Agent|spawn_agent";
const GATE_MATCHER = "Read|read_file|Grep|grep|Glob|list_dir|Bash|run_terminal_command|Write|Edit|write|search_replace";
const SCRUB_ENTRY: HookCommand = { type: "command", command: /* @__PURE__ */ hookCommand(SCRUB), timeout: 5 };
const GATE_ENTRY: HookCommand = { type: "command", command: /* @__PURE__ */ hookCommand(GATE), timeout: 5 };
const PARENT_ENTRY: HookCommand = { type: "command", command: /* @__PURE__ */ hookCommand(PARENT), timeout: 5 };
const PARENT_STOP: HookCommand = { ...PARENT_ENTRY, timeout: 30 };

/** The scrub and gate PreToolUse groups rulesync writes. */
export const ownedPre: HookGroup[] = [
  { matcher: SCRUB_MATCHER, hooks: [SCRUB_ENTRY] },
  { matcher: GATE_MATCHER, hooks: [GATE_ENTRY] },
];
/** `ownedPre` as Cursor's flat entries. */
export const ownedFlat: FlatEntry[] = [
  { ...SCRUB_ENTRY, type: "command", matcher: SCRUB_MATCHER },
  { ...GATE_ENTRY, type: "command", matcher: GATE_MATCHER },
];
const parentHook: HookGroup = { hooks: [PARENT_ENTRY] };
const parentStop: HookGroup = { hooks: [PARENT_STOP] };

/** The value, or a throw when a test's lookup found nothing. */
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

export function writeJson(ws: string, rel: string, obj: unknown): void {
  const abs = path.join(ws, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(obj, null, 2)}\n`);
}

/** Reads a JSON file the test just wrote or the repo ships; the caller names the shape it expects. */
export function readJson<T = unknown>(ws: string, rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(ws, rel), "utf8")) /* the caller names the shape the file holds */ as T;
}

/** A stock source as sync reads it: each `repo hook <name>` command expanded to the command a host runs. */
export function expandSource(text: string): string {
  return text.replace(/("command":\s*)("repo hook [\w-]+")/g, (_, key: string, value: string) => {
    const short: unknown = JSON.parse(value);
    return key + JSON.stringify(expandHookCommand(String(short)));
  });
}

export function ssotOf(text: string): SsotFile {
  return JSON.parse(stripJsonc(expandSource(text))) /* hooks.jsonc holds this shape */ as SsotFile;
}

/** The repo's `agents/hooks.jsonc` as sync reads it. */
export const repoSsot = (): SsotFile => ssotOf(fs.readFileSync(path.join(REPO_ROOT, "agents/hooks.jsonc"), "utf8"));

function seedHostFiles(ws: string): void {
  const stops = { Stop: [parentStop], SubagentStop: [parentStop] };
  writeJson(ws, ".claude/settings.json", {
    permissions: { deny: ["Agent(Explore)", "Agent(Plan)", MCP_DENY] },
    hooks: { PreToolUse: ownedPre, UserPromptSubmit: [parentHook], ...stops },
    enableAllProjectMcpServers: false,
    enabledMcpjsonServers: [],
  });
  writeJson(ws, ".codex/hooks.json", { hooks: { PreToolUse: ownedPre, UserPromptSubmit: [parentHook], ...stops } });
  writeJson(ws, ".agents/hooks.json", { rulesync: { PreToolUse: ownedPre, Stop: [parentStop] } });
  writeJson(ws, ".cursor/hooks.json", {
    version: 1,
    hooks: { preToolUse: ownedFlat, beforeSubmitPrompt: [{ ...PARENT_ENTRY }], stop: [PARENT_STOP] },
  });
}

/** The hook files rulesync writes for a repo with scrub, gate and orchestrate-parent, and the source they come from. */
export function seedOwnedDrivers(ws: string): void {
  seedHostFiles(ws);
  writeJson(ws, "agents/hooks.jsonc", {
    version: 1,
    hooks: {
      preToolUse: [{ matcher: SCRUB_MATCHER, ...SCRUB_ENTRY }],
      beforeSubmitPrompt: [PARENT_ENTRY],
      stop: [PARENT_STOP],
    },
  });
  const node = { hooks: [{ type: "command", command: "node parent", timeout: 5 }] };
  writeJson(ws, ".grok/hooks/orchestrate-parent.json", { hooks: { PreToolUse: [node], UserPromptSubmit: [node] } });
}

/** An empty copy of every consumer autorun script under `<ws>/scripts`. */
export function touchConsumerScripts(ws: string): void {
  fs.mkdirSync(path.join(ws, "scripts"), { recursive: true });
  for (const n of AUTORUN_NEEDLES) fs.writeFileSync(path.join(ws, "scripts", n), "");
}

/** An empty `cli/scripts/<file>` under `root`, so the union treats that repo hook as shipped. */
export function shipStub(root: string, file: string): void {
  fs.mkdirSync(path.join(root, "cli", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "cli", "scripts", file), "");
}
