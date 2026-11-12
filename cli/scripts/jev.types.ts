import type { Json, JsonObject } from "../json.ts";
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

export type JevResponse = {
  status: number;
  json: () => Promise<Json>;
  /** The slice of a fetch Headers the runner reads: one header by name, null when absent. */
  headers: { get(name: string): string | null };
};

export type JevFetch = (url: string, init: JevInit) => Promise<JevResponse>;

export type JevRunOpts = {
  home?: string | undefined;
  env?: Env | undefined;
  fetchImpl?: JevFetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  now?: (() => number) | undefined;
  stateText?: string | undefined;
  questionsText?: string | undefined;
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
  json: Json;
  headers: JevResponse["headers"];
};

/** One request's outcome: a refusal, or the response and the clock it was charged at. */
export type Posted = { response: PostResult; nowMs: number };

export type Attempt = { fail: JevResult } | Posted;

export type StopKind = "requests" | "tokens";

export type Begun = { busy: true } | { stop: StopKind } | { ok: true; estimate: number };

/** One run's checked inputs. */
export type JevInput = { questions: JsonObject; questionsText: string; stateText: string };

/** Everything one run's attempts share. */
export type JevCall = {
  home: string;
  key: string;
  estimate: number;
  state: unknown;
  questions: JsonObject;
  fetchImpl: JevFetch;
  sleep: (ms: number) => Promise<void>;
  nowFn: () => number;
  /** Marks the process's one request as spent. */
  spend: () => void;
};
