#!/usr/bin/env bun
/**
 * Machine-local live agent board. One JSON file per session under ~/.workerstack/board/.
 * A read prints lines whose host process is still alive and deletes the rest.
 * Fail-open: a probe or IO error skips the write and prints nothing.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { HookInput } from "./hook-input.ts";
import { isRecord } from "./hook-input.ts";

const WORK_CAP = 80;
const MAX_WALK = 4;
/** One live-session row as stored on disk. */
export interface BoardRow {
  time: string;
  provider: string;
  model: string;
  effort: string;
  session: string;
  cwd: string;
  work: string;
  sticky?: boolean;
  pid: number;
  start: string;
  boot: string;
}

/** What a probe learns about one process. */
export interface ProcessInfo {
  pid: number;
  start: string | undefined;
  comm: string;
  ppid: number;
}

export type Probe = (pid: number) => ProcessInfo | null;

export interface ProbeDeps {
  platform?: NodeJS.Platform;
  readFile?: (file: string, encoding: "utf8") => string | Buffer;
  spawn?: (
    cmd: string,
    args: string[],
    opts: { encoding: "utf8" },
  ) => { status: number | null; stdout?: string | Buffer | null } | null | undefined;
}

export interface ProcStat {
  comm: string;
  state: string;
  ppid: number;
  start: string;
}

export interface HostIdentity {
  pid: number;
  start: string;
}

export interface NoteOptions {
  session?: unknown;
  pid?: unknown;
  start?: unknown;
  home?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  provider?: unknown;
  model?: unknown;
  effort?: unknown;
  cwd?: unknown;
  work?: unknown;
  forceWork?: boolean | undefined;
  boot?: string | undefined;
  now?: Date | string | number | undefined;
  probe?: Probe | undefined;
}

export interface DigestOptions {
  home?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  boot?: string | undefined;
  probe?: Probe | undefined;
  provider?: unknown;
  session?: unknown;
  cap?: number | undefined;
}

/** Hook payload plus the effort level some harnesses send. */
export type BoardInput = HookInput & { effort?: unknown };

export interface RecordDeps {
  identity?: HostIdentity | null;
  probe?: Probe | undefined;
  boot?: string | undefined;
  now?: Date | string | number;
}

const SHELLS = new Set(["sh", "bash", "dash", "zsh", "ash", "busybox", "cmd", "powershell", "pwsh"]);

function field(value: unknown): string {
  const s = String(value ?? "")
    .replace(/\s+/g, "-")
    .trim();
  return s || "-";
}

function oneLine(value: unknown, cap?: number): string {
  const s = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const cut = cap ? s.slice(0, cap).trim() : s;
  return cut || "-";
}

// Harness-injected blocks use hyphenated or underscored tags; the typed slash command is the only one kept.
const STRIP_BLOCKS = [
  /<\/?(?:command-name|command-args)>/g,
  /<([a-z]+(?:[-_][a-z]+)+)\b(?:[^>]*>[\s\S]*?(?:<\/\1[^>]*>|$)|[^>]*$)/g,
  /\[Image #\d+\]/g,
  /\[Pasted text #\d+[^\]]*\]/g,
];
const SECRET_AFTER_KEY = [
  /\b(password|passwd|bearer)(\s*[:=]\s*|\s+)\S+/gi,
  /\b(pwd|token|secret|api[-_]?key|apikey)(\s*[:=]\s*)\S+/gi,
];
const SECRET_PREFIX = /\b(?:sk-|ghp_|gho_|github_pat_|xox[abpr]-|AKIA|AIza|glpat-)[A-Za-z0-9_-]{16,}/g;

function isOpaqueToken(token: string): boolean {
  return token.length >= 24 && !/[/.-]/.test(token) && /[A-Z]/.test(token) && /[a-z]/.test(token) && /\d/.test(token);
}

/** The user's own words from a prompt or label: pasted blocks stripped, secrets redacted, capped. "" when nothing is left. */
export function workLabel(text: unknown): string {
  let s = String(text ?? "");
  for (const re of STRIP_BLOCKS) s = s.replace(re, " ");
  for (const re of SECRET_AFTER_KEY)
    s = s.replace(re, (_: string, key: string, sep: string) => `${key}${sep}[redacted]`);
  s = s.replace(SECRET_PREFIX, "[redacted]");
  s = s
    .split(/\s+/)
    .map((token) => (isOpaqueToken(token) ? "[redacted]" : token))
    .join(" ");
  return s.replace(/\s+/g, " ").trim().slice(0, WORK_CAP).trim();
}

function commBase(comm: unknown): string {
  const base =
    String(comm || "")
      .split(/[/\\]/)
      .pop() || "";
  return base.replace(/\.exe$/i, "").toLowerCase();
}

function safe(value: unknown): string {
  return field(value).replace(/[^\w.@+-]/g, "_") || "-";
}

export function formatLine(row: Partial<Record<keyof BoardRow, unknown>>): string {
  return [
    field(row.time),
    field(row.provider),
    field(row.model),
    field(row.effort),
    field(row.session),
    oneLine(row.cwd),
    workLabel(row.work) || "-",
  ].join(" ");
}

export function boardHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.REPO_BOARD_HOME || os.homedir();
}

export function boardDir(home: string): string {
  return path.join(home, ".workerstack", "board");
}

function rowPath(dir: string, provider: unknown, session: unknown): string {
  return path.join(dir, `${safe(provider)}-${safe(session)}.json`);
}

function readRow(file: string): BoardRow | null {
  try {
    const row: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isRecord(row)) return null;
    // Fields are re-checked where used (String(...) coercions); a missing one reads as its empty value.
    return {
      time: String(row.time ?? ""),
      provider: String(row.provider ?? ""),
      model: String(row.model ?? ""),
      effort: String(row.effort ?? ""),
      session: String(row.session ?? ""),
      cwd: String(row.cwd ?? ""),
      work: String(row.work ?? ""),
      sticky: row.sticky === true,
      pid: row.pid == null ? NaN : Number(row.pid),
      start: row.start == null ? "" : String(row.start),
      boot: row.boot == null ? "" : String(row.boot),
    };
  } catch {
    return null;
  }
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Windows cannot always chmod a directory.
  }
}

