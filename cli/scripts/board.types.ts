/** The live agent board's rows, probes and option shapes. */
import type { Env } from "../repo-env.ts";
import type { HookInput } from "./hook-input.ts";

/** One live-session row as stored on disk. */
export type BoardRow = {
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
};

/** A row as a caller hands it in: any field may be missing or of any type. */
export type LooseRow = Partial<Record<keyof BoardRow, unknown>>;

/** What a probe learns about one process. */
export type ProcessInfo = {
  pid: number;
  start: string | undefined;
  comm: string;
  ppid: number;
};

export type Probe = (pid: number) => ProcessInfo | null;

export type ProbeDeps = {
  platform?: NodeJS.Platform;
  readFile?: (file: string, encoding: "utf8") => string | Buffer;
  spawn?: (
    cmd: string,
    args: string[],
    opts: { encoding: "utf8" },
  ) => { status: number | null; stdout?: string | Buffer | null } | null | undefined;
};

export type ProcStat = {
  comm: string;
  state: string;
  ppid: number;
  start: string;
};

export type HostIdentity = {
  pid: number;
  start: string;
};

export type NoteOptions = {
  session?: unknown;
  pid?: unknown;
  start?: unknown;
  home?: string | undefined;
  env?: Env | undefined;
  provider?: unknown;
  model?: unknown;
  effort?: unknown;
  cwd?: unknown;
  work?: unknown;
  forceWork?: boolean | undefined;
  boot?: string | undefined;
  now?: Date | string | number | undefined;
  probe?: Probe | undefined;
};

export type DigestOptions = {
  home?: string | undefined;
  env?: Env | undefined;
  boot?: string | undefined;
  probe?: Probe | undefined;
  provider?: unknown;
  session?: unknown;
  cap?: number | undefined;
};

/** Hook payload plus the effort level some harnesses send. */
export type BoardInput = HookInput & { effort?: unknown };

export type RecordDeps = {
  identity?: HostIdentity | null;
  probe?: Probe | undefined;
  boot?: string | undefined;
  now?: Date | string | number;
};

/** Where a sweep reads rows and how it tells a live one. */
export type SweepOptions = {
  home: string;
  boot?: string | undefined;
  probe?: Probe | undefined;
};
