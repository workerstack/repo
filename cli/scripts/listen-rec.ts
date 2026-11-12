/** The recording verbs of `repo listen`: rec, start, stop, and the detached `_record` that start spawns. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isRecord } from "../json.ts";
import { clampSeconds } from "./listen-argv.ts";
import { finishTranscript } from "./listen-clip.ts";
import { ffmpegRecordArgs, needFfmpeg, recCapture } from "./listen-ffmpeg.ts";
import { clearSession, listenDir, pidAlive, readSession, waitPidExit, writeSession } from "./listen-session.ts";
import { ensureStt } from "./listen-whisper.ts";
import { FFMPEG_LOG, FFMPEG_LOG_CHARS, FFMPEG_QUIT_EXIT, TIMED_OUT } from "./listen.constants.ts";
import type { CaptureResult, ChildLike, ListenCtx } from "./listen.types.ts";
import { str } from "./voice-args.ts";

/** Asks ffmpeg to quit by writing `q` to its stdin, then closes it. */
function quit(child: ChildLike): void {
  try {
    child.stdin?.write("q\n");
  } catch {
    // none
  }

  try {
    child.stdin?.end();
  } catch {
    // none
  }
}

function exitOf(child: ChildLike): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    child.on?.("error", reject);
    child.on?.("exit", (c: unknown) => resolve(typeof c === "number" ? c : 0));
  });
}

/** `_record --out W`: records until SIGINT or SIGTERM asks ffmpeg to quit; exit 255 is that quit. */
export async function record(ctx: ListenCtx): Promise<number> {
  const out = str(ctx.flags.out);

  if (out === "") throw new Error("_record needs --out");
  const ffmpeg = needFfmpeg(ctx.ffmpegBin);
  const secondsFlag = ctx.flags.seconds;
  const seconds = secondsFlag === undefined || secondsFlag === "" ? 0 : clampSeconds(secondsFlag);
  const { platform, device, cfg } = ctx;

  const args = ffmpegRecordArgs({
    device,
    ffmpegFormat: cfg.ffmpegFormat,
    out,
    platform,
    seconds: seconds > 0 ? seconds : undefined,
  });

  fs.mkdirSync(path.dirname(out), { recursive: true });
  writeSession(ctx.cwd, { pid: process.pid, started: Date.now(), wav: out });
  const child = ctx.spawnFn(ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"] });

  function onSignal() {
    return quit(child);
  }

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const code = await exitOf(child);

  return code !== 0 && code !== FFMPEG_QUIT_EXIT ? 1 : 0;
}

/** `start`: spawns `bin/repo.ts listen _record` detached and records its pid in the session. */
export function start(ctx: ListenCtx): number {
  needFfmpeg(ctx.ffmpegBin);
  const cur = readSession(ctx.cwd);

  if (pidAlive(cur.pid, ctx.killFn)) {
    ctx.log.error(`already recording pid=${str(cur.pid)}`);

    return 1;
  }

  const { cwd, device, env } = ctx;
  const wav = path.join(listenDir(cwd), `rec-${Date.now()}.wav`);
  const bin = fileURLToPath(new URL("../../bin/repo.ts", import.meta.url));
  const argv = [bin, "listen", "_record", "--out", wav, ...(device === "" ? [] : ["--device", device]), "--cwd", cwd];
  const stdio = ["ignore", "ignore", "ignore"]; // same as "ignore"
  const child = ctx.spawnFn(ctx.nodeBin, argv, { cwd, detached: true, env, stdio, windowsHide: true });

  if (typeof child.unref === "function") child.unref();
  writeSession(cwd, { pid: child.pid, started: Date.now(), wav });
  ctx.log.log(`recording pid=${child.pid}\n${wav}`);

  return 0;
}

/** Interrupts a live recorder and waits for it to write its wav. */
function interrupt(ctx: ListenCtx, pid: number): void {
  if (!pidAlive(pid, ctx.killFn)) return;

  try {
    ctx.killFn(pid, "SIGINT");
  } catch {
    // none
  }

  if (typeof ctx.waitPid === "function") ctx.waitPid(pid, ctx.killFn);
  else waitPidExit(pid, ctx.killFn);
}

/** `stop`: ends the session's recorder and transcribes what it recorded. */
export async function stop(ctx: ListenCtx): Promise<number> {
  const s = readSession(ctx.cwd);
  const hasPid = Boolean(s.pid);

  if (!hasPid) throw new Error("not recording");
  interrupt(ctx, Number(s.pid));
  clearSession(ctx.cwd);
  const wav = str(s.wav);

  if (wav === "" || !fs.existsSync(wav)) throw new Error("no wav from session");
  await finishTranscript(ctx, wav, await ensureStt(ctx.sttOpts));

  return 0;
}

type Job = { bin: string; args: string[]; seconds: number; wav: string };

/** Runs a timed capture with ffmpeg's log in the listen dir; throws with that log when no wav comes of it. */
async function capture(ctx: ListenCtx, { bin, args, seconds, wav }: Job): Promise<void> {
  const ffLog = path.join(listenDir(ctx.cwd), FFMPEG_LOG);
  const errFd = fs.openSync(ffLog, "w");
  let r: CaptureResult;

  try {
    r = await recCapture({ args, bin, errFd, killFn: ctx.killFn, seconds, spawnFn: ctx.spawnFn });
  } finally {
    fs.closeSync(errFd);
  }

  const ffErr = str(fs.readFileSync(ffLog, "utf8")).slice(0, FFMPEG_LOG_CHARS);

  if (isRecord(r.error) && r.error.code === TIMED_OUT) throw new Error(str(ffErr, "ffmpeg rec timed out"));

  if (r.status !== 0 && !fs.existsSync(wav)) throw new Error(str(ffErr, "ffmpeg rec failed"));

  if (!fs.existsSync(wav)) throw new Error("ffmpeg wrote no wav");
}

/** `rec`: records for a fixed time, then transcribes. */
export async function rec(ctx: ListenCtx): Promise<number> {
  const bin = needFfmpeg(ctx.ffmpegBin);
  const stt = await ensureStt(ctx.sttOpts);
  const secondsFlag = ctx.flags.seconds;
  const seconds = clampSeconds(secondsFlag === undefined || secondsFlag === "" ? ctx.cfg.seconds : secondsFlag);
  const outFlag = str(ctx.flags.out);
  const wav = outFlag === "" ? path.join(listenDir(ctx.cwd), `rec-${Date.now()}.wav`) : outFlag;
  const { platform, device, cfg } = ctx;
  const args = ffmpegRecordArgs({ device, ffmpegFormat: cfg.ffmpegFormat, out: wav, platform, seconds });
  ctx.log.error(`recording ${seconds}s on ${args[args.indexOf("-i") + 1]}…`);
  await capture(ctx, { args, bin, seconds, wav });
  ctx.log.error("transcribing…");
  await finishTranscript(ctx, wav, stt);

  return 0;
}
