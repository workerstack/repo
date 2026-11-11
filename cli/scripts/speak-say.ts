/** Says text: asks the provider for audio, saves it under the repo root or `--out`, and plays it on request. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { apiBytes } from "./speak-api.ts";
import { resolveProvider } from "./speak-config.ts";
import { ELEVEN_API, ELEVEN_FORMAT, ELEVENLABS, FLAG_TRUE, OPENAI_API, SPEAK_DIR } from "./speak.constants.ts";
import type { ApiOpts, SayOpts, SpeakSpawn } from "./speak.types.ts";
import { FLAG_ON } from "./voice-args.constants.ts";
import { str } from "./voice-args.ts";
import { resolveRoots } from "./workspace-root.ts";

export function playPath(dest: string, spawn: SpeakSpawn, platform: NodeJS.Platform = process.platform): void {
  const bin = platform === "darwin" ? "afplay" : "ffplay";
  const args = platform === "darwin" ? [dest] : ["-nodisp", "-autoexit", dest];
  spawn(bin, args, { stdio: "ignore" });
}

type Speech = { url: string; init: ApiOpts };

function elevenSpeech({ voice, cfg }: SayOpts, text: string): Speech {
  const id = str(voice, cfg.elevenlabs.voiceId);
  const headers = { "Content-Type": "application/json", "xi-api-key": cfg.elevenlabs.apiKey };
  return {
    init: { body: { model_id: cfg.elevenlabs.modelId, text }, headers, method: "POST" },
    url: `${ELEVEN_API}/text-to-speech/${encodeURIComponent(id)}?output_format=${ELEVEN_FORMAT}`,
  };
}

function openaiSpeech({ voice, cfg }: SayOpts, text: string): Speech {
  const headers = { Authorization: `Bearer ${cfg.openai.apiKey}`, "Content-Type": "application/json" };
  return {
    init: {
      body: { input: text, model: cfg.openai.model, voice: str(voice, cfg.openai.voice) },
      headers,
      method: "POST",
    },
    url: `${OPENAI_API}/audio/speech`,
  };
}

/** `--out`, else a fresh mp3 under the speak dir of the repo root around `cwd`. */
function destOf(out: string | undefined, cwd: string): string {
  return str(out) || path.join(resolveRoots({}, { cwd }).root, SPEAK_DIR, `say-${Date.now()}.mp3`);
}

export async function say(opts: SayOpts): Promise<string> {
  const text = str(opts.text);
  if (!text) throw new Error("say needs --text");
  const p = resolveProvider(opts.cfg, opts.provider);
  const { url, init } = p === ELEVENLABS ? elevenSpeech(opts, text) : openaiSpeech(opts, text);
  const buf = await apiBytes(url, { ...init, fetchFn: opts.fetchFn });
  const dest = destOf(opts.out, opts.cwd ?? process.cwd());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  const { play, spawn = spawnSync } = opts;
  if (play === true || play === FLAG_TRUE || play === FLAG_ON) playPath(dest, spawn);
  return dest;
}
