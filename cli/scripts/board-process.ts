/** Is a board row's process still alive: the boot id, a per-platform process probe, and the host-process walk. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { orNone, str } from "./board-line.ts";
import {
  BOOT_ID_FILE,
  DARWIN,
  DIR_PREFIX_RE,
  EXE_RE,
  LINE_BREAK_RE,
  LINUX,
  MAX_WALK,
  NONE,
  PS_LINE_RE,
  SHELLS,
  SPACE_SPLIT_RE,
  STAT_FIELDS,
  STAT_START,
  WIN32,
  WIN_FIELDS,
  ZOMBIE,
} from "./board.constants.ts";
import type { HostIdentity, LooseRow, Probe, ProbeDeps, ProcessInfo, ProcStat } from "./board.types.ts";
import { jsonText } from "./json-text.ts";

/** The probe deps with the spawn default filled in. */
type Deps = ProbeDeps & { spawn: NonNullable<ProbeDeps["spawn"]> };

/** One platform's probe of a pid already known to be an integer above 1. */
type PlatformProbe = (n: number, deps: Deps) => ProcessInfo | null;

export function readBootId({ readFile = fs.readFileSync, platform = process.platform }: ProbeDeps = {}): string {
  if (platform !== LINUX) return NONE;

  try {
    return orNone(String(readFile(BOOT_ID_FILE, "utf8")).trim());
  } catch {
    return NONE;
  }
}

/** `boot`, or this machine's boot id when it is missing or empty. */
export function bootOr(boot: string | undefined): string {
  return boot === undefined || boot === "" ? readBootId() : boot;
}

/** A process name without its dir or `.exe`, lowercased. */
function commBase(comm: string): string {
  return comm.replace(DIR_PREFIX_RE, "").replace(EXE_RE, "").toLowerCase();
}

/** Linux /proc/pid/stat. Field 22 is starttime. comm sits between the first "(" and the last ")". */
export function parseProcStat(text: string | Buffer): ProcStat | null {
  const s = String(text);
  const end = s.lastIndexOf(")");
  const open = s.indexOf("(");

  if (open < 0 || end < open) return null;
  const comm = s.slice(open + 1, end);

  const rest = s
    .slice(end + 1)
    .trim()
    .split(SPACE_SPLIT_RE);

  if (rest.length < STAT_FIELDS) return null;
  const [state, ppidText] = rest /* STAT_FIELDS fields at least, checked above */ as [string, string];
  const ppid = Number(ppidText);

  if (!Number.isFinite(ppid)) return null;

  return { comm, ppid, start: rest[STAT_START] /* STAT_FIELDS fields at least */ as string, state };
}

function linuxProbe(n: number, deps: Deps): ProcessInfo | null {
  const readFile = deps.readFile ?? fs.readFileSync;

  try {
    const parsed = parseProcStat(readFile(`/proc/${n}/stat`, "utf8"));

    if (parsed === null || parsed.state === ZOMBIE) return null;

    return { comm: parsed.comm, pid: n, ppid: parsed.ppid, start: parsed.start };
  } catch {
    return null;
  }
}

/** The stdout of `cmd`, or null when it fails. */
function spawnOut(deps: Deps, cmd: string, args: string[]): string | null {
  const r = deps.spawn(cmd, args, { encoding: "utf8" });

  return r?.status === 0 ? String(r.stdout ?? "") : null;
}

function darwinProbe(n: number, deps: Deps): ProcessInfo | null {
  const out = spawnOut(deps, "ps", ["-o", "ppid=,lstart=,comm=", "-p", String(n)]);
  const m = out === null ? null : PS_LINE_RE.exec(out.trim());

  if (m === null) return null;
  const [, ppid, start, comm] = [...m] /* three groups, all present on a match */ as [string, string, string, string];

  return { comm: commBase(comm), pid: n, ppid: Number(ppid), start };
}

function win32Probe(n: number, deps: Deps): ProcessInfo | null {
  const script = [
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${n}"`,
    "if (-not $p) { exit 1 }",
    "$p.ParentProcessId",
    "$p.Name",
    "$p.CreationDate.ToUniversalTime().ToString('o')",
  ].join("; ");

  const out = spawnOut(deps, "powershell.exe", ["-NoProfile", "-Command", script]);

  if (out === null) return null;

  const parts = out
    .trim()
    .split(LINE_BREAK_RE)
    .map((s) => s.trim())
    .filter((s) => s !== "");

  if (parts.length < WIN_FIELDS) return null;
  const [ppidText, comm, start] = parts /* WIN_FIELDS lines at least, checked above */ as [string, string, string];
  const ppid = Number(ppidText);

  return Number.isFinite(ppid) ? { comm, pid: n, ppid, start } : null;
}

function platformProbe(platform: string): PlatformProbe | null {
  if (platform === LINUX) return linuxProbe;

  if (platform === DARWIN) return darwinProbe;

  return platform === WIN32 ? win32Probe : null;
}

export function probeProcess(pid: number, deps: ProbeDeps = {}): ProcessInfo | null {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  const probe = platformProbe(deps.platform ?? process.platform);
  const spawn: Deps["spawn"] = deps.spawn ?? spawnSync;

  return probe === null ? null : probe(pid, { ...deps, spawn });
}

/** The host when `info` is not a shell, the parent to walk to when it is, or null when the walk must stop. */
function walkStep(info: ProcessInfo | null, current: number): HostIdentity | number | null {
  if (info == null || !(info.pid > 1) || info.start == null || info.start === "") return null;

  if (!SHELLS.has(commBase(info.comm))) return { pid: info.pid, start: info.start };

  return !(info.ppid > 1) || info.ppid === current ? null : info.ppid;
}

export function hostIdentity({
  pid = process.pid,
  probe = probeProcess,
}: { pid?: number; probe?: Probe | undefined } = {}): HostIdentity | null {
  let current = probe(pid)?.ppid;

  for (let i = 0; i < MAX_WALK && current !== undefined && current > 1; i++) {
    const step = walkStep(probe(current), current);

    if (typeof step !== "number") return step;
    current = step;
  }

  return null;
}

function hasIdentity(row: LooseRow | null | undefined): row is LooseRow {
  return row != null && row.pid != null && row.start != null && row.start !== "";
}

export function rowAlive(
  row: LooseRow | null | undefined,
  { boot, probe = probeProcess }: { boot?: string | undefined; probe?: Probe | undefined } = {},
): boolean {
  if (!hasIdentity(row) || str(row.boot) !== str(boot)) return false;
  let info: ProcessInfo | null;

  try {
    info = probe(Number(row.pid));
  } catch {
    return false;
  }

  if (info == null || info.start == null || info.start === "") return false;

  return info.start === jsonText(row.start);
}