function atomicWrite(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows cannot always chmod a file.
  }
}

export function readBootId({ readFile = fs.readFileSync, platform = process.platform }: ProbeDeps = {}): string {
  if (platform !== "linux") return "-";
  try {
    return String(readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim() || "-";
  } catch {
    return "-";
  }
}

/** Linux /proc/pid/stat. Field 22 is starttime. comm sits between the first "(" and the last ")". */
export function parseProcStat(text: unknown): ProcStat | null {
  const s = String(text ?? "");
  const end = s.lastIndexOf(")");
  const open = s.indexOf("(");
  if (open < 0 || end < open) return null;
  const comm = s.slice(open + 1, end);
  const rest = s
    .slice(end + 1)
    .trim()
    .split(/\s+/);
  if (rest.length < 20) return null;
  const ppid = Number(rest[1]);
  const start = rest[19];
  if (!start || !Number.isFinite(ppid)) return null;
  // rest.length >= 20 above, so rest[0] exists.
  return { comm, state: rest[0]!, ppid, start };
}

export function probeProcess(pid: unknown, deps: ProbeDeps = {}): ProcessInfo | null {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 1) return null;
  const platform = deps.platform || process.platform;
  const readFile = deps.readFile || fs.readFileSync;
  const spawn: NonNullable<ProbeDeps["spawn"]> = deps.spawn || spawnSync;
  if (platform === "linux") {
    try {
      const parsed = parseProcStat(readFile(`/proc/${n}/stat`, "utf8"));
      if (!parsed || parsed.state === "Z") return null;
      return { pid: n, start: parsed.start, comm: parsed.comm, ppid: parsed.ppid };
    } catch {
      return null;
    }
  }
  if (platform === "darwin") {
    const r = spawn("ps", ["-o", "ppid=,lstart=,comm=", "-p", String(n)], { encoding: "utf8" });
    if (!r || r.status !== 0) return null;
    const line = String(r.stdout || "").trim();
    const m = line.match(/^(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s*$/);
    if (!m) return null;
    // The regex has three capture groups, all present on a match.
    return { pid: n, start: m[2]!, comm: commBase(m[3]), ppid: Number(m[1]) };
  }
  if (platform === "win32") {
    const script = [
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${n}"`,
      "if (-not $p) { exit 1 }",
      "$p.ParentProcessId",
      "$p.Name",
      "$p.CreationDate.ToUniversalTime().ToString('o')",
    ].join("; ");
    const r = spawn("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" });
    if (!r || r.status !== 0) return null;
    const parts = String(r.stdout || "")
      .trim()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length < 3) return null;
    const ppid = Number(parts[0]);
    const start = parts[2];
    if (!Number.isFinite(ppid) || !start) return null;
    // parts.length >= 3 above, so parts[1] exists.
    return { pid: n, start, comm: parts[1]!, ppid };
  }
  return null;
}

