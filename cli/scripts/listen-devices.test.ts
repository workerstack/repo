import { describe, expect, it } from "vitest";

import { listDevicesText, parseDevices } from "./listen-devices.ts";
import { NEED_FFMPEG } from "./listen.constants.ts";
import type { SpawnSyncResult } from "./listen.types.ts";

const AV_FIXTURE = `
[AVFoundation indev @ 0x] AVFoundation video devices:
[AVFoundation indev @ 0x] [0] FaceTime HD Camera
[AVFoundation indev @ 0x] AVFoundation audio devices:
[AVFoundation indev @ 0x] [0] MacBook Pro Microphone
[AVFoundation indev @ 0x] [1] BlackHole 2ch
`;

const DSHOW_FIXTURE = `
[dshow @ 0x] DirectShow video devices (some may be both video and audio devices)
[dshow @ 0x]  "USB Camera"
[dshow @ 0x] DirectShow audio devices
[dshow @ 0x]  "Microphone (Realtek Audio)"
[dshow @ 0x]  "Stereo Mix (Realtek Audio)"
`;

function devices(platform: NodeJS.Platform, r: SpawnSyncResult) {
  const calls: Array<[string, string[]]> = [];

  function spawnSyncFn(cmd: string, args: string[]): SpawnSyncResult {
    calls.push([cmd, args]);

    return r;
  }

  return { calls, list: listDevicesText({ ffmpegBin: "/bin/ffmpeg", platform, spawnSyncFn }) };
}

/** A spawnSync stub that exits 0 with no output. */
function okSync(): SpawnSyncResult {
  return { status: 0 };
}

describe("parseDevices", () => {
  it("parses avfoundation and dshow fixtures", () => {
    expect(parseDevices(AV_FIXTURE, "darwin")).toStrictEqual([
      { id: ":0", name: "MacBook Pro Microphone" },
      { id: ":1", name: "BlackHole 2ch" },
    ]);
    expect(parseDevices(DSHOW_FIXTURE, "win32")).toStrictEqual([
      { id: "Microphone (Realtek Audio)", name: "Microphone (Realtek Audio)" },
      { id: "Stereo Mix (Realtek Audio)", name: "Stereo Mix (Realtek Audio)" },
    ]);
  });
});

describe("listDevicesText darwin and win32", () => {
  it("needs ffmpeg", () => {
    expect(() => listDevicesText({ ffmpegBin: "", platform: "linux", spawnSyncFn: okSync })).toThrow(NEED_FFMPEG);
  });

  it("reads avfoundation devices from stderr or stdout", () => {
    const a = devices("darwin", { status: 1, stderr: AV_FIXTURE });
    expect(a.list.map((d) => d.id)).toStrictEqual([":0", ":1"]);
    expect(a.calls[0]?.[1]).toContain("avfoundation");
    expect(devices("darwin", { status: 1, stdout: AV_FIXTURE }).list).toHaveLength(2);
    expect(devices("darwin", { status: 1 }).list).toStrictEqual([]);
  });

  it("reads dshow devices from stderr or stdout", () => {
    const a = devices("win32", { status: 1, stderr: DSHOW_FIXTURE });
    expect(a.list.map((d) => d.id)).toStrictEqual(["Microphone (Realtek Audio)", "Stereo Mix (Realtek Audio)"]);
    expect(a.calls[0]?.[1]).toContain("dshow");
    expect(devices("win32", { status: 1, stdout: DSHOW_FIXTURE }).list).toHaveLength(2);
    expect(devices("win32", { status: 1 }).list).toStrictEqual([]);
  });
});

describe("listDevicesText linux", () => {
  const fallback = [{ id: "default", name: "pulse default" }];

  it("lists pulse sources", () => {
    const ok = devices("linux", { status: 0, stdout: "0\talsa_input.pci\tmodule\n1\talsa_output.monitor\tm\n" });
    expect(ok.list.map((d) => d.id)).toStrictEqual(["alsa_input.pci", "alsa_output.monitor"]);
    expect(ok.calls[0]?.[0]).toBe("pactl");
  });

  it("falls back to the default source when pactl fails or lists nothing", () => {
    expect(devices("linux", { status: 1, stdout: "0\tx" }).list).toStrictEqual(fallback);
    expect(devices("linux", { status: 0, stdout: "  " }).list).toStrictEqual(fallback);
  });
});

describe("parseDevices edges", () => {
  it("tolerates non-string input on linux", () => {
    expect(parseDevices(undefined, "linux")).toStrictEqual([{ id: "default", name: "pulse default" }]);
  });

  it("darwin ignores lines outside the audio section and non-device lines", () => {
    expect(parseDevices("Some audio devices:\n[0] Mic\nnot a device\n", "darwin")).toStrictEqual([
      { id: ":0", name: "Mic" },
    ]);
    expect(parseDevices("[0] before any section", "darwin")).toStrictEqual([]);
    expect(parseDevices("AVFoundation audio devices:\nAVFoundation video devices:\n[1] Cam", "darwin")).toStrictEqual(
      [],
    );
  });

  it("win32 ignores lines outside the audio section and unquoted lines", () => {
    const text = '"before section"\nDirectShow audio devices\n junk\n "A"\nDirectShow video devices\n "V"';
    expect(parseDevices(text, "win32")).toStrictEqual([{ id: "A", name: "A" }]);
  });
});
