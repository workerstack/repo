import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL,
  GGML_URL,
  NEED_FFMPEG,
  NEED_GGML,
  NEED_OPENAI,
  NEED_STT,
  USAGE,
  clampSeconds,
  copyClip,
  darwinAudioSpec,
  defaultDevice,
  defaultGgmlPath,
  downloadGgml,
  ensureStt,
  ffmpegInputArgs,
  ffmpegRecordArgs,
  findWhisperBin,
  findWhisperModel,
  formatHttpError,
  latestPath,
  listDevicesText,
  loadCfg,
  main,
  parseArgv,
  parseDevices,
  pidAlive,
  probeStt,
  recCapture,
  recCaptureOpts,
  resolveStt,
  sessionPath,
  transcribe,
  transcribeLocal,
} from "./listen.ts";
import type { ChildLike, FetchFn, FetchResult, ListenCfg, SpawnSyncResult, Stt, SttOpts } from "./listen.ts";
import { BUN } from "../../dev/test-paths";
import { childEnv } from "../env.ts";

function whichMap(map: Record<string, string> = {}) {
  return (name: string) => map[name] || "";
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const bin = path.join(root, "bin", "repo.ts");

const tmpDirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function gitRepoWithPkg(prefix: string) {
  const r = fs.realpathSync(tmp(prefix));
  spawnSync("git", ["init", "-q"], { cwd: r });
  const a = path.join(r, "packages", "a");
  fs.mkdirSync(a, { recursive: true });
  return { r, a };
}

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

describe("parseArgv / clampSeconds / devices", () => {
  it("reads verb and flags", () => {
    expect(parseArgv(["rec", "--seconds", "5", "--clip"])).toEqual({
      _: ["rec"],
      flags: { seconds: "5", clip: "1" },
    });
  });

  it("caps seconds", () => {
    expect(clampSeconds(8)).toBe(8);
    expect(clampSeconds(0)).toBe(8);
    expect(clampSeconds(999)).toBe(120);
  });

  it("default device per platform", () => {
    expect(defaultDevice("darwin")).toBe(":0");
    expect(defaultDevice("linux")).toBe("default");
    expect(defaultDevice("win32")).toBe("");
  });

  it("ffmpeg input args", () => {
    expect(ffmpegInputArgs("darwin", "", "")).toEqual(["-f", "avfoundation", "-i", ":0"]);
    expect(ffmpegInputArgs("linux", "", "")).toEqual(["-f", "pulse", "-i", "default"]);
    expect(ffmpegInputArgs("linux", "hw:0", "")).toEqual(["-f", "alsa", "-i", "hw:0"]);
    expect(ffmpegInputArgs("win32", "Mic", "")).toEqual(["-f", "dshow", "-i", "audio=Mic"]);
    expect(() => ffmpegInputArgs("win32", "", "")).toThrow(/LISTEN_DEVICE/);
  });

  it("parses avfoundation and dshow fixtures", () => {
    expect(parseDevices(AV_FIXTURE, "darwin")).toEqual([
      { id: ":0", name: "MacBook Pro Microphone" },
      { id: ":1", name: "BlackHole 2ch" },
    ]);
    expect(parseDevices(DSHOW_FIXTURE, "win32")).toEqual([
      { id: "Microphone (Realtek Audio)", name: "Microphone (Realtek Audio)" },
      { id: "Stereo Mix (Realtek Audio)", name: "Stereo Mix (Realtek Audio)" },
    ]);
  });
});

describe("loadCfg", () => {
  it("reads openai key and listen fields from speak.json", () => {
    const home = tmp("listen-cfg-");
    fs.mkdirSync(path.join(home, ".workerstack"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".workerstack", "speak.json"),
      JSON.stringify({
        openai: { apiKey: "sk_file" },
        listen: { model: "gpt-4o-mini-transcribe", device: ":1", seconds: 4 },
      }),
    );
    const cfg = loadCfg({ env: {}, home });
    expect(cfg.apiKey).toBe("sk_file");
    expect(cfg.model).toBe("gpt-4o-mini-transcribe");
    expect(cfg.device).toBe(":1");
    expect(cfg.seconds).toBe(4);
  });

  it("env overrides file", () => {
    const home = tmp("listen-ov-");
    fs.mkdirSync(path.join(home, ".workerstack"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".workerstack", "speak.json"),
      JSON.stringify({ openai: { apiKey: "file" }, listen: { model: "whisper-1" } }),
    );
    const cfg = loadCfg({
      env: { OPENAI_API_KEY: "sk_env", LISTEN_MODEL: "whisper-1" },
      home,
    });
    expect(cfg.apiKey).toBe("sk_env");
    expect(cfg.model).toBe(DEFAULT_MODEL);
  });
});

describe("main", () => {
  it("usage on unknown verb", async () => {
    const errs: string[] = [];
    const code = await main(["nope"], {
      env: {},
      home: tmp("listen-u-"),
      cwd: tmp("listen-uc-"),
      whichFn: () => "",
      log: {
        log() {},
        error(s: string) {
          errs.push(String(s));
        },
      },
    });
    expect(code).toBe(1);
    expect(errs.join("\n")).toContain(USAGE);
  });

  it("file without a key fails and does not print a key", async () => {
    const cwd = tmp("listen-fk-");
    const wav = path.join(cwd, "a.wav");
    fs.writeFileSync(wav, "RIFF");
    const errs: string[] = [];
    const logs: string[] = [];
    const code = await main(["file", "--path", wav], {
      env: {},
      home: tmp("listen-fkh-"),
      cwd,
      whichFn: whichMap({ ffmpeg: "/bin/ffmpeg" }),
      log: {
        log(s: string) {
          logs.push(String(s));
        },
        error(s: string) {
          errs.push(String(s));
        },
      },
    });
    expect(code).toBe(1);
    const all = `${logs.join("\n")}\n${errs.join("\n")}`;
    expect(all).toMatch(/OPENAI_API_KEY|speak\.json|whisper-cli/);
    expect(all).toMatch(/setup: bun repo setup listen/);
    expect(all).not.toMatch(/sk_/);
  });

  it("file posts multipart and prints text", async () => {
    const cwd = tmp("listen-file-");
    const wav = path.join(cwd, "clip.wav");
    fs.writeFileSync(wav, "RIFFDATA");
    const logs: string[] = [];
    let posted: { url?: string; body?: FormData; headers?: Record<string, string> } = {};
    const code = await main(["file", "--path", wav], {
      env: { OPENAI_API_KEY: "sk_oa" },
      home: tmp("listen-fh-"),
      cwd,
      whichFn: whichMap({ ffmpeg: "/bin/ffmpeg" }),
      fetchFn: async (url: string, init: { body?: FormData; headers?: Record<string, string> }) => {
        posted = { url, body: init.body, headers: init.headers };
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: "hello world" }),
          text: async () => "",
        };
      },
      log: {
        log(s: string) {
          logs.push(String(s));
        },
        error() {},
      },
    });
    expect(code).toBe(0);
    expect(posted.url).toMatch(/audio\/transcriptions/);
    expect(posted.headers?.Authorization).toBe("Bearer sk_oa");
    expect(posted.body).toBeInstanceOf(FormData);
    expect(logs.join("\n")).toContain("hello world");
    expect(fs.readFileSync(path.join(cwd, ".tmp/repo/listen/latest.txt"), "utf8")).toMatch(/hello world/);
  });

  it("file from packages/a saves the transcript at the repo root and prints its absolute path", async () => {
    const { r, a } = gitRepoWithPkg("listen-sub-");
    const wav = path.join(a, "clip.wav");
    fs.writeFileSync(wav, "RIFFDATA");
    const logs: string[] = [];
    const code = await main(["file", "--path", wav], {
      env: { OPENAI_API_KEY: "sk_oa" },
      home: tmp("listen-sub-h-"),
      cwd: a,
      whichFn: whichMap({ ffmpeg: "/bin/ffmpeg" }),
      fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ text: "sub hello" }), text: async () => "" }),
      log: {
        log(s: string) {
          logs.push(String(s));
        },
        error() {},
      },
    });
    expect(code).toBe(0);
    const latest = path.join(r, ".tmp/repo/listen/latest.txt");
    expect(fs.readFileSync(latest, "utf8")).toMatch(/sub hello/);
    expect(logs).toContain(`transcript=${latest}`);
    expect(fs.existsSync(path.join(a, ".tmp"))).toBe(false);
  });

  it("rec without ffmpeg fails", async () => {
    const errs: string[] = [];
    const code = await main(["rec"], {
      env: { OPENAI_API_KEY: "sk_oa" },
      home: tmp("listen-nff-h-"),
      cwd: tmp("listen-nff-"),
      whichFn: whichMap(),
      platform: "darwin",
      log: {
        log() {},
        error(s: string) {
          errs.push(String(s));
        },
      },
    });
    expect(code).toBe(1);
    expect(errs.join("\n")).toMatch(/missing ffmpeg/);
    expect(errs.join("\n")).toMatch(/setup: bun repo setup listen/);
  });

  it("rec mocks ffmpeg then transcribes", async () => {
    const cwd = tmp("listen-rec-");
    const logs: string[] = [];
    const code = await main(["rec", "--seconds", "2"], {
      env: { OPENAI_API_KEY: "sk_oa" },
      home: tmp("listen-rech-"),
      cwd,
      platform: "darwin",
      whichFn: whichMap({ ffmpeg: "/usr/bin/ffmpeg" }),
      spawnFn: (_bin: string, args: string[], opts?: { detached?: boolean; stdio?: unknown[] }) => {
        expect(args).toContain("-nostdin");
        expect(args).toContain("-t");
        expect(opts?.detached).toBe(true);
        expect(opts?.stdio?.[0]).toBe("ignore");
        expect(opts?.stdio?.[1]).toBe("ignore");
        const out = args[args.length - 1]!; // the output path is the last ffmpeg arg
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, "RIFF");
        return {
          pid: 4242,
          stderr: { on() {} },
          on(ev: string, cb: (code: number, signal: null) => void) {
            if (ev === "exit") queueMicrotask(() => cb(0, null));
          },
          kill() {},
        };
      },
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ text: "from rec" }),
        text: async () => "",
      }),
      log: {
        log(s: string) {
          logs.push(String(s));
        },
        error() {},
      },
    });
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("from rec");
  });

  it("start respawns the recorder through bin/repo.ts listen _record", async () => {
    const cwd = tmp("listen-bin-");
    const spawned: string[][] = [];
    const code = await main(["start"], {
      env: { OPENAI_API_KEY: "sk_oa" },
      home: tmp("listen-binh-"),
      cwd,
      platform: "darwin",
      whichFn: whichMap({ ffmpeg: "/usr/bin/ffmpeg" }),
      spawnFn: (_bin: string, args: string[]) => {
        spawned.push(args);
        return { pid: 4243, unref() {} };
      },
      log: { log() {}, error() {} },
    });
    expect(code).toBe(0);
    expect(spawned[0]?.slice(0, 4)).toEqual([bin, "listen", "_record", "--out"]);
  });

  it("start writes session; stop transcribes", async () => {
    const cwd = tmp("listen-ss-");
    const home = tmp("listen-ssh-");
    const spawned: string[][] = [];
    const killed: Array<[number, string]> = [];
    const codeStart = await main(["start"], {
      env: { OPENAI_API_KEY: "sk_oa" },
      home,
      cwd,
      platform: "darwin",
      whichFn: whichMap({ ffmpeg: "/usr/bin/ffmpeg" }),
      spawnFn: (_bin: string, args: string[]) => {
        spawned.push(args);
        return { pid: 4242, unref() {} };
      },
      killFn: (pid: number, sig: string | number) => {
        killed.push([pid, String(sig)]);
      },
      log: { log() {}, error() {} },
    });
    expect(codeStart).toBe(0);
    const sess = JSON.parse(fs.readFileSync(sessionPath(cwd), "utf8")) as { pid: number; wav: string };
    expect(sess.pid).toBe(4242);
    expect(spawned[0]![2]).toBe("_record");
    fs.writeFileSync(sess.wav, "RIFF");
    const logs: string[] = [];
    const codeStop = await main(["stop"], {
      env: { OPENAI_API_KEY: "sk_oa" },
      home,
      cwd,
      platform: "darwin",
      whichFn: whichMap({ ffmpeg: "/usr/bin/ffmpeg" }),
      killFn: (pid: number, sig: string | number) => {
        if (sig === 0) return;
        killed.push([pid, String(sig)]);
        throw new Error("esrch");
      },
      waitPid: () => {},
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ text: "from stop" }),
        text: async () => "",
      }),
      log: {
        log(s: string) {
          logs.push(String(s));
        },
        error() {},
      },
    });
    expect(codeStop).toBe(0);
    expect(logs.join("\n")).toContain("from stop");
    expect(fs.existsSync(sessionPath(cwd))).toBe(false);
  });

  it("prefers local whisper-cli when bin and ggml model exist", async () => {
    const home = tmp("listen-loc-h-");
    const cwd = tmp("listen-loc-");
    const model = path.join(home, ".workerstack", "whisper", "ggml-base.en.bin");
    fs.mkdirSync(path.dirname(model), { recursive: true });
    fs.writeFileSync(model, "ggml");
    const wav = path.join(cwd, "clip.wav");
    fs.writeFileSync(wav, "RIFF");
    const cfg = loadCfg({ env: { OPENAI_API_KEY: "sk_oa" }, home });
    const stt = probeStt({
      cfg,
      whichFn: whichMap({ "whisper-cli": "/usr/bin/whisper-cli" }),
      pathEnv: undefined,
      platform: "linux",
      home,
      cwd,
    });
    expect(stt).toEqual({ kind: "local", bin: "/usr/bin/whisper-cli", model: path.resolve(model) });
    expect(findWhisperModel({ cfg, home, cwd })).toBe(path.resolve(model));
    const logs: string[] = [];
    const code = await main(["file", "--path", wav], {
      env: { OPENAI_API_KEY: "sk_oa" },
      home,
      cwd,
      whichFn: whichMap({ ffmpeg: "/usr/bin/ffmpeg", "whisper-cli": "/usr/bin/whisper-cli" }),
      spawnSyncFn: (_bin: string, args: string[]) => {
        const of = args[args.indexOf("-of") + 1];
        fs.writeFileSync(`${of}.txt`, "local hello\n");
        return { status: 0, stdout: "", stderr: "" };
      },
      fetchFn: async () => {
        throw new Error("api should not run");
      },
      log: {
        log(s: string) {
          logs.push(String(s));
        },
        error() {},
      },
    });
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("local hello");
  });

  it("LISTEN_STT=openai forces the API", () => {
    const home = tmp("listen-force-");
    const model = path.join(home, ".workerstack", "whisper", "ggml-base.en.bin");
    fs.mkdirSync(path.dirname(model), { recursive: true });
    fs.writeFileSync(model, "ggml");
    const cfg = loadCfg({ env: { OPENAI_API_KEY: "sk_oa", LISTEN_STT: "openai" }, home });
    expect(
      probeStt({
        cfg,
        whichFn: whichMap({ "whisper-cli": "/usr/bin/whisper-cli" }),
        pathEnv: undefined,
        platform: "linux",
        home,
        cwd: home,
      }),
    ).toEqual({ kind: "openai", model: DEFAULT_MODEL });
  });

  it("resolveStt without local or key throws", () => {
    const home = tmp("listen-none-");
    const cfg = loadCfg({ env: {}, home });
    expect(() =>
      resolveStt({ cfg, whichFn: whichMap(), pathEnv: undefined, platform: "linux", home, cwd: home }),
    ).toThrow(/whisper-cli|OPENAI_API_KEY/);
  });

  it("downloads ggml-base.en.bin on first local stt", async () => {
    const home = tmp("listen-dl-h-");
    const cwd = tmp("listen-dl-");
    const wav = path.join(cwd, "clip.wav");
    fs.writeFileSync(wav, "RIFF");
    let fetched = "";
    const logs: string[] = [];
    const errs: string[] = [];
    const code = await main(["file", "--path", wav], {
      env: {},
      home,
      cwd,
      whichFn: whichMap({ ffmpeg: "/usr/bin/ffmpeg", "whisper-cli": "/usr/bin/whisper-cli" }),
      fetchFn: async (url: string) => {
        fetched = url;
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => Buffer.from("ggml-fake"),
        };
      },
      spawnSyncFn: (_bin: string, args: string[]) => {
        const of = args[args.indexOf("-of") + 1];
        fs.writeFileSync(`${of}.txt`, "from local download\n");
        return { status: 0, stdout: "", stderr: "" };
      },
      log: {
        log(s: string) {
          logs.push(String(s));
        },
        error(s: string) {
          errs.push(String(s));
        },
      },
    });
    expect(code).toBe(0);
    expect(fetched).toBe(GGML_URL);
    expect(fs.readFileSync(defaultGgmlPath(home), "utf8")).toBe("ggml-fake");
    expect(logs.join("\n")).toContain("from local download");
    expect(errs.join("\n")).toMatch(/downloading/);
  });

  it("does not download when a ggml file already exists", async () => {
    const home = tmp("listen-nodl-");
    const dest = defaultGgmlPath(home);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "already");
    let fetches = 0;
    await downloadGgml({
      home,
      fetchFn: async () => {
        fetches += 1;
        return { ok: true, arrayBuffer: async () => Buffer.from("nope") };
      },
      log: undefined,
    });
    expect(fetches).toBe(0);
    expect(fs.readFileSync(dest, "utf8")).toBe("already");
  });

  it("falls back to openai if ggml download fails and a key exists", async () => {
    const home = tmp("listen-dlfail-");
    const cfg = loadCfg({ env: { OPENAI_API_KEY: "sk_oa" }, home });
    const stt = await ensureStt({
      cfg,
      home,
      whichFn: whichMap({ "whisper-cli": "/usr/bin/whisper-cli" }),
      pathEnv: undefined,
      platform: "linux",
      cwd: home,
      fetchFn: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }),
    });
    expect(stt).toEqual({ kind: "openai", model: DEFAULT_MODEL });
  });
});

