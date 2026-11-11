import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cleanupTmp, plantModel, readSession, repoBin, run, textFetch, tmp, which } from "./__fixtures__/listen-env.ts";
import { sessionPath } from "./listen-session.ts";
import { defaultGgmlPath } from "./listen-whisper.ts";
import { GGML_URL } from "./listen.constants.ts";
import type { SpawnOpts, SpawnSyncResult } from "./listen.types.ts";

afterEach(cleanupTmp);

const ffmpegOnly = which({ ffmpeg: "/usr/bin/ffmpeg" });
const local = which({ ffmpeg: "/usr/bin/ffmpeg", "whisper-cli": "/usr/bin/whisper-cli" });

/** A whisper-cli stand-in that writes `text` where `-of` points. */
function whisperWrites(text: string) {
  return (_bin: string, args: string[]): SpawnSyncResult => {
    fs.writeFileSync(`${args[args.indexOf("-of") + 1]}.txt`, text);
    return { status: 0, stderr: "", stdout: "" };
  };
}

/** Exits 0 on the next microtask when asked for `exit`. */
function exitSoon(ev: string, cb: (code: number, signal: null) => void): void {
  if (ev === "exit") queueMicrotask(() => cb(0, null));
}

/** An ffmpeg spawn that checks its args and writes the wav it was asked for. */
function fakeFfmpeg(_bin: string, args: string[], opts: SpawnOpts) {
  expect(args).toContain("-nostdin");
  expect(args).toContain("-t");
  expect(opts.detached).toBe(true);
  expect(opts.stdio?.[0]).toBe("ignore");
  expect(opts.stdio?.[1]).toBe("ignore");
  const out = args.at(-1) ?? ""; // the output path is the last ffmpeg arg
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, "RIFF");
  return { kill() {}, on: exitSoon, pid: 4242 };
}

/** A kill that answers the signal-0 probe and throws on a real signal. */
function aliveThenGone(_pid: number, sig: string | number): void {
  if (sig === 0) return;
  throw new Error("esrch");
}

/** A fetch that must never run. */
function noApi(): Promise<never> {
  return Promise.reject(new Error("api should not run"));
}

describe("main rec", () => {
  it("rec without ffmpeg fails", async () => {
    const r = await run(["rec"], { platform: "darwin", whichFn: which({}) });
    expect(r.code).toBe(1);
    expect(r.errs.join("\n")).toMatch(/missing ffmpeg/);
    expect(r.errs.join("\n")).toMatch(/setup: bun repo setup listen/);
  });

  it("rec mocks ffmpeg then transcribes", async () => {
    const r = await run(["rec", "--seconds", "2"], {
      fetchFn: textFetch("from rec"),
      spawnFn: fakeFfmpeg,
      whichFn: ffmpegOnly,
    });
    expect(r.code).toBe(0);
    expect(r.logs.join("\n")).toContain("from rec");
  });
});

describe("main start and stop", () => {
  it("start respawns the recorder through bin/repo.ts listen _record", async () => {
    const spawned: string[][] = [];
    function spawnFn(_bin: string, args: string[]) {
      spawned.push(args);
      return { pid: 4243, unref() {} };
    }
    const r = await run(["start"], { spawnFn, whichFn: ffmpegOnly });
    expect(r.code).toBe(0);
    expect(spawned[0]?.slice(0, 4)).toStrictEqual([repoBin(), "listen", "_record", "--out"]);
  });
});

describe("main start then stop", () => {
  it("start writes session; stop transcribes", async () => {
    const cwd = tmp("listen-ss-");
    const home = tmp("listen-ssh-");
    const spawned: string[][] = [];
    function spawnFn(_bin: string, args: string[]) {
      spawned.push(args);
      return { pid: 4242, unref() {} };
    }
    const started = await run(["start"], { cwd, home, killFn: () => {}, spawnFn, whichFn: ffmpegOnly });
    expect(started.code).toBe(0);
    const sess = readSession(cwd);
    expect(sess.pid).toBe(4242);
    expect(spawned[0]?.[2]).toBe("_record");
    fs.writeFileSync(String(sess.wav), "RIFF");
    const over = {
      cwd,
      fetchFn: textFetch("from stop"),
      home,
      killFn: aliveThenGone,
      waitPid: () => {},
      whichFn: ffmpegOnly,
    };
    const stopped = await run(["stop"], over);
    expect(stopped.code).toBe(0);
    expect(stopped.logs.join("\n")).toContain("from stop");
    expect(fs.existsSync(sessionPath(cwd))).toBe(false);
  });
});

describe("main local engine", () => {
  it("prefers local whisper-cli when bin and ggml model exist", async () => {
    const home = tmp("listen-loc-h-");
    const cwd = tmp("listen-loc-");
    plantModel(path.join(home, ".workerstack", "whisper", "ggml-base.en.bin"));
    const wav = path.join(cwd, "clip.wav");
    fs.writeFileSync(wav, "RIFF");
    const spawnSyncFn = whisperWrites("local hello\n");
    const r = await run(["file", "--path", wav], { cwd, fetchFn: noApi, home, spawnSyncFn, whichFn: local });
    expect(r.code).toBe(0);
    expect(r.logs.join("\n")).toContain("local hello");
  });
});

describe("main ggml download", () => {
  it("downloads ggml-base.en.bin on first local stt", async () => {
    const cwd = tmp("listen-dl-");
    const wav = path.join(cwd, "clip.wav");
    fs.writeFileSync(wav, "RIFF");
    let fetched = "";
    function fetchFn(url: string) {
      fetched = url;
      return Promise.resolve({ arrayBuffer: () => Promise.resolve(Buffer.from("ggml-fake")), ok: true, status: 200 });
    }
    const spawnSyncFn = whisperWrites("from local download\n");
    const r = await run(["file", "--path", wav], { cwd, env: {}, fetchFn, spawnSyncFn, whichFn: local });
    expect(r.code).toBe(0);
    expect(fetched).toBe(GGML_URL);
    expect(fs.readFileSync(defaultGgmlPath(r.home), "utf8")).toBe("ggml-fake");
    expect(r.logs.join("\n")).toContain("from local download");
    expect(r.errs.join("\n")).toMatch(/downloading/);
  });
});
