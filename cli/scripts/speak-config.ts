/** Reads `repo speak`'s argv and its config (env over ~/.workerstack/speak.json), and picks the provider. */
import os from "node:os";
import path from "node:path";

import { readEnv } from "../env.ts";
import type { Env } from "../env.ts";
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

/** The ElevenLabs fields; the file's flat fields are the fallback for its section. */
function elevenOf(env: Env, file: Record<string, unknown>): SpeakCfg["elevenlabs"] {
  const eleven = section(file, ELEVENLABS);
  return {
    apiKey: str(env.ELEVENLABS_API_KEY || eleven.apiKey || file.apiKey),
    modelId: str(env.ELEVENLABS_MODEL_ID || eleven.modelId || file.modelId, DEFAULT_ELEVEN_MODEL),
    voiceId: str(env.ELEVENLABS_VOICE_ID || eleven.voiceId || file.voiceId, DEFAULT_ELEVEN_VOICE),
  };
}

function openaiOf(env: Env, file: Record<string, unknown>): SpeakCfg["openai"] {
  const openai = section(file, OPENAI);
  return {
    apiKey: str(env.OPENAI_API_KEY || openai.apiKey),
    model: str(env.OPENAI_TTS_MODEL || openai.model, DEFAULT_OPENAI_MODEL),
    voice: str(env.OPENAI_TTS_VOICE || openai.voice, DEFAULT_OPENAI_VOICE),
  };
}

export function loadCfg({ env = readEnv(), home = os.homedir() }: { env?: Env; home?: string } = {}): SpeakCfg {
  const filePath = path.join(home, ".workerstack", "speak.json");
  const file = readJson(filePath);
  return {
    elevenlabs: elevenOf(env, file),
    filePath,
    openai: openaiOf(env, file),
    providerPref: str(env.SPEAK_PROVIDER || file.provider).toLowerCase(),
  };
}

/** `provider` when `key` is set, else the error that names the missing key. */
function keyed(key: string | undefined, provider: Provider, need: string): Provider {
  if (!key) throw new Error(need);
  return provider;
}

/** The first provider with a key, ElevenLabs before OpenAI. */
function firstKeyed(cfg: SpeakCfg | null | undefined): Provider {
  if (cfg?.elevenlabs.apiKey) return ELEVENLABS;
  if (cfg?.openai.apiKey) return OPENAI;
  throw new Error(NEED_KEY);
}

/** The flag's provider, else the configured one, else the first with a key. */
export function resolveProvider(cfg: SpeakCfg | null | undefined, flagProvider?: string): Provider {
  const want = str(flagProvider || cfg?.providerPref).toLowerCase();
  if (!want) return firstKeyed(cfg);
  if (want === ELEVENLABS) return keyed(cfg?.elevenlabs.apiKey, ELEVENLABS, NEED_ELEVEN);
  if (want === OPENAI) return keyed(cfg?.openai.apiKey, OPENAI, NEED_OPENAI);
  throw new Error("provider must be elevenlabs or openai");
}
