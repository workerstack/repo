import { needFfmpeg } from "./listen-ffmpeg.ts";
import { AVFOUNDATION_LIST, DSHOW_LIST, PACTL_LIST, PULSE_DEFAULT } from "./listen.constants.ts";
import type { AudioDevice, SpawnSyncFn, SpawnSyncResult } from "./listen.types.ts";
/** Lists the audio capture devices: ffmpeg's avfoundation or dshow listing, or pactl's pulse sources. */
import { str } from "./voice-args.ts";

/** Where a listing's audio section starts and stops, and the device one of its lines names. */
type Section = {
  starts: (line: string) => boolean;
  stops: RegExp;
  device: (line: string) => AudioDevice | null;
};

const DARWIN: Section = {
  device: (line) => {
    const [, index, name] = /\[(\d+)\]\s+(.+)$/.exec(line) ?? [];
    return index ? { id: `:${index}`, name: String(name).trim() } : null;
  },
  starts: (line) => /AVFoundation audio devices/i.test(line) || /audio devices:\s*$/i.test(line),
  stops: /video devices/i,
};

const WIN32: Section = {
  device: (line) => {
    const m = /"([^"]+)"/.exec(line);
    return m ? { id: String(m[1]), name: String(m[1]) } : null;
  },
  starts: (line) => /DirectShow audio devices/i.test(line),
  stops: /DirectShow video devices/i,
};

/** The devices named inside a listing's audio section, in order. */
function sectionDevices(lines: string[], section: Section): AudioDevice[] {
  const out: AudioDevice[] = [];
  let audio = false;
  for (const line of lines) {
    if (section.starts(line)) {
      audio = true;
    } else if (section.stops.test(line)) {
      audio = false;
    } else if (audio) {
      const d = section.device(line);
      if (d) out.push(d);
    }
  }
  return out;
}

/** pactl's sources by name, or pulse's default source when it lists none. */
function pulseDevices(lines: string[]): AudioDevice[] {
  const out: AudioDevice[] = [];
  for (const line of lines) {
    const [, , name] = /^\s*(\d+)\s+(\S+)/.exec(line) ?? [];
    if (name) out.push({ id: name, name });
  }
  if (!out.length) out.push({ ...PULSE_DEFAULT });
  return out;
}

export function parseDevices(text: unknown, platform: NodeJS.Platform): AudioDevice[] {
  const lines = String(text || "").split(/\r?\n/);
  if (platform === "darwin") return sectionDevices(lines, DARWIN);
  if (platform === "win32") return sectionDevices(lines, WIN32);
  return pulseDevices(lines);
}

const both = (r: SpawnSyncResult): string => `${r.stderr || ""}\n${r.stdout || ""}`;

type ListOpts = { platform: NodeJS.Platform; ffmpegBin: string | undefined; spawnSyncFn: SpawnSyncFn };

export function listDevicesText({ platform, ffmpegBin, spawnSyncFn }: ListOpts): AudioDevice[] {
  const ffmpeg = needFfmpeg(ffmpegBin);
  if (platform === "darwin")
    return parseDevices(both(spawnSyncFn(ffmpeg, [...AVFOUNDATION_LIST], { encoding: "utf8" })), "darwin");

  if (platform === "win32")
    return parseDevices(both(spawnSyncFn(ffmpeg, [...DSHOW_LIST], { encoding: "utf8" })), "win32");

  const pactl = spawnSyncFn("pactl", [...PACTL_LIST], { encoding: "utf8" });
  if (pactl.status === 0 && str(pactl.stdout)) return parseDevices(pactl.stdout, "linux");
  return parseDevices("", "linux");
}
