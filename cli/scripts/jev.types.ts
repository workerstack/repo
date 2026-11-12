import type { Env } from "../repo-env.ts";

export type JevResult = {
  code: number;
  text: string;
};

/** The request init this script sends; every field is always set. */
export type JevInit = {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
};

export type HeadersLike = { get(name: string): string | null } | Record<string, string>;

export type JevResponse = {
  status: number;
  json: () => Promise<unknown>;
  headers?: HeadersLike | null;
};

export type JevFetch = (url: string, init: JevInit) => Promise<JevResponse>;

export type JevRunOpts = {
  home?: string | undefined;
  env?: Env | undefined;
  fetchImpl?: JevFetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  now?: number | (() => number) | undefined;
  stateText?: unknown;
  questionsText?: unknown;
};

export type JevRun = (opts?: JevRunOpts) => Promise<JevResult>;

export type JevMainOpts = {
  run?: JevRun;
} & Omit<JevRunOpts, "stateText" | "questionsText">;

export type Ledger = {
  day: string;
  requests: number;
  input_tokens: number;
};

export type PostResult = {
  status: number;
  json: unknown;
  headers: HeadersLike | null | undefined;
};

/** One request's outcome: a refusal, or the response and the clock it was charged at. */
export type Posted = { response: PostResult; nowMs: number };
export type Attempt = { fail: JevResult } | Posted;

export type StopKind = "requests" | "tokens";
export type Begun = { busy: true } | { stop: StopKind } | { ok: true; estimate: number };

/** One run's checked inputs. */
export type JevInput = { questions: Record<string, unknown>; questionsText: string; stateText: string };

/** Everything one run's attempts share. */
export type JevCall = {
  home: string;
  key: string;
  estimate: number;
  state: unknown;
  questions: Record<string, unknown>;
  fetchImpl: JevFetch;
  sleep: (ms: number) => Promise<void>;
  nowFn: () => number;
  /** Marks the process's one request as spent. */
  spend: () => void;
};
