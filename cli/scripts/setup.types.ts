import type { Env } from "../env.ts";
import type { SpawnSyncOpts } from "./google-workspace.types.ts";
import type { WhichFn } from "./listen.types.ts";
import type { FetchResult } from "./speak.types.ts";

export type Flags = Record<string, string>;

export type Status = {
  ok: boolean;
  extra: string;
};

export type Statuses = Record<string, Status>;

export type TargetStatuses = Record<"speak" | "jev" | "listen" | "google-workspace" | "browser", Status>;

/**
 * Prompt and log hooks. A plain log-only io (tests, non-TTY) leaves the prompts unset; select and password are set on
 * every interactive io.
 */
export type SetupIo = {
  log?(s: string): unknown;
  error?(s: string): unknown;
  confirm?(opts: { message: string; initialValue?: boolean }): Promise<boolean>;
  select?(opts: {
    message: string;
    options: { value: string; label: string }[];
    initialValue: string;
  }): Promise<string>;
  text?(opts: { message: string; initialValue?: string; defaultValue?: string }): Promise<string>;
  password?(opts: { message: string }): Promise<string>;
};

export type SetupFetch = (
  url: string,
  init: {
    method?: string | undefined;
    headers?: Record<string, string> | undefined;
    body?: string | FormData | undefined;
    redirect?: "follow" | "manual" | "error" | undefined;
  },
) => Promise<FetchResult>;

export type SetupSpawnSync = (cmd: string, args: string[], opts: SpawnSyncOpts) => unknown;

export type SetupCtx = {
  flags?: Flags | undefined;
  env?: Env | undefined;
  home?: string | undefined;
  io?: SetupIo | null | undefined;
  fetchFn?: SetupFetch | undefined;
  openUrlFn?: ((url: string) => unknown) | undefined;
  platform?: NodeJS.Platform | undefined;
  spawnSyncFn?: SetupSpawnSync | undefined;
  whichFn?: WhichFn | undefined;
  pathEnv?: string | undefined;
  interactive?: boolean | undefined;
  loginFn?: ((dest: string, home: string) => Promise<unknown>) | undefined;
};

export type SetupMainOpts = {
  cwd?: string;
  stdin?: { isTTY?: boolean };
  stdout?: { isTTY?: boolean };
} & Omit<SetupCtx, "flags">;

export type SpeakPatch = {
  provider?: string;
  elevenlabs?: { apiKey: string };
  openai?: { apiKey: string };
  listen?: { device: string };
};

/** One key prompt: the line logged first, the page opened, and the password prompt's message. */
export type KeyAsk = { line: string; url: string; message: string };