export function hostIdentity({
  pid = process.pid,
  probe = probeProcess,
}: { pid?: number; probe?: Probe | undefined } = {}): HostIdentity | null {
  let current = probe(pid)?.ppid;
  for (let i = 0; i < MAX_WALK && current && current > 1; i++) {
    const info = probe(current);
    if (!info || !(info.pid > 1) || info.start == null || info.start === "") return null;
    const name = commBase(info.comm);
    if (!SHELLS.has(name)) return { pid: info.pid, start: String(info.start) };
    if (!(info.ppid > 1) || info.ppid === current) return null;
    current = info.ppid;
  }
  return null;
}

export function rowAlive(
  row: Partial<Record<keyof BoardRow, unknown>> | null | undefined,
  { boot, probe = probeProcess }: { boot?: string | undefined; probe?: Probe | undefined } = {},
): boolean {
  if (!row || row.pid == null || row.start == null || row.start === "") return false;
  if (String(row.boot ?? "") !== String(boot ?? "")) return false;
  let info: ProcessInfo | null;
  try {
    info = probe(Number(row.pid));
  } catch {
    return false;
  }
  if (!info || info.start == null || info.start === "") return false;
  return String(info.start) === String(row.start);
}

export function sweep(
  { home, boot, probe = probeProcess }: { home: string; boot?: string | undefined; probe?: Probe | undefined } = {
    home: "",
  },
): BoardRow[] {
  const dir = boardDir(home);
  if (!fs.existsSync(dir)) return [];
  const kept: BoardRow[] = [];
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (!name.endsWith(".json")) continue;
    const row = readRow(file);
    if (!row || !rowAlive(row, { boot, probe })) {
      fs.rmSync(file, { force: true });
      continue;
    }
    kept.push(row);
  }
  kept.sort((a, b) => String(a.time).localeCompare(String(b.time)));
  return kept;
}

function nextWork(prev: BoardRow | null, opts: NoteOptions): { work: string; sticky: boolean } {
  const label = workLabel(opts.work);
  if (opts.forceWork) return { work: label || "-", sticky: true };
  if (prev?.sticky && prev.work) return { work: String(prev.work), sticky: true };
  if (label) return { work: label, sticky: false };
  if (prev?.work) return { work: String(prev.work), sticky: false };
  return { work: "active", sticky: false };
}

export function note(opts: NoteOptions = {}): BoardRow | null {
  const session = String(opts.session ?? "").trim();
  if (!session || session === "default") return null;
  if (opts.pid == null || opts.start == null || opts.start === "") return null;
  const home = opts.home ?? boardHome(opts.env);
  const dir = boardDir(home);
  ensureDir(dir);
  const provider = field(opts.provider);
  const file = rowPath(dir, provider, session);
  const prev = readRow(file);
  const chosen = nextWork(prev, opts);
  const row = {
    time:
      opts.now instanceof Date
        ? opts.now.toISOString().replace(/\.\d{3}Z$/, "Z")
        : opts.now
          ? String(opts.now)
          : new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    provider,
    model: opts.model == null || String(opts.model).trim() === "" ? "-" : String(opts.model),
    effort: opts.effort == null || String(opts.effort).trim() === "" ? "-" : String(opts.effort),
    session,
    cwd: oneLine(opts.cwd),
    work: chosen.work,
    sticky: chosen.sticky,
    pid: Number(opts.pid),
    start: String(opts.start),
    boot: String(opts.boot ?? ""),
  };
  atomicWrite(file, `${JSON.stringify(row)}\n`);
  sweep({ home, boot: row.boot, probe: opts.probe });
  if (!fs.existsSync(file)) return null;
  return row;
}

export function lines(opts: DigestOptions = {}): string[] {
  const home = opts.home ?? boardHome(opts.env);
  const boot = opts.boot ?? readBootId();
  return sweep({ home, boot, probe: opts.probe }).map(formatLine);
}

export function digest(opts: DigestOptions = {}): string {
  const home = opts.home ?? boardHome(opts.env);
  const boot = opts.boot ?? readBootId();
  const selfP = field(opts.provider);
  const selfS = field(opts.session);
  return sweep({ home, boot, probe: opts.probe })
    .filter((row) => !(field(row.provider) === selfP && field(row.session) === selfS))
    .sort((a, b) => String(b.time).localeCompare(String(a.time)))
    .slice(0, opts.cap ?? 8)
    .map(formatLine)
    .join("\n");
}

