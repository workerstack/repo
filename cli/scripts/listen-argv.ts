/** Reads `repo listen`'s argv and its config (env over ~/.workerstack/speak.json) into typed values. */
import path from "node:path";

import type { Env } from "../repo-env.ts";
import { firstNonEmpty } from "./first-non-empty.ts";
import { DEFAULT_MODEL, DEFAULT_SECONDS, MAX_SECONDS, STT_AUTO } from "./listen.constants.ts";
import type { ListenCfg } from "./listen.types.ts";
import { readObjectFile, section, str } from "./voice-args.ts";

export function clampSeconds(v: unknown, fallback: number = DEFAULT_SECONDS): number {
  const n = Number(v);

  if (!Number.isFinite(n) || n <= 0) return fallback;

  return Math.min(MAX_SECONDS, Math.max(1, Math.round(n)));
}

export function loadCfg({ env, home }: { env: Env; home: string }): ListenCfg {
  const filePath = path.join(home, ".workerstack", "speak.json");
  const file = readObjectFile(filePath);
  const openai = section(file, "openai");
  const listen = section(file, "listen");

  return {
    apiKey: str(firstNonEmpty(env.OPENAI_API_KEY) ?? openai.apiKey),
    device: str(firstNonEmpty(env.LISTEN_DEVICE) ?? listen.device),
    ffmpegFormat: str(firstNonEmpty(env.LISTEN_FFMPEG_FORMAT) ?? listen.format).toLowerCase(),
    filePath,
    model: str(firstNonEmpty(env.LISTEN_MODEL) ?? listen.model, DEFAULT_MODEL),
    seconds: clampSeconds(firstNonEmpty(env.LISTEN_SECONDS) ?? listen.seconds, DEFAULT_SECONDS),
    stt: str(firstNonEmpty(env.LISTEN_STT) ?? listen.stt, STT_AUTO).toLowerCase(),
    whisperModel: str(firstNonEmpty(env.WHISPER_MODEL, env.LISTEN_WHISPER_MODEL) ?? listen.whisperModel),
  };
}
