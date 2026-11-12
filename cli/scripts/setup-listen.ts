/** `repo setup listen`: finds ffmpeg and whisper-cli, fetches the model, and saves the OpenAI fallback key. */
import os from "node:os";

import { repoEnv, type Env } from "../repo-env.ts";
import { whichBin } from "./doctor-which.ts";
import type { Stt, WhichFn } from "./listen.types.ts";
import { flagOn } from "./setup-argv.ts";
import { mergeSpeakJson } from "./setup-files.ts";
import { askKey, logLine } from "./setup-io.ts";
import { reprobeHint } from "./setup-status.ts";
import { OPENAI_KEY_URL } from "./setup.constants.ts";
import type { Flags, SetupCtx, SpeakPatch } from "./setup.types.ts";
import { str } from "./voice-args.ts";

/** The context with every default filled in. */
type ListenRun = SetupCtx & {
  env: Env;
  flags: Flags;
  home: string;
  interactive: boolean;
  platform: NodeJS.Platform;
  whichFn: WhichFn;
};

function listenRun(ctx: SetupCtx): ListenRun {
  return {
    ...ctx,
    env: ctx.env ?? repoEnv.process,
    flags: ctx.flags ?? {},
    home: ctx.home ?? os.homedir(),
    interactive: ctx.interactive ?? false,
    pathEnv: ctx.pathEnv ?? repoEnv.process.PATH,
    platform: ctx.platform ?? process.platform,
    whichFn: ctx.whichFn ?? whichBin,
  };
}

async function pickListenEngine(run: ListenRun): Promise<{ ffmpegBin: string; whisperBin: string }> {
  const { findWhisperBin } = await import("./listen-whisper.ts");
  const { interactive, io, pathEnv, platform, whichFn } = run;

  function ffmpeg(): string {
    return whichFn("ffmpeg", pathEnv, platform);
  }

  function whisper(): string {
    return findWhisperBin(whichFn, pathEnv, platform);
  }

  const ffmpegBin = await reprobeHint({ found: ffmpeg(), id: "ffmpeg", interactive, io, platform, probe: ffmpeg });

  const whisperBin = await reprobeHint({
    found: whisper(),
    id: "whisper-cli",
    interactive,
    io,
    platform,
    probe: whisper,
  });

  return { ffmpegBin, whisperBin };
}

async function ensureWhisperModel(run: ListenRun, whisperBin: string): Promise<void> {
  if (whisperBin === "" || flagOn(run.flags, "skip-download")) return;
  const { io } = run;
  let shouldDownload = true;

  if (run.interactive && typeof io?.confirm === "function") {
    shouldDownload = await io.confirm({
      initialValue: true,
      message: "Download ggml-base.en.bin (~142MB) into ~/.workerstack/whisper/?",
    });
  }

  if (!shouldDownload) return;
  const { downloadGgml } = await import("./listen-whisper.ts");

  const model = await downloadGgml({
    fetchFn: run.fetchFn,
    home: run.home,
    log: { error: (s: string) => logLine(io, s) },
  });

  logLine(io, `model ${model}`);
}

/** The OpenAI key from the flags, or from the terminal when there is no local or saved STT. */
async function fallbackKey(run: ListenRun, whisperBin: string): Promise<string> {
  const { loadCfg } = await import("./listen-argv.ts");
  const key = str(run.flags["openai-key"], str(run.flags.openai));
  const cfgNow = loadCfg({ env: run.env, home: run.home });

  if (whisperBin !== "" || cfgNow.apiKey !== "" || key !== "") return key;
  const missing = "need whisper-cli or --openai-key (or TTY: bun repo setup listen)";

  if (!run.interactive || run.io === undefined || run.io === null) throw new Error(missing);
  const line = `Local STT is unavailable. OpenAI Whisper fallback: ${OPENAI_KEY_URL}`;

  return askKey(run.io, run, { line, message: "OpenAI API key (fallback STT)", url: OPENAI_KEY_URL });
}

async function saveListenKey(run: ListenRun, ffmpegBin: string, openaiKey: string): Promise<void> {
  const patch: SpeakPatch = {};

  if (openaiKey !== "") patch.openai = { apiKey: openaiKey };
  const device = str(run.flags.device);

  if (device !== "") patch.listen = { device };
  const { io } = run;

  if (run.interactive && ffmpegBin !== "" && device === "" && typeof io?.text === "function") {
    const d = str(
      await io.text({
        defaultValue: "",
        message: "Mic device id (blank = default; Windows needs an id from listen devices)",
      }),
    );

    if (d !== "") patch.listen = { ...patch.listen, device: d };
  }

  if (Object.keys(patch).length === 0) return;
  const dest = mergeSpeakJson(run.home, patch);
  logLine(io, `wrote ${dest}`);
}

async function reportStt(run: ListenRun): Promise<Stt | null> {
  const { loadCfg } = await import("./listen-argv.ts");
  const { probeStt } = await import("./listen-whisper.ts");
  const { home, io, pathEnv, platform, whichFn } = run;
  const stt = probeStt({ cfg: loadCfg({ env: {}, home }), cwd: "", home, pathEnv, platform, whichFn });

  if (stt === null) logLine(io, "stt=none");
  else if (stt.kind === "local") logLine(io, `stt=local  bin=${stt.bin}  model=${stt.model}`);
  else logLine(io, `stt=openai  model=${stt.model}`);

  return stt;
}

export async function setupListen(ctx: SetupCtx = {}): Promise<{ ok: true; stt: Stt | null }> {
  const run = listenRun(ctx);
  const { ffmpegBin, whisperBin } = await pickListenEngine(run);
  await ensureWhisperModel(run, whisperBin);
  await saveListenKey(run, ffmpegBin, await fallbackKey(run, whisperBin));

  return { ok: true, stt: await reportStt(run) };
}