function providerOf(data: BoardInput | null | undefined, env: NodeJS.ProcessEnv): string {
  if (env.REPO_BOARD_PROVIDER) return env.REPO_BOARD_PROVIDER;
  if (env.GROK_WORKSPACE_ROOT || env.GROK_SESSION_ID || env.GROK_HOOK_EVENT) return "grok";
  if (env.CLAUDE_PROJECT_DIR) return "claude";
  if (data && data.model) return "codex";
  return "-";
}

function modelOf(data: BoardInput | null | undefined): string {
  if (!data || data.model == null || String(data.model).trim() === "") return "-";
  return String(data.model);
}

function effortOf(data: BoardInput | null | undefined, env: NodeJS.ProcessEnv): string {
  const level = data && isRecord(data.effort) ? data.effort.level : data?.effort;
  if (level != null && String(level).trim() !== "") return String(level);
  if (env.CLAUDE_EFFORT && String(env.CLAUDE_EFFORT).trim() !== "") return String(env.CLAUDE_EFFORT);
  return "-";
}

function sessionOf(data: BoardInput | null | undefined, env: NodeJS.ProcessEnv): string {
  const value = (data && (data.session_id || data.sessionId)) || env.GROK_SESSION_ID || "";
  return String(value).trim();
}

function cwdOf(data: BoardInput | null | undefined, env: NodeJS.ProcessEnv): string {
  return (
    env.GROK_WORKSPACE_ROOT ||
    (data && (data.workspaceRoot || data.workspace_root || data.cwd)) ||
    env.CLAUDE_PROJECT_DIR ||
    process.cwd()
  );
}

function promptOf(data: BoardInput | null | undefined): string {
  if (!data || typeof data !== "object") return "";
  return String(data.prompt ?? data.userPrompt ?? data.user_prompt ?? "");
}

export function recordHook(
  data: BoardInput | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  deps: RecordDeps = {},
): BoardRow | null {
  try {
    const session = sessionOf(data, env);
    if (!session || session === "default") return null;
    const ident = deps.identity || hostIdentity({ probe: deps.probe || probeProcess });
    if (!ident) return null;
    const boot = deps.boot || readBootId();
    return note({
      home: boardHome(env),
      env,
      provider: providerOf(data, env),
      model: modelOf(data),
      effort: effortOf(data, env),
      session,
      cwd: cwdOf(data, env),
      work: promptOf(data),
      pid: ident.pid,
      start: ident.start,
      boot,
      now: deps.now,
      probe: deps.probe,
    });
  } catch {
    return null;
  }
}

export function otherLines(
  data: BoardInput | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  deps: { boot?: string | undefined; probe?: Probe | undefined } = {},
): string {
  try {
    return digest({
      home: boardHome(env),
      env,
      provider: providerOf(data, env),
      session: sessionOf(data, env),
      boot: deps.boot || readBootId(),
      probe: deps.probe,
    });
  } catch {
    return "";
  }
}

function parseArgs(argv: string[]): { set: boolean; work: string | null; home: string | null } {
  const out: { set: boolean; work: string | null; home: string | null } = { set: false, work: null, home: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!; // i < argv.length
    if (arg === "set") out.set = true;
    else if (arg === "--work") out.work = argv[++i] ?? "";
    else if (arg.startsWith("--work=")) out.work = arg.slice("--work=".length);
    else if (arg === "--home") out.home = argv[++i] ?? "";
    else if (arg.startsWith("--home=")) out.home = arg.slice("--home=".length);
  }
  return out;
}

function main(): number {
  try {
    const args = parseArgs(process.argv.slice(2));
    const env = { ...process.env };
    if (args.home) env.REPO_BOARD_HOME = args.home;
    const home = boardHome(env);
    if (args.set) {
      const ident = hostIdentity();
      if (!ident) return 0;
      const provider = providerOf({}, env);
      const session = env.REPO_BOARD_SESSION || env.GROK_SESSION_ID || env.CLAUDE_SESSION_ID || String(ident.pid);
      note({
        home,
        env,
        provider: provider === "-" ? "antigravity" : provider,
        model: "-",
        effort: env.CLAUDE_EFFORT || "-",
        session,
        cwd: cwdOf({}, env),
        work: args.work ?? "",
        forceWork: true,
        pid: ident.pid,
        start: ident.start,
        boot: readBootId(),
      });
      return 0;
    }
    const printed = lines({ home, env });
    if (printed.length) process.stdout.write(`${printed.join("\n")}\n`);
    return 0;
  } catch {
    return 0;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  process.exit(main());
}
