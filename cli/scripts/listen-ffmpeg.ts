/** Builds ffmpeg's capture argv for each platform and runs a timed capture. */
import { clampSeconds } from "./listen-argv.ts";
import {
  FFMPEG_PCM,
  FFMPEG_QUIET,
  KILL_GRACE_SECONDS,
  MS_PER_SECOND,
  NEED_DEVICE,
  NEED_FFMPEG,
  TIMED_OUT,
} from "./listen.constants.ts";
import type { CaptureResult, ChildLike, KillFn, SpawnFn } from "./listen.types.ts";
import { str } from "./voice-args.ts";

const NONE_RE = /^none:/i;
const INDEX_RE = /^\d+$/;
const DSHOW_AUDIO = "audio=";
const ALSA_HW = "hw:";

/** The ffmpeg binary, or the error that says how to install it. */
export function needFfmpeg(bin: string | undefined): string {
  if (!bin) throw new Error(NEED_FFMPEG);
  return bin;
}

export function defaultDevice(platform: NodeJS.Platform): string {
  if (platform === "darwin") return ":0";
  if (platform === "win32") return "";
  return "default";
}

/** An avfoundation audio-only input spec: `:N` for an index or a bare name, `video:audio` as given. */
export function darwinAudioSpec(device: unknown): string {
  const d = str(device, ":0");
  if (NONE_RE.test(d)) return d.replace(NONE_RE, ":");
  if (d.startsWith(":")) return d;
  if (INDEX_RE.test(d)) return `:${d}`;
  return d.includes(":") ? d : `:${d}`;
}

export function ffmpegInputArgs(platform: NodeJS.Platform, device: unknown, ffmpegFormat: string): string[] {
  const d = str(device, defaultDevice(platform));
  if (platform === "darwin") return ["-f", "avfoundation", "-i", darwinAudioSpec(d)];
  if (platform === "win32") {
    if (!d) throw new Error(NEED_DEVICE);
    return ["-f", "dshow", "-i", d.startsWith(DSHOW_AUDIO) ? d : `${DSHOW_AUDIO}${d}`];
  }
  const fmt = ffmpegFormat || (d.startsWith(ALSA_HW) ? "alsa" : "pulse");
  return ["-f", fmt, "-i", d];
}

type RecordArgsOpts = {
  platform: NodeJS.Platform;
  device: unknown;
  out: string;
  seconds: number | undefined;
  ffmpegFormat: string;
};

/** A 16 kHz mono wav capture to `out`; a timed one reads no stdin and stops itself. */
export function ffmpegRecordArgs({ platform, device, out, seconds, ffmpegFormat }: RecordArgsOpts): string[] {
  const t = seconds ? ["-t", String(clampSeconds(seconds))] : [];
  const noIn = seconds ? ["-nostdin"] : [];
  const input = ffmpegInputArgs(platform, device, ffmpegFormat);
  return [...FFMPEG_QUIET, ...noIn, ...input, ...FFMPEG_PCM, ...t, "-y", out];
}

export function recCaptureOpts(errFd?: number | null): {
  detached: true;
  stdio: (string | number)[];
  windowsHide: true;
} {
  return {
    detached: true,
    stdio: ["ignore", "ignore", errFd ?? "ignore"],
    windowsHide: true,
  };
}

type Finish = (status: number | null, signal: string | null, error: unknown) => void;

/** Kills the capture's process group, or the child alone when that fails. */
function killHard(child: ChildLike, killFn: KillFn): void {
  try {
    if (child.pid) killFn(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill?.("SIGKILL");
    } catch {
      // none
    }
  }
}

function watchChild(child: ChildLike, finish: Finish): void {
  if (typeof child.on !== "function") {
    finish(0, null, null);
    return;
  }
  child.on("error", (error: unknown) => finish(null, null, error));
  child.on("exit", (code: unknown, signal: unknown) =>
    finish(typeof code === "number" ? code : null, typeof signal === "string" ? signal : null, null),
  );
}

type CaptureOpts = {
  bin: string;
  args: string[];
  seconds: unknown;
  spawnFn: SpawnFn;
  killFn: KillFn;
  errFd: number | null;
};

/** Runs a detached capture and settles on its exit, its spawn error, or a kill past its length plus a grace. */
export function recCapture({ bin, args, seconds, spawnFn, killFn, errFd }: CaptureOpts): Promise<CaptureResult> {
  const s = clampSeconds(seconds);
  return new Promise<CaptureResult>((resolve) => {
    const child = spawnFn(bin, args, recCaptureOpts(errFd));
    let done = false;
    const finish: Finish = (status, signal, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ error, signal, status, stderr: "" });
    };
    const timer = setTimeout(
      () => {
        killHard(child, killFn);
        finish(null, "SIGKILL", { code: TIMED_OUT });
      },
      (s + KILL_GRACE_SECONDS) * MS_PER_SECOND,
    );
    watchChild(child, finish);
  });
}
