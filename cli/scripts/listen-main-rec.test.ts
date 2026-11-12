import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ffmpeg,
  run,
  textFetch,
  tmp,
  type FfmpegCtx,
  type Seen,
  wavThen,
  which,
  cleanupTmp,
} from "./__fixtures__/listen-env.ts";
import { NEED_FFMPEG, NEED_STT } from "./listen.constants.ts";

afterEach(cleanupTmp);

/** A fake ffmpeg that logs an error, then exits 1. */
function logThenFail({ errFd, on }: FfmpegCtx): void {
  fs.writeSync(errFd, "Input/output error");
  on.exit?.(1, null);
}

describe("rec", () => {
  it("records for the configured seconds, then transcribes", async () => {
    const seen: Seen[] = [];
    const env = { LISTEN_SECONDS: "3", OPENAI_API_KEY: "k" };
    const r = await run(["rec"], { env, fetchFn: textFetch("recorded"), spawnFn: ffmpeg(wavThen(0), seen) });
    const args = seen[0]?.args ?? [];
    expect(r.code).toBe(0);
    expect(r.errs[0]).toBe("recording 3s on :0…");
    expect(r.errs).toContain("transcribing…");
    expect(r.logs[0]).toBe("recorded");
    expect(args[args.indexOf("-t") + 1]).toBe("3");
  });

  it("--seconds and --out win over the configuration", async () => {
    const out = path.join(tmp("listen-rec-out-"), "mine.wav");
    const env = { LISTEN_SECONDS: "9", OPENAI_API_KEY: "k" };

    const spawnFn = ffmpeg((ctx) => {
      fs.writeFileSync(out, "RIFF");
      ctx.on.exit?.(0, null);
    });

    const r = await run(["rec", "--seconds", "2", "--out", out], { env, fetchFn: textFetch("mine"), spawnFn });
    expect(r.errs[0]).toBe("recording 2s on :0…");
    expect(r.code).toBe(0);
  });

  it("needs ffmpeg and a speech engine", async () => {
    const noFfmpeg = await run(["rec"], { whichFn: which({}) });
    expect(noFfmpeg.errs).toStrictEqual([NEED_FFMPEG]);
    const noStt = await run(["rec"], { env: {} });
    expect(noStt.errs).toStrictEqual([NEED_STT]);
  });
});

/** Fakes only the timers the rec timeout uses. */
function fakeTimers() {
  return vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

describe("rec timeout", () => {
  it("kills a hung ffmpeg and reports what it logged", async () => {
    fakeTimers();
    const killed: Array<[number, string | number]> = [];

    function killFn(pid: number, sig: string | number) {
      return void killed.push([pid, sig]);
    }

    const spawnFn = ffmpeg(({ errFd }) => {
      fs.writeSync(errFd, "Device or resource busy");
      vi.advanceTimersByTime(60_000);
    });

    const r = await run(["rec", "--seconds", "1"], { killFn, spawnFn });
    expect(r.code).toBe(1);
    expect(r.errs.at(-1)).toBe("Device or resource busy");
    expect(killed).toStrictEqual([[-777, "SIGKILL"]]);
  });

  it("uses a default message when a hung ffmpeg logged nothing", async () => {
    fakeTimers();
    const spawnFn = ffmpeg(() => vi.advanceTimersByTime(60_000));
    const r = await run(["rec", "--seconds", "1"], { killFn: () => true, spawnFn });
    expect(r.errs.at(-1)).toBe("ffmpeg rec timed out");
  });
});

describe("rec failures", () => {
  it("reports a failing ffmpeg with its log", async () => {
    const r = await run(["rec"], { spawnFn: ffmpeg(logThenFail) });
    expect(r.errs.at(-1)).toBe("Input/output error");
  });

  it("reports a failing ffmpeg with a default when it logged nothing", async () => {
    const r = await run(["rec"], { spawnFn: ffmpeg(({ on }) => on.exit?.(1, null)) });
    expect(r.errs.at(-1)).toBe("ffmpeg rec failed");
  });

  it.each([[Object.assign(new Error("ENOENT"), { code: "ENOENT" })], [new Error("plain failure")]])(
    "treats a spawn error (%s) like a failed ffmpeg",
    async (err) => {
      const r = await run(["rec"], { spawnFn: ffmpeg(({ on }) => on.error?.(err)) });
      expect(r.code).toBe(1);
      expect(r.errs.at(-1)).toBe("ffmpeg rec failed");
    },
  );

  it("fails when ffmpeg exits cleanly but wrote no wav", async () => {
    const r = await run(["rec"], { spawnFn: ffmpeg(({ on }) => on.exit?.(0, null)) });
    expect(r.errs.at(-1)).toBe("ffmpeg wrote no wav");
  });

  it("transcribes a wav that ffmpeg left behind even though it exited non-zero", async () => {
    const r = await run(["rec"], { fetchFn: textFetch("salvaged"), spawnFn: ffmpeg(wavThen(1)) });
    expect(r.code).toBe(0);
    expect(r.logs[0]).toBe("salvaged");
  });
});
