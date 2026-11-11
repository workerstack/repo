/** Reads `repo listen`'s argv and its config (env over ~/.workerstack/speak.json) into typed values. */
import path from "node:path";

import type { Env } from "../env.ts";
import { DEFAULT_MODEL, DEFAULT_SECONDS, MAX_SECONDS, STT_AUTO } from "./listen.constants.ts";
import type { ListenCfg } from "./listen.types.ts";
import { readJson, section, str } from "./voice-args.ts";

export function clampSeconds(v: unknown, fallback: number = DEFAULT_SECONDS): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_SECONDS, Math.max(1, Math.round(n)));
}

export function loadCfg({ env, home }: { env: Env; home: string }): ListenCfg {
  const filePath = path.join(home, ".workerstack", "speak.json");
  const file = readJson(filePath);
  const openai = section(file, "openai");
  const listen = section(file, "listen");
  return {
    apiKey: str(env.OPENAI_API_KEY || openai.apiKey),
    device: str(env.LISTEN_DEVICE || listen.device),
    ffmpegFormat: str(env.LISTEN_FFMPEG_FORMAT || listen.format).toLowerCase(),
    filePath,
    model: str(env.LISTEN_MODEL || listen.model, DEFAULT_MODEL),
    seconds: clampSeconds(env.LISTEN_SECONDS || listen.seconds, DEFAULT_SECONDS),
    stt: str(env.LISTEN_STT || listen.stt, STT_AUTO).toLowerCase(),
    whisperModel: str(env.WHISPER_MODEL || env.LISTEN_WHISPER_MODEL || listen.whisperModel),
  };
}
