import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  GGML_URL,
  USAGE,
  clampSeconds,
  defaultDevice,
  defaultGgmlPath,
  downloadGgml,
  ensureStt,
  ffmpegInputArgs,
  findWhisperModel,
  loadCfg,
  main,
  parseArgv,
  parseDevices,
  probeStt,
  resolveStt,
  sessionPath,
} from "./listen.mjs";

function whichMap(map: Record<string, string> = {}) {
  return (name: string) => map[name] || "";
}

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "listen.mjs");

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
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
    expect(ffmpegInputArgs("darwin", "")).toEqual(["-f", "avfoundation", "-i", ":0"]);
    expect(ffmpegInputArgs("linux", "")).toEqual(["-f", "pulse", "-i", "default"]);
    expect(ffmpegInputArgs("linux", "hw:0")).toEqual(["-f", "alsa", "-i", "hw:0"]);
    expect(ffmpegInputArgs("win32", "Mic")).toEqual(["-f", "dshow", "-i", "audio=Mic"]);
    expect(() => ffmpegInputArgs("win32", "")).toThrow(/LISTEN_DEVICE/);
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
    fs.mkdirSync(path.join(home, ".grunt"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".grunt", "speak.json"),
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
    fs.mkdirSync(path.join(home, ".grunt"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".grunt", "speak.json"),
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
      log: { log() {}, error(s: string) { errs.push(String(s)); } },
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
        log(s: string) { logs.push(String(s)); },
        error(s: string) { errs.push(String(s)); },
      },
    });
    expect(code).toBe(1);
    const all = `${logs.join("\n")}\n${errs.join("\n")}`;
    expect(all).toMatch(/OPENAI_API_KEY|speak\.json|whisper-cli/);
    expect(all).toMatch(/setup: \.rulesync\/reference\/listen\.md/);
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
      log: { log(s: string) { logs.push(String(s)); }, error() {} },
    });
    expect(code).toBe(0);
    expect(posted.url).toMatch(/audio\/transcriptions/);
    expect(posted.headers?.Authorization).toBe("Bearer sk_oa");
    expect(posted.body).toBeInstanceOf(FormData);
    expect(logs.join("\n")).toContain("hello world");
    expect(fs.readFileSync(path.join(cwd, ".tmp/grunt/listen/latest.txt"), "utf8")).toMatch(
      /hello world/,
    );
  });

  it("rec without ffmpeg fails", async () => {
    const errs: string[] = [];
    const code = await main(["rec"], {
      env: { OPENAI_API_KEY: "sk_oa" },
      home: tmp("listen-nff-h-"),
      cwd: tmp("listen-nff-"),
      whichFn: whichMap(),
      platform: "darwin",
      log: { log() {}, error(s: string) { errs.push(String(s)); } },
    });
    expect(code).toBe(1);
    expect(errs.join("\n")).toMatch(/missing ffmpeg/);
    expect(errs.join("\n")).toMatch(/setup: \.rulesync\/reference\/listen\.md/);
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
        const out = args[args.length - 1];
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
      log: { log(s: string) { logs.push(String(s)); }, error() {} },
    });
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("from rec");
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
    const sess = JSON.parse(fs.readFileSync(sessionPath(cwd), "utf8"));
    expect(sess.pid).toBe(4242);
    expect(spawned[0][1]).toBe("_record");
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
      log: { log(s: string) { logs.push(String(s)); }, error() {} },
    });
    expect(codeStop).toBe(0);
    expect(logs.join("\n")).toContain("from stop");
    expect(fs.existsSync(sessionPath(cwd))).toBe(false);
  });

  it("prefers local whisper-cli when bin and ggml model exist", async () => {
    const home = tmp("listen-loc-h-");
    const cwd = tmp("listen-loc-");
    const model = path.join(home, ".grunt", "whisper", "ggml-base.en.bin");
    fs.mkdirSync(path.dirname(model), { recursive: true });
    fs.writeFileSync(model, "ggml");
    const wav = path.join(cwd, "clip.wav");
    fs.writeFileSync(wav, "RIFF");
    const cfg = loadCfg({ env: { OPENAI_API_KEY: "sk_oa" }, home });
    const stt = probeStt({
      cfg,
      whichFn: whichMap({ "whisper-cli": "/usr/bin/whisper-cli" }),
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
      log: { log(s: string) { logs.push(String(s)); }, error() {} },
    });
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("local hello");
  });

  it("LISTEN_STT=openai forces the API", () => {
    const home = tmp("listen-force-");
    const model = path.join(home, ".grunt", "whisper", "ggml-base.en.bin");
    fs.mkdirSync(path.dirname(model), { recursive: true });
    fs.writeFileSync(model, "ggml");
    const cfg = loadCfg({ env: { OPENAI_API_KEY: "sk_oa", LISTEN_STT: "openai" }, home });
    expect(
      probeStt({
        cfg,
        whichFn: whichMap({ "whisper-cli": "/usr/bin/whisper-cli" }),
        home,
      }),
    ).toEqual({ kind: "openai", model: DEFAULT_MODEL });
  });

  it("resolveStt without local or key throws", () => {
    const home = tmp("listen-none-");
    const cfg = loadCfg({ env: {}, home });
    expect(() =>
      resolveStt({ cfg, whichFn: whichMap(), home }),
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
        log(s: string) { logs.push(String(s)); },
        error(s: string) { errs.push(String(s)); },
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
      fetchFn: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }),
    });
    expect(stt).toEqual({ kind: "openai", model: DEFAULT_MODEL });
  });
});

describe("listen cli", () => {
  it("no args prints usage and exits 1", () => {
    const r = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, OPENAI_API_KEY: "" },
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
    const r = spawnSync(process.execPath, [script, "file", "--path", wav], {
      encoding: "utf8",
      cwd,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        OPENAI_API_KEY: "",
        LISTEN_STT: "openai",
        PATH: "/nonexistent-grunt-listen",
      },
      timeout: 15_000,
    });
    expect(r.status).not.toBe(0);
    const out = `${r.stdout}${r.stderr}`;
    expect(out).not.toMatch(/sk_/);
    expect(out).toMatch(/OPENAI_API_KEY|speak\.json|whisper-cli|ggml/);
    expect(out).toMatch(/setup: \.rulesync\/reference\/listen\.md/);
  });
});
