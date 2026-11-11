import type { Env } from "../env.ts";

export interface ListenCfg {
  filePath: string;
  apiKey: string;
  model: string;
  device: string;
  seconds: number;
  ffmpegFormat: string;
  whisperModel: string;
  stt: string;
}

export type Stt = { kind: "local"; bin: string; model: string } | { kind: "openai"; model: string };

export type WhichFn = (name: string, pathEnv?: string, platform?: NodeJS.Platform) => string;

/** The slice of a fetch Response this script reads. */
export interface FetchResult {
  ok?: boolean;
  status?: number;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
  arrayBuffer?: () => Promise<ArrayBuffer | Uint8Array>;
}

/** The fetch this script calls, with the slice of its init it passes. */
export type FetchFn = (
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: FormData;
    redirect?: "follow" | "manual" | "error";
  },
) => Promise<FetchResult>;

export interface SpawnSyncResult {
  status: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
}

export type SpawnSyncFn = (
  bin: string,
  args: string[],
  opts: { encoding?: "utf8"; input?: string; shell?: boolean; timeout?: number },
) => SpawnSyncResult;

/** The slice of a ChildProcess this script uses; tests pass partial fakes. */
export interface ChildLike {
  pid?: number | undefined;
  stdin?: { write(chunk: string): unknown; end(): unknown } | null;
  kill?(signal?: NodeJS.Signals): unknown;
  on?(event: string, cb: (arg: unknown, signal?: unknown) => void): unknown;
  unref?(): void;
}

export interface SpawnOpts {
  detached?: boolean;
  stdio?: unknown[];
  cwd?: string | undefined;
  env?: Env;
  windowsHide?: boolean;
}

export type SpawnFn = (bin: string, args: string[], opts: SpawnOpts) => ChildLike;

export type KillFn = (pid: number, signal: string | number) => unknown;

export interface ListenLog {
  log(msg: string): void;
  error(msg: string): void;
}

export interface SttOpts {
  cfg: ListenCfg;
  whichFn: WhichFn;
  pathEnv: string | undefined;
  platform: NodeJS.Platform;
  home: string;
  cwd: string;
  fetchFn?: FetchFn | undefined;
  log?: ListenLog | undefined;
}

export interface AudioDevice {
  id: string;
  name: string;
}

export interface CaptureResult {
  status: number | null;
  signal: string | null;
  stderr: string;
  error: unknown;
}

export interface ListenMainOpts {
  env?: Env;
  home?: string | undefined;
  cwd?: string | undefined;
  platform?: NodeJS.Platform;
  fetchFn?: FetchFn | undefined;
  spawnFn?: SpawnFn;
  spawnSyncFn?: SpawnSyncFn;
  killFn?: KillFn;
  whichFn?: WhichFn;
  log?: ListenLog | undefined;
  pathEnv?: string;
  nodeBin?: string;
  waitPid?: (pid: number, killFn: KillFn) => void;
}

/** What one `repo listen` verb runs in: the parsed argv, the seams and the config, resolved once by `main`. */
export interface ListenCtx {
  rest: string[];
  flags: Record<string, string>;
  env: Env;
  home: string;
  cwd: string;
  platform: NodeJS.Platform;
  fetchFn: FetchFn;
  spawnFn: SpawnFn;
  spawnSyncFn: SpawnSyncFn;
  killFn: KillFn;
  log: ListenLog;
  ffmpegBin: string;
  nodeBin: string;
  cfg: ListenCfg;
  device: string;
  clip: boolean;
  sttOpts: SttOpts;
  waitPid: ((pid: number, killFn: KillFn) => void) | undefined;
  /** Runs `main` again with the same options, as `toggle` does for `start` and `stop`. */
  again: (argv: string[]) => Promise<number>;
}

/** One verb: what it exits with. */
export type ListenVerb = (ctx: ListenCtx) => number | Promise<number>;
