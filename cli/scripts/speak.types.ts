import type { JsonObject } from "../json.ts";
import type { Env } from "../repo-env.ts";
import type { FetchResult } from "./listen.types.ts";

export type Provider = "elevenlabs" | "openai";

export type SpeakCfg = {
  filePath: string;
  providerPref: string;
  elevenlabs: { apiKey: string; voiceId: string; modelId: string };
  openai: { apiKey: string; voice: string; model: string };
};

/** The fetch this script calls, with the slice of its init it passes; a broken one may hand back null. */
export type FetchFn = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string | undefined;
  },
) => Promise<FetchResult | null>;

/** A request to a provider, before its body is encoded. */
export type ApiOpts = {
  method?: string | undefined;
  headers: Record<string, string>;
  body?: JsonObject | undefined;
  fetchFn?: FetchFn | undefined;
};

/** The speaker edge: plays one audio file with the platform's player. */
export type SpeakSpawn = (cmd: string, args: string[], opts: { stdio: "ignore" }) => void;

export type SpeakMainOpts = {
  env?: Env | undefined;
  home?: string | undefined;
  cwd?: string | undefined;
  fetchFn?: FetchFn | undefined;
  log?: { log(msg: string): void; error(msg: string): void } | undefined;
  spawn?: SpeakSpawn | undefined;
};

export type ProviderOpts = {
  provider?: string | undefined;
  cfg: SpeakCfg;
  fetchFn?: FetchFn | undefined;
};

export type SayOpts = {
  text?: string | undefined;
  voice?: string | undefined;
  out?: string | undefined;
  play?: boolean | string | undefined;
  cwd?: string | undefined;
  spawn?: SpeakSpawn | undefined;
} & ProviderOpts;