describe("listen cli", () => {
  it("no args prints usage and exits 1", () => {
    const r = spawnSync(BUN, [bin, "listen"], {
      cwd: root,
      encoding: "utf8",
      env: childEnv({ OPENAI_API_KEY: "" }),
      timeout: 15_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("usage: listen");
  });

  it("file without a key exits non-zero and does not print a key", () => {
    const home = tmp("listen-cli-");
    const cwd = tmp("listen-cli-c-");
    const wav = path.join(cwd, "x.wav");
    fs.writeFileSync(wav, "RIFF");
    const r = spawnSync(BUN, [bin, "listen", "file", "--path", wav], {
      encoding: "utf8",
      cwd,
      env: childEnv({
        HOME: home,
        USERPROFILE: home,
        OPENAI_API_KEY: "",
        LISTEN_STT: "openai",
        PATH: "/nonexistent-repo-listen",
      }),
      timeout: 15_000,
    });
    expect(r.status).not.toBe(0);
    const out = `${r.stdout}${r.stderr}`;
    expect(out).not.toMatch(/sk_/);
    expect(out).toMatch(/OPENAI_API_KEY|speak\.json|whisper-cli|ggml/);
    expect(out).toMatch(/setup: bun repo setup listen/);
  });
});

function cfgFor(home: string, env: Record<string, string> = {}): ListenCfg {
  return loadCfg({ env, home });
}

function sttFor(home: string, over: Partial<SttOpts> = {}): SttOpts {
  return { cfg: cfgFor(home), whichFn: whichMap(), pathEnv: undefined, platform: "linux", home, cwd: home, ...over };
}

function plantModel(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "ggml");
}

function reply(res: FetchResult): FetchFn {
  return () => Promise.resolve(res);
}

function jsonReply(body: unknown): FetchFn {
  return reply({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

function bytesReply(bytes: number[]): FetchFn {
  return reply({ ok: true, arrayBuffer: () => Promise.resolve(new Uint8Array(bytes)) });
}

function plantSpeak(home: string, body: unknown) {
  fs.mkdirSync(path.join(home, ".workerstack"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".workerstack", "speak.json"),
    typeof body === "string" ? body : JSON.stringify(body),
  );
}

describe("parseArgv edges", () => {
  it("keeps only strings, and treats a non-array as no arguments", () => {
    expect(parseArgv("rec")).toEqual({ _: [], flags: {} });
    expect(parseArgv(["rec", 5, null, "x"])).toEqual({ _: ["rec", "x"], flags: {} });
  });

  it("stops flag parsing at --", () => {
    expect(parseArgv(["rec", "--", "--seconds", "5"])).toEqual({ _: ["rec", "--seconds", "5"], flags: {} });
  });

  it("a flag followed by a flag or nothing is a boolean", () => {
    expect(parseArgv(["--a", "--b", "--c"]).flags).toEqual({ a: "1", b: "1", c: "1" });
    expect(parseArgv(["--a", ""]).flags).toEqual({ a: "1" });
  });
});

describe("clampSeconds edges", () => {
  it("clamps garbage to the fallback and fractions up to one second", () => {
    expect(clampSeconds("abc")).toBe(8);
    expect(clampSeconds(-3, 5)).toBe(5);
    expect(clampSeconds(0.4)).toBe(1);
  });
});

describe("formatHttpError", () => {
  it("names a rejected key for 401 and 403 and for auth wording", () => {
    expect(formatHttpError(401, "")).toBe("openai key missing or rejected (401). setup: bun repo setup listen");
    expect(formatHttpError(403, "x")).toMatch(/rejected \(403\)/);
    expect(formatHttpError(500, "Invalid API key provided")).toMatch(/rejected \(500\)/);
  });

  it("falls back to the raw status when it is not a number", () => {
    expect(formatHttpError("err", "unauthorized")).toMatch(/rejected \(err\)/);
  });

  it("returns the status and the first 200 characters of the body otherwise", () => {
    expect(formatHttpError(500, "boom")).toBe("500 boom");
    expect(formatHttpError(502, undefined)).toBe("502");
    expect(formatHttpError(500, "z".repeat(300))).toBe(`500 ${"z".repeat(200)}`);
  });
});

describe("loadCfg from the environment", () => {
  it("reads every field", () => {
    const env = {
      OPENAI_API_KEY: " sk_e ",
      LISTEN_MODEL: "m-env",
      LISTEN_DEVICE: "hw:2",
      LISTEN_SECONDS: "500",
      LISTEN_FFMPEG_FORMAT: "ALSA",
      WHISPER_MODEL: "/m/a.bin",
      LISTEN_STT: "LOCAL",
    };
    expect(cfgFor(tmp("listen-cfg-env-"), env)).toMatchObject({
      apiKey: "sk_e",
      model: "m-env",
      device: "hw:2",
      seconds: 120,
      ffmpegFormat: "alsa",
      whisperModel: "/m/a.bin",
      stt: "local",
    });
  });

  it("falls back to LISTEN_WHISPER_MODEL when WHISPER_MODEL is unset", () => {
    expect(cfgFor(tmp("listen-cfg-wm-"), { LISTEN_WHISPER_MODEL: "/m/b.bin" }).whisperModel).toBe("/m/b.bin");
  });
});

describe("loadCfg from speak.json", () => {
  it("reads the listen fields and defaults the rest", () => {
    const home = tmp("listen-cfg-file-");
    plantSpeak(home, { listen: { format: "Pulse", whisperModel: "/m/c.bin", stt: "OpenAI" } });
    expect(cfgFor(home)).toMatchObject({
      ffmpegFormat: "pulse",
      whisperModel: "/m/c.bin",
      stt: "openai",
      model: DEFAULT_MODEL,
      seconds: 8,
      apiKey: "",
      device: "",
    });
  });

  it("ignores a speak.json that is not an object or not JSON", () => {
    const home = tmp("listen-cfg-bad-");
    plantSpeak(home, "[1]");
    expect(cfgFor(home).stt).toBe("auto");
    plantSpeak(home, "{nope");
    expect(cfgFor(home).stt).toBe("auto");
    plantSpeak(home, { openai: 4, listen: "x" });
    expect(cfgFor(home).apiKey).toBe("");
  });
});

describe("findWhisperBin", () => {
  it("tries whisper-cli then whisper-cpp and forwards PATH and platform", () => {
    const seen: unknown[][] = [];
    const which = (name: string, pathEnv?: string, platform?: string) => {
      seen.push([name, pathEnv, platform]);
      return name === "whisper-cpp" ? "/x/whisper-cpp" : "";
    };
    expect(findWhisperBin(which, "/p", "darwin")).toBe("/x/whisper-cpp");
    expect(seen).toEqual([
      ["whisper-cli", "/p", "darwin"],
      ["whisper-cpp", "/p", "darwin"],
    ]);
    expect(findWhisperBin(whichMap(), undefined, "linux")).toBe("");
  });
});

describe("findWhisperModel", () => {
  it("searches cwd/models, then home/models, ignoring a blank cwd", () => {
    const home = tmp("listen-fm-h-");
    const cwd = tmp("listen-fm-c-");
    const cfg = cfgFor(home);
    expect(findWhisperModel({ cfg, home, cwd })).toBe("");
    const inCwd = path.join(cwd, "models", "ggml-base.en.bin");
    plantModel(inCwd);
    expect(findWhisperModel({ cfg, home, cwd })).toBe(inCwd);
    expect(findWhisperModel({ cfg, home, cwd: "" })).toBe("");
    const inHome = path.join(home, "models", "ggml-base.en.bin");
    plantModel(inHome);
    expect(findWhisperModel({ cfg, home, cwd })).toBe(inHome);
  });

  it("prefers the configured path but never accepts a directory", () => {
    const home = tmp("listen-fm2-h-");
    const cwd = tmp("listen-fm2-c-");
    const cfg = cfgFor(home);
    plantModel(path.join(home, "models", "ggml-base.en.bin"));
    const explicit = path.join(cwd, "custom.bin");
    fs.writeFileSync(explicit, "x");
    expect(findWhisperModel({ cfg: { ...cfg, whisperModel: explicit }, home, cwd })).toBe(explicit);
    expect(findWhisperModel({ cfg: { ...cfg, whisperModel: cwd }, home, cwd })).toBe(
      path.join(home, "models", "ggml-base.en.bin"),
    );
  });
});

describe("probeStt", () => {
  const bins = whichMap({ "whisper-cli": "/usr/bin/whisper-cli" });

  it("forced local needs both the binary and a model", () => {
    const home = tmp("listen-sel-l-");
    const cfg = cfgFor(home, { LISTEN_STT: "local", OPENAI_API_KEY: "k" });
    expect(probeStt(sttFor(home, { cfg, whichFn: bins }))).toBeNull();
    plantModel(path.join(home, ".workerstack", "whisper", "ggml-base.en.bin"));
    expect(probeStt(sttFor(home, { cfg, whichFn: bins }))).toMatchObject({
      kind: "local",
      bin: "/usr/bin/whisper-cli",
    });
  });

  it("forced openai needs a key", () => {
    const home = tmp("listen-sel-o-");
    expect(probeStt(sttFor(home, { cfg: cfgFor(home, { LISTEN_STT: "openai" }) }))).toBeNull();
  });

  it("auto picks openai when it is the only engine, and nothing when there is none", () => {
    const home = tmp("listen-sel-a-");
    expect(probeStt(sttFor(home))).toBeNull();
    const cfg = cfgFor(home, { OPENAI_API_KEY: "k" });
    expect(probeStt(sttFor(home, { cfg }))).toEqual({ kind: "openai", model: DEFAULT_MODEL });
  });
});

describe("resolveStt", () => {
  const bins = whichMap({ "whisper-cli": "/usr/bin/whisper-cli" });
  const home = "/nonexistent-home";

  it("names a missing engine, or a missing model when the binary exists", () => {
    expect(() => resolveStt(sttFor(home))).toThrow(NEED_STT);
    expect(() => resolveStt(sttFor(home, { whichFn: bins }))).toThrow(NEED_GGML);
  });

  it("names the model when local is forced, and the key when openai is forced", () => {
    const local = cfgFor(home, { LISTEN_STT: "local" });
    expect(() => resolveStt(sttFor(home, { cfg: local }))).toThrow(NEED_GGML);
    const openai = cfgFor(home, { LISTEN_STT: "openai" });
    expect(() => resolveStt(sttFor(home, { cfg: openai, whichFn: bins }))).toThrow(NEED_OPENAI);
  });

  it("returns the openai engine when a key exists", () => {
    const cfg = cfgFor(home, { OPENAI_API_KEY: "k" });
    expect(resolveStt(sttFor(home, { cfg }))).toMatchObject({ kind: "openai" });
  });
});

describe("downloadGgml failures", () => {
  it("reports a failed download by status, or err when there is none", async () => {
    const home = tmp("listen-dlerr-");
    await expect(downloadGgml({ home, fetchFn: reply({ ok: false, status: 500 }) })).rejects.toThrow(/\(500\)/);
    await expect(downloadGgml({ home, fetchFn: reply({}) })).rejects.toThrow(/\(err\)/);
    expect(fs.existsSync(defaultGgmlPath(home))).toBe(false);
  });

  it("rejects an empty body and a response with no body reader", async () => {
    const home = tmp("listen-dlempty-");
    const empty = reply({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
    await expect(downloadGgml({ home, fetchFn: empty })).rejects.toThrow("ggml download empty");
    await expect(downloadGgml({ home, fetchFn: reply({ ok: true }) })).rejects.toThrow("ggml download empty");
  });
});

describe("downloadGgml success", () => {
  it("writes the model, copying a typed-array body, and logs the destination", async () => {
    const home = tmp("listen-dlok-");
    const errs: string[] = [];
    const log = { error: (m: string) => errs.push(m) };
    const dest = await downloadGgml({ home, fetchFn: bytesReply([1, 2, 3]), log });
    expect([...fs.readFileSync(dest)]).toEqual([1, 2, 3]);
    expect(errs[0]).toContain(dest);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it("uses the global fetch when none is passed", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(url);
      return bytesReply([9])(url, {});
    });
    try {
      await downloadGgml({ home: tmp("listen-dlglobal-") });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(urls).toEqual([GGML_URL]);
  });
});

describe("ensureStt", () => {
  const bins = whichMap({ "whisper-cli": "/usr/bin/whisper-cli" });
  const failing = reply({ ok: false, status: 503 });

  it("rethrows a failed download when local is forced or no key exists", async () => {
    const h1 = tmp("listen-ens1-");
    const forced = cfgFor(h1, { LISTEN_STT: "local", OPENAI_API_KEY: "k" });
    await expect(ensureStt(sttFor(h1, { cfg: forced, whichFn: bins, fetchFn: failing }))).rejects.toThrow(/503/);
    const h2 = tmp("listen-ens2-");
    await expect(ensureStt(sttFor(h2, { whichFn: bins, fetchFn: failing }))).rejects.toThrow(/503/);
  });

  it("downloads the model and returns the local engine", async () => {
    const h3 = tmp("listen-ens3-");
    const stt = await ensureStt(sttFor(h3, { whichFn: bins, fetchFn: bytesReply([7]) }));
    expect(stt).toMatchObject({ kind: "local", model: defaultGgmlPath(h3) });
  });

  it("never downloads when openai is forced or no whisper binary exists", async () => {
    const h1 = tmp("listen-ensn1-");
    const fetchFn = () => Promise.reject(new Error("must not fetch"));
    const cfg = cfgFor(h1, { LISTEN_STT: "openai", OPENAI_API_KEY: "k" });
    expect(await ensureStt(sttFor(h1, { cfg, whichFn: bins, fetchFn }))).toMatchObject({ kind: "openai" });
    await expect(ensureStt(sttFor(h1, { fetchFn }))).rejects.toThrow(NEED_STT);
  });
});

describe("paths", () => {
  it("listenDir lives under the repo root, whatever the depth", () => {
    const { r, a } = gitRepoWithPkg("listen-paths-");
    expect(sessionPath(a)).toBe(path.join(r, ".tmp/repo/listen/session.json"));
    expect(latestPath(a)).toBe(path.join(r, ".tmp/repo/listen/latest.txt"));
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
    expect(ffmpegInputArgs("linux", "hw:0", "pulse")).toEqual(["-f", "pulse", "-i", "hw:0"]);
    expect(ffmpegInputArgs("win32", "audio=Mic", "")).toEqual(["-f", "dshow", "-i", "audio=Mic"]);
  });

  it("a timed recording carries -t and -nostdin, with the seconds clamped", () => {
    const base = { platform: "linux", device: "", out: "/o.wav", ffmpegFormat: "" } as const;
    const timed = ffmpegRecordArgs({ ...base, seconds: 999 });
    expect(timed).toContain("-nostdin");
    expect(timed.slice(timed.indexOf("-t"), timed.indexOf("-t") + 2)).toEqual(["-t", "120"]);
    expect(timed.at(-1)).toBe("/o.wav");
  });

  it("an open-ended recording carries neither", () => {
    const open = ffmpegRecordArgs({
      platform: "linux",
      device: "",
      out: "/o.wav",
      seconds: undefined,
      ffmpegFormat: "",
    });
    expect(open).not.toContain("-nostdin");
    expect(open).not.toContain("-t");
  });

  it("recCaptureOpts sends stderr to the given fd, or ignores it", () => {
    expect(recCaptureOpts(7).stdio).toEqual(["ignore", "ignore", 7]);
    expect(recCaptureOpts(null).stdio).toEqual(["ignore", "ignore", "ignore"]);
    expect(recCaptureOpts().stdio).toEqual(["ignore", "ignore", "ignore"]);
  });
});

type Handler = (a?: unknown, b?: unknown) => void;

function fakeChild(over: Partial<ChildLike> = {}) {
  const on: Record<string, Handler> = {};
  const child: ChildLike = {
    pid: 321,
    on(ev: string, cb: Handler) {
      on[ev] = cb;
    },
    ...over,
  };
  return { child, on };
}

function capture(child: ChildLike, killFn: (pid: number, sig: string | number) => unknown = () => undefined) {
  return recCapture({ bin: "ffmpeg", args: [], seconds: 5, spawnFn: () => child, killFn, errFd: null });
}

describe("recCapture outcome", () => {
  it("reports the exit code and signal", async () => {
    const a = fakeChild();
    const pa = capture(a.child);
    a.on.exit?.(0, null);
    expect(await pa).toMatchObject({ status: 0, signal: null, error: null });
    const b = fakeChild();
    const pb = capture(b.child);
    b.on.exit?.(undefined, "SIGTERM");
    expect(await pb).toMatchObject({ status: null, signal: "SIGTERM" });
    const c = fakeChild();
    const pc = capture(c.child);
    c.on.exit?.(2, 5);
    expect(await pc).toMatchObject({ status: 2, signal: null });
  });

  it("reports a spawn error and ignores a later exit", async () => {
    const a = fakeChild();
    const p = capture(a.child);
    const err = new Error("ENOENT");
    a.on.error?.(err);
    a.on.exit?.(0, null);
    expect(await p).toMatchObject({ status: null, error: err });
  });

  it("treats a child with no event API as finished", async () => {
    expect(await capture({ pid: 1 })).toMatchObject({ status: 0, error: null });
  });
});

const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
const throwing = () => {
  throw new Error("EPERM");
};

describe("recCapture timeout", () => {
  it("kills the process group and reports ETIMEDOUT", async () => {
    fakeTimers();
    const killed: Array<[number, string | number]> = [];
    const p = capture(fakeChild().child, (pid, sig) => killed.push([pid, sig]));
    vi.advanceTimersByTime(7001);
    expect(await p).toMatchObject({ status: null, signal: "SIGKILL", error: { code: "ETIMEDOUT" } });
    expect(killed).toEqual([[-321, "SIGKILL"]]);
  });

  it("falls back to child.kill when the group kill throws", async () => {
    fakeTimers();
    const signals: unknown[] = [];
    const p = capture(fakeChild({ kill: (sig) => signals.push(sig) }).child, throwing);
    vi.advanceTimersByTime(7001);
    expect((await p).signal).toBe("SIGKILL");
    expect(signals).toEqual(["SIGKILL"]);
  });

  it("survives child.kill failing too, and skips the group kill without a pid", async () => {
    fakeTimers();
    const both = capture(fakeChild({ kill: throwing }).child, throwing);
    const kills: unknown[] = [];
    const noPid = capture(fakeChild({ pid: undefined }).child, (...args) => kills.push(args));
    vi.advanceTimersByTime(7001);
    expect((await both).error).toMatchObject({ code: "ETIMEDOUT" });
    await noPid;
    expect(kills).toEqual([]);
  });
});

describe("pidAlive", () => {
  it("is false for a non-positive or non-numeric pid without probing", () => {
    const probed: unknown[] = [];
    const kill = (p: number) => probed.push(p);
    expect(pidAlive("abc", kill)).toBe(false);
    expect(pidAlive(0, kill)).toBe(false);
    expect(pidAlive(-4, kill)).toBe(false);
    expect(probed).toEqual([]);
  });

  it("probes with signal 0 and maps a throw to false", () => {
    const sigs: unknown[] = [];
    expect(pidAlive("12", (_p, s) => sigs.push(s))).toBe(true);
    expect(sigs).toEqual([0]);
    const gone = () => {
      throw new Error("ESRCH");
    };
    expect(pidAlive(12, gone)).toBe(false);
  });
});

function wavIn(prefix: string): string {
  const wav = path.join(tmp(prefix), "a.wav");
  fs.writeFileSync(wav, "RIFF");
  return wav;
}

function localRun(file: string, r: SpawnSyncResult | ((args: string[]) => SpawnSyncResult)) {
  const spawnSyncFn = (_cmd: string, args: string[]) => (typeof r === "function" ? r(args) : r);
  return transcribeLocal({ file, bin: "whisper-cli", model: "/m.bin", spawnSyncFn });
}

function writeTxt(args: string[], content: string) {
  fs.writeFileSync(`${args[args.indexOf("-of") + 1]}.txt`, content);
}

describe("transcribeLocal output", () => {
  it("rejects a missing file", () => {
    const missing = path.join(tmp("listen-tl0-"), "none.wav");
    expect(() => localRun(missing, { status: 0 })).toThrow("transcribe needs an audio file");
  });

  it("reads and removes the .txt the binary wrote, passing the model and file", () => {
    const wav = wavIn("listen-tl1-");
    let argv: string[] = [];
    const text = localRun(wav, (args) => {
      argv = args;
      writeTxt(args, "  hi there \n");
      return { status: 0 };
    });
    expect(text).toBe("hi there");
    expect(argv.slice(0, 4)).toEqual(["-m", "/m.bin", "-f", wav]);
    expect(fs.readdirSync(path.dirname(wav))).toEqual(["a.wav"]);
  });
});

describe("transcribeLocal fallbacks", () => {
  it("falls back to stdout when the .txt is empty or absent", () => {
    const wav = wavIn("listen-tl2-");
    const blank = (args: string[]): SpawnSyncResult => {
      writeTxt(args, "  \n");
      return { status: 0, stdout: " from stdout " };
    };
    expect(localRun(wav, blank)).toBe("from stdout");
    expect(localRun(wav, { status: 0, stdout: Buffer.from("buf out") })).toBe("buf out");
  });

  it("throws the binary's stderr, or a default, when there is no text", () => {
    const wav = wavIn("listen-tl3-");
    expect(() => localRun(wav, { status: 1, stderr: "model corrupt" })).toThrow("model corrupt");
    expect(() => localRun(wav, { status: 1 })).toThrow("whisper-cli failed");
  });
});

function transcribeWith(over: Partial<Parameters<typeof transcribe>[0]>) {
  const cfg = { ...cfgFor(tmp("listen-tr-h-"), { OPENAI_API_KEY: "sk" }), model: "m-1" };
  const noSpawn = () => {
    throw new Error("no spawn");
  };
  const file = wavIn("listen-tr-");
  const stt: Stt = { kind: "openai", model: "m-1" };
  return transcribe({ file, cfg, stt, fetchFn: jsonReply({}), spawnSyncFn: noSpawn, ...over });
}

describe("transcribe request", () => {
  it("rejects a missing file", async () => {
    await expect(transcribeWith({ file: "/nonexistent/x.wav" })).rejects.toThrow("transcribe needs an audio file");
  });

  it("routes a local engine to the binary", async () => {
    const out = await transcribeWith({
      stt: { kind: "local", bin: "w", model: "/m" },
      spawnSyncFn: () => ({ status: 0, stdout: "local text" }),
    });
    expect(out).toBe("local text");
  });

  it("needs a key for the API", async () => {
    const cfg = cfgFor(tmp("listen-tr-nokey-"));
    await expect(transcribeWith({ cfg })).rejects.toThrow(NEED_STT);
  });

  it("posts the file and the configured model", async () => {
    const bodies: Array<FormData | undefined> = [];
    const fetchFn: FetchFn = (_url, init) => {
      bodies.push(init.body);
      return jsonReply({ text: "t" })(_url, init);
    };
    await transcribeWith({ fetchFn });
    const file = bodies[0]?.get("file");
    expect(bodies[0]?.get("model")).toBe("m-1");
    expect(file instanceof File && file.name).toBe("a.wav");
  });
});

describe("transcribe response", () => {
  it("reads text from a record, a bare string, or yields an empty transcript", async () => {
    expect(await transcribeWith({ fetchFn: jsonReply({ text: " a " }) })).toBe("a");
    expect(await transcribeWith({ fetchFn: jsonReply("plain") })).toBe("plain");
    expect(await transcribeWith({ fetchFn: jsonReply(7) })).toBe("");
    expect(await transcribeWith({ fetchFn: reply({ ok: true }) })).toBe("");
  });

  it("turns an HTTP failure into an error with the status and body", async () => {
    const body = (status: number, text: string) => reply({ ok: false, status, text: () => Promise.resolve(text) });
    await expect(transcribeWith({ fetchFn: body(500, "boom") })).rejects.toThrow("500 boom");
    await expect(transcribeWith({ fetchFn: body(401, "no") })).rejects.toThrow(/rejected \(401\)/);
    await expect(transcribeWith({ fetchFn: reply({ ok: false }) })).rejects.toThrow("err");
  });

  it("still reports the status when the body cannot be read", async () => {
    const unreadable = reply({ ok: false, status: 502, text: () => Promise.reject(new Error("stream")) });
    await expect(transcribeWith({ fetchFn: unreadable })).rejects.toThrow("502");
  });
});

type ClipCall = { cmd: string; args: string[]; opts: { input?: string; shell?: boolean } };

function clipRecorder(statuses: Record<string, number>) {
  const calls: ClipCall[] = [];
  const spawnSyncFn = (cmd: string, args: string[], opts: ClipCall["opts"]): SpawnSyncResult => {
    calls.push({ cmd, args, opts });
    return { status: statuses[cmd] ?? 1 };
  };
  return { calls, spawnSyncFn };
}

describe("copyClip", () => {
  it("pipes the text to pbcopy on darwin and fails loudly", () => {
    const ok = clipRecorder({ pbcopy: 0 });
    copyClip("hello", { platform: "darwin", ...ok });
    expect(ok.calls).toMatchObject([{ cmd: "pbcopy", opts: { input: "hello" } }]);
    expect(() => copyClip("x", { platform: "darwin", ...clipRecorder({}) })).toThrow("pbcopy failed");
  });

  it("uses clip through a shell on win32", () => {
    const ok = clipRecorder({ clip: 0 });
    copyClip("hello", { platform: "win32", ...ok });
    expect(ok.calls).toMatchObject([{ cmd: "clip", opts: { shell: true, input: "hello" } }]);
    expect(() => copyClip("x", { platform: "win32", ...clipRecorder({}) })).toThrow("clip failed");
  });

  it("tries wl-copy, xclip, then xsel on linux and stops at the first that works", () => {
    const second = clipRecorder({ xclip: 0 });
    copyClip("hello", { platform: "linux", ...second });
    expect(second.calls.map((c) => c.cmd)).toEqual(["wl-copy", "xclip"]);
    expect(second.calls[1]?.args).toEqual(["-selection", "clipboard"]);
    const none = clipRecorder({});
    expect(() => copyClip("x", { platform: "linux", ...none })).toThrow("no wl-copy, xclip, or xsel on PATH");
    expect(none.calls.map((c) => c.cmd)).toEqual(["wl-copy", "xclip", "xsel"]);
  });
});

function devices(platform: NodeJS.Platform, r: SpawnSyncResult) {
  const calls: Array<[string, string[]]> = [];
  const spawnSyncFn = (cmd: string, args: string[]): SpawnSyncResult => {
    calls.push([cmd, args]);
    return r;
  };
  return { list: listDevicesText({ platform, ffmpegBin: "/bin/ffmpeg", spawnSyncFn }), calls };
}

describe("listDevicesText darwin and win32", () => {
  it("needs ffmpeg", () => {
    const spawnSyncFn = () => ({ status: 0 });
    expect(() => listDevicesText({ platform: "linux", ffmpegBin: "", spawnSyncFn })).toThrow(NEED_FFMPEG);
  });

  it("reads avfoundation devices from stderr or stdout", () => {
    const a = devices("darwin", { status: 1, stderr: AV_FIXTURE });
    expect(a.list.map((d) => d.id)).toEqual([":0", ":1"]);
    expect(a.calls[0]?.[1]).toContain("avfoundation");
    expect(devices("darwin", { status: 1, stdout: AV_FIXTURE }).list).toHaveLength(2);
    expect(devices("darwin", { status: 1 }).list).toEqual([]);
  });

  it("reads dshow devices from stderr or stdout", () => {
    const a = devices("win32", { status: 1, stderr: DSHOW_FIXTURE });
    expect(a.list.map((d) => d.id)).toEqual(["Microphone (Realtek Audio)", "Stereo Mix (Realtek Audio)"]);
    expect(a.calls[0]?.[1]).toContain("dshow");
    expect(devices("win32", { status: 1, stdout: DSHOW_FIXTURE }).list).toHaveLength(2);
    expect(devices("win32", { status: 1 }).list).toEqual([]);
  });
});

describe("listDevicesText linux", () => {
  const fallback = [{ id: "default", name: "pulse default" }];

  it("lists pulse sources", () => {
    const ok = devices("linux", { status: 0, stdout: "0\talsa_input.pci\tmodule\n1\talsa_output.monitor\tm\n" });
    expect(ok.list.map((d) => d.id)).toEqual(["alsa_input.pci", "alsa_output.monitor"]);
    expect(ok.calls[0]?.[0]).toBe("pactl");
  });

  it("falls back to the default source when pactl fails or lists nothing", () => {
    expect(devices("linux", { status: 1, stdout: "0\tx" }).list).toEqual(fallback);
    expect(devices("linux", { status: 0, stdout: "  " }).list).toEqual(fallback);
  });
});

describe("parseDevices edges", () => {
  it("tolerates non-string input on linux", () => {
    expect(parseDevices(undefined, "linux")).toEqual([{ id: "default", name: "pulse default" }]);
  });

  it("darwin ignores lines outside the audio section and non-device lines", () => {
    expect(parseDevices("Some audio devices:\n[0] Mic\nnot a device\n", "darwin")).toEqual([{ id: ":0", name: "Mic" }]);
    expect(parseDevices("[0] before any section", "darwin")).toEqual([]);
    expect(parseDevices("AVFoundation audio devices:\nAVFoundation video devices:\n[1] Cam", "darwin")).toEqual([]);
  });

  it("win32 ignores lines outside the audio section and unquoted lines", () => {
    const text = '"before section"\nDirectShow audio devices\n junk\n "A"\nDirectShow video devices\n "V"';
    expect(parseDevices(text, "win32")).toEqual([{ id: "A", name: "A" }]);
  });
});
