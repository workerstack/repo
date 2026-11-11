import { afterEach, describe, expect, it, vi } from "vitest";

import type { Handler } from "./__fixtures__/listen-env.ts";
import {
  darwinAudioSpec,
  defaultDevice,
  ffmpegInputArgs,
  ffmpegRecordArgs,
  recCapture,
  recCaptureOpts,
} from "./listen-ffmpeg.ts";
import type { ChildLike } from "./listen.types.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("devices and input args", () => {
  it("default device per platform", () => {
    expect(defaultDevice("darwin")).toBe(":0");
    expect(defaultDevice("linux")).toBe("default");
    expect(defaultDevice("win32")).toBe("");
  });

  it("ffmpeg input args", () => {
    expect(ffmpegInputArgs("darwin", "", "")).toStrictEqual(["-f", "avfoundation", "-i", ":0"]);
    expect(ffmpegInputArgs("linux", "", "")).toStrictEqual(["-f", "pulse", "-i", "default"]);
    expect(ffmpegInputArgs("linux", "hw:0", "")).toStrictEqual(["-f", "alsa", "-i", "hw:0"]);
    expect(ffmpegInputArgs("win32", "Mic", "")).toStrictEqual(["-f", "dshow", "-i", "audio=Mic"]);
    expect(() => ffmpegInputArgs("win32", "", "")).toThrow(/LISTEN_DEVICE/);
  });

  it("darwinAudioSpec normalises every device spelling", () => {
    expect(darwinAudioSpec("")).toBe(":0");
    expect(darwinAudioSpec("none:3")).toBe(":3");
    expect(darwinAudioSpec(":2")).toBe(":2");
    expect(darwinAudioSpec("5")).toBe(":5");
    expect(darwinAudioSpec("a:b")).toBe("a:b");
    expect(darwinAudioSpec("Mic")).toBe(":Mic");
  });
});

describe("ffmpeg arguments", () => {
  it("an explicit format wins and win32 keeps an audio= prefix", () => {
    expect(ffmpegInputArgs("linux", "hw:0", "pulse")).toStrictEqual(["-f", "pulse", "-i", "hw:0"]);
    expect(ffmpegInputArgs("win32", "audio=Mic", "")).toStrictEqual(["-f", "dshow", "-i", "audio=Mic"]);
  });

  it("a timed recording carries -t and -nostdin, with the seconds clamped", () => {
    const base = { device: "", ffmpegFormat: "", out: "/o.wav", platform: "linux" } as const;
    const timed = ffmpegRecordArgs({ ...base, seconds: 999 });
    expect(timed).toContain("-nostdin");
    expect(timed.slice(timed.indexOf("-t"), timed.indexOf("-t") + 2)).toStrictEqual(["-t", "120"]);
    expect(timed.at(-1)).toBe("/o.wav");
  });

  it("an open-ended recording carries neither", () => {
    const open = ffmpegRecordArgs({
      device: "",
      ffmpegFormat: "",
      out: "/o.wav",
      platform: "linux",
      seconds: undefined,
    });
    expect(open).not.toContain("-nostdin");
    expect(open).not.toContain("-t");
  });

  it("recCaptureOpts sends stderr to the given fd, or ignores it", () => {
    expect(recCaptureOpts(7).stdio).toStrictEqual(["ignore", "ignore", 7]);
    expect(recCaptureOpts(null).stdio).toStrictEqual(["ignore", "ignore", "ignore"]);
    expect(recCaptureOpts().stdio).toStrictEqual(["ignore", "ignore", "ignore"]);
  });
});

function fakeChild(over: Partial<ChildLike> = {}) {
  const on: Record<string, Handler> = {};
  const child: ChildLike = {
    on(ev: string, cb: Handler) {
      on[ev] = cb;
    },
    pid: 321,
    ...over,
  };
  return { child, on };
}

function capture(child: ChildLike, killFn: (pid: number, sig: string | number) => unknown = () => {}) {
  return recCapture({ args: [], bin: "ffmpeg", errFd: null, killFn, seconds: 5, spawnFn: () => child });
}

describe("recCapture outcome", () => {
  it("reports the exit code and signal", async () => {
    const a = fakeChild();
    const pa = capture(a.child);
    a.on.exit?.(0, null);
    expect(await pa).toMatchObject({ error: null, signal: null, status: 0 });
    const b = fakeChild();
    const pb = capture(b.child);
    b.on.exit?.(undefined, "SIGTERM");
    expect(await pb).toMatchObject({ signal: "SIGTERM", status: null });
    const c = fakeChild();
    const pc = capture(c.child);
    c.on.exit?.(2, 5);
    expect(await pc).toMatchObject({ signal: null, status: 2 });
  });

  it("reports a spawn error and ignores a later exit", async () => {
    const a = fakeChild();
    const p = capture(a.child);
    const err = new Error("ENOENT");
    a.on.error?.(err);
    a.on.exit?.(0, null);
    expect(await p).toMatchObject({ error: err, status: null });
  });

  it("treats a child with no event API as finished", async () => {
    expect(await capture({ pid: 1 })).toMatchObject({ error: null, status: 0 });
  });
});

function fakeTimers() {
  return vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}
function throwing() {
  throw new Error("EPERM");
}

describe("recCapture timeout", () => {
  it("kills the process group and reports ETIMEDOUT", async () => {
    fakeTimers();
    const killed: Array<[number, string | number]> = [];
    const p = capture(fakeChild().child, (pid, sig) => killed.push([pid, sig]));
    vi.advanceTimersByTime(7001);
    expect(await p).toMatchObject({ error: { code: "ETIMEDOUT" }, signal: "SIGKILL", status: null });
    expect(killed).toStrictEqual([[-321, "SIGKILL"]]);
  });

  it("falls back to child.kill when the group kill throws", async () => {
    fakeTimers();
    const signals: unknown[] = [];
    const p = capture(fakeChild({ kill: (sig) => signals.push(sig) }).child, throwing);
    vi.advanceTimersByTime(7001);
    const result = await p;
    expect(result.signal).toBe("SIGKILL");
    expect(signals).toStrictEqual(["SIGKILL"]);
  });

  it("survives child.kill failing too, and skips the group kill without a pid", async () => {
    fakeTimers();
    const both = capture(fakeChild({ kill: throwing }).child, throwing);
    const kills: unknown[] = [];
    const noPid = capture(fakeChild({ pid: undefined }).child, (...args) => kills.push(args));
    vi.advanceTimersByTime(7001);
    const bothResult = await both;
    expect(bothResult.error).toMatchObject({ code: "ETIMEDOUT" });
    await noPid;
    expect(kills).toStrictEqual([]);
  });
});
