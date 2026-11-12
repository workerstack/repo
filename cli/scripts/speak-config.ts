/** Reads `repo speak`'s argv and its config (env over ~/.workerstack/speak.json), and picks the provider. */
import os from "node:os";
import path from "node:path";

import { repoEnv, type Env } from "../repo-env.ts";
import {
  DEFAULT_ELEVEN_MODEL,
  DEFAULT_ELEVEN_VOICE,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_VOICE,
  ELEVENLABS,
  NEED_ELEVEN,
  NEED_KEY,
  NEED_OPENAI,
  OPENAI,
} from "./speak.constants.ts";
import type { Provider, SpeakCfg } from "./speak.types.ts";
import { section, str, readJson } from "./voice-args.ts";

/** The first value that is truthy, as a config source of any type. */
function first(...values: unknown[]): unknown {
  return values.find(Boolean);
}

/** Whether a key is present and not empty. */
function isSet(key: string | undefined): key is string {
  return key !== undefined && key !== "";
}

/** The ElevenLabs fields; the file's flat fields are the fallback for its section. */
function elevenOf(env: Env, file: Record<string, unknown>): SpeakCfg["elevenlabs"] {
  const eleven = section(file, ELEVENLABS);
  return {
    apiKey: str(first(env.ELEVENLABS_API_KEY, eleven.apiKey, file.apiKey)),
    modelId: str(first(env.ELEVENLABS_MODEL_ID, eleven.modelId, file.modelId), DEFAULT_ELEVEN_MODEL),
    voiceId: str(first(env.ELEVENLABS_VOICE_ID, eleven.voiceId, file.voiceId), DEFAULT_ELEVEN_VOICE),
  };
}

function openaiOf(env: Env, file: Record<string, unknown>): SpeakCfg["openai"] {
  const openai = section(file, OPENAI);
  return {
    apiKey: str(first(env.OPENAI_API_KEY, openai.apiKey)),
    model: str(first(env.OPENAI_TTS_MODEL, openai.model), DEFAULT_OPENAI_MODEL),
    voice: str(first(env.OPENAI_TTS_VOICE, openai.voice), DEFAULT_OPENAI_VOICE),
  };
}

export function loadCfg({ env = repoEnv.process, home = os.homedir() }: { env?: Env; home?: string } = {}): SpeakCfg {
  const filePath = path.join(home, ".workerstack", "speak.json");
  const file = readJson(filePath);
  return {
    elevenlabs: elevenOf(env, file),
    filePath,
    openai: openaiOf(env, file),
    providerPref: str(first(env.SPEAK_PROVIDER, file.provider)).toLowerCase(),
  };
}

/** `provider` when `key` is set, else the error that names the missing key. */
function keyed(key: string | undefined, provider: Provider, need: string): Provider {
  if (!isSet(key)) throw new Error(need);
  return provider;
}

/** The first provider with a key, ElevenLabs before OpenAI. */
function firstKeyed(cfg: SpeakCfg | null | undefined): Provider {
  if (isSet(cfg?.elevenlabs.apiKey)) return ELEVENLABS;
  if (isSet(cfg?.openai.apiKey)) return OPENAI;
  throw new Error(NEED_KEY);
}

/** The flag's provider, else the configured one, else the first with a key. */
export function resolveProvider(cfg: SpeakCfg | null | undefined, flagProvider?: string): Provider {
  const want = str(first(flagProvider, cfg?.providerPref)).toLowerCase();
  if (want === "") return firstKeyed(cfg);
  if (want === ELEVENLABS) return keyed(cfg?.elevenlabs.apiKey, ELEVENLABS, NEED_ELEVEN);
  if (want === OPENAI) return keyed(cfg?.openai.apiKey, OPENAI, NEED_OPENAI);
  throw new Error("provider must be elevenlabs or openai");
}
