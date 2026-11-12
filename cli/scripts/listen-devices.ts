import { DARWIN } from "./darwin.constants.ts";
import { needFfmpeg } from "./listen-ffmpeg.ts";
import { AVFOUNDATION_LIST, DSHOW_LIST, PACTL_LIST, PULSE_DEFAULT } from "./listen.constants.ts";
import type { AudioDevice, SpawnSyncFn, SpawnSyncResult } from "./listen.types.ts";
import { streamText } from "./stream-text.ts";
/** Lists the audio capture devices: ffmpeg's avfoundation or dshow listing, or pactl's pulse sources. */
import { str } from "./voice-args.ts";
import { WIN32 } from "./win32.constants.ts";

/** Where a listing's audio section starts and stops, and the device one of its lines names. */
type Section = {
  starts: (line: string) => boolean;
  stops: RegExp;
  device: (line: string) => AudioDevice | null;
};

const AV_DEVICE = /\[(\d+)\]\s+(.+)$/;
const AV_AUDIO_START = /AVFoundation audio devices/i;
const AV_AUDIO_HEADING = /audio devices:\s*$/i;
const DSHOW_DEVICE = /"([^"]+)"/;
const DSHOW_AUDIO_START = /DirectShow audio devices/i;
const LINE_BREAK = /\r?\n/;
const PACTL_SOURCE = /^\s*(\d+)\s+(\S+)/;

const AV_SECTION: Section = {
  device: (line) => {
    const [, index = "", name = ""] = AV_DEVICE.exec(line) ?? [];

    return index === "" ? null : { id: `:${index}`, name: name.trim() };
  },
  starts: (line) => AV_AUDIO_START.test(line) || AV_AUDIO_HEADING.test(line),
  stops: /video devices/i,
};

const DSHOW_SECTION: Section = {
  device: (line) => {
    const [, name = ""] = DSHOW_DEVICE.exec(line) ?? [];

    return name === "" ? null : { id: name, name };
  },
  starts: (line) => DSHOW_AUDIO_START.test(line),
  stops: /DirectShow video devices/i,
};

/** The devices named inside a listing's audio section, in order. */
function sectionDevices(lines: string[], section: Section): AudioDevice[] {
  const out: AudioDevice[] = [];
  let isAudio = false;

  for (const line of lines) {
    if (section.starts(line)) {
      isAudio = true;
    } else if (section.stops.test(line)) {
      isAudio = false;
    } else if (isAudio) {
      const d = section.device(line);

      if (d !== null) out.push(d);
    }
  }

  return out;
}

/** pactl's sources by name, or pulse's default source when it lists none. */
function pulseDevices(lines: string[]): AudioDevice[] {
  const out: AudioDevice[] = [];

  for (const line of lines) {
    const [, , name = ""] = PACTL_SOURCE.exec(line) ?? [];

    if (name !== "") out.push({ id: name, name });
  }

  if (out.length === 0) out.push({ ...PULSE_DEFAULT });

  return out;
}

export function parseDevices(text: string | undefined, platform: NodeJS.Platform): AudioDevice[] {
  const lines = (text ?? "").split(LINE_BREAK);

  if (platform === DARWIN) return sectionDevices(lines, AV_SECTION);

  if (platform === WIN32) return sectionDevices(lines, DSHOW_SECTION);

  return pulseDevices(lines);
}

function both(r: SpawnSyncResult): string {
  return `${streamText(r.stderr)}\n${streamText(r.stdout)}`;
}

type ListOpts = { platform: NodeJS.Platform; ffmpegBin: string | undefined; spawnSyncFn: SpawnSyncFn };

export function listDevicesText({ platform, ffmpegBin, spawnSyncFn }: ListOpts): AudioDevice[] {
  const ffmpeg = needFfmpeg(ffmpegBin);

  if (platform === DARWIN)
    return parseDevices(both(spawnSyncFn(ffmpeg, [...AVFOUNDATION_LIST], { encoding: "utf8" })), DARWIN);

  if (platform === WIN32) return parseDevices(both(spawnSyncFn(ffmpeg, [...DSHOW_LIST], { encoding: "utf8" })), WIN32);

  const pactl = spawnSyncFn("pactl", [...PACTL_LIST], { encoding: "utf8" });
  const sources = streamText(pactl.stdout);

  if (pactl.status === 0 && str(sources) !== "") return parseDevices(sources, "linux");

  return parseDevices("", "linux");
}
