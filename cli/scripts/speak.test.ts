import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { bunPath } from "../../dev/test-paths";
import { childEnv } from "../env.ts";
import { DEFAULT_ELEVEN_VOICE, OPENAI_VOICES, USAGE, loadCfg, main, parseArgv, resolveProvider, say } from "./speak.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoCli = path.join(here, "..", "..", "bin", "repo.ts");

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { force: true, recursive: true });
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
  return { a, r };
}

function fakeRes({
  ok = true,
  status = 200,
  json,
  text,
  buf,
}: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
  buf?: Uint8Array;
}) {
  return {
    arrayBuffer: async () => buf ?? new Uint8Array(),
    json: async () => json,
    ok,
    status,
    text: async () => text ?? JSON.stringify(json ?? ""),
  };
}

describe("parseArgv", () => {
  it("reads verb and flags", () => {
    expect(parseArgv(["say", "--text", "hello", "--provider", "openai"])).toStrictEqual({
      _: ["say"],
      flags: { provider: "openai", text: "hello" },
    });
  });

  it("treats bare --play as set", () => {
    expect(parseArgv(["say", "--text", "hi", "--play"])).toStrictEqual({
      _: ["say"],
      flags: { play: "1", text: "hi" },
    });
  });
});

describe("loadCfg / resolveProvider", () => {
  it("reads env keys and defaults voices", () => {
    const home = tmp("speak-env-");
    const cfg = loadCfg({
      env: { ELEVENLABS_API_KEY: "sk_el", OPENAI_API_KEY: "sk_oa" },
      home,
    });
    expect(cfg.elevenlabs.apiKey).toBe("sk_el");
    expect(cfg.elevenlabs.voiceId).toBe(DEFAULT_ELEVEN_VOICE);
    expect(cfg.openai.apiKey).toBe("sk_oa");
    expect(cfg.openai.voice).toBe("coral");
    expect(resolveProvider(cfg)).toBe("elevenlabs");
    expect(resolveProvider(cfg, "openai")).toBe("openai");
  });

  it("reads ~/.workerstack/speak.json", () => {
    const home = tmp("speak-file-");
    fs.mkdirSync(path.join(home, ".workerstack"), { mode: 0o700, recursive: true });
    fs.writeFileSync(
      path.join(home, ".workerstack", "speak.json"),
      JSON.stringify({
        openai: { apiKey: "from-file", voice: "nova" },
        provider: "openai",
      }),
    );
    const cfg = loadCfg({ env: {}, home });
    expect(cfg.openai.apiKey).toBe("from-file");
    expect(cfg.openai.voice).toBe("nova");
    expect(resolveProvider(cfg)).toBe("openai");
  });

  it("env overrides file key", () => {
    const home = tmp("speak-ov-");
    fs.mkdirSync(path.join(home, ".workerstack"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".workerstack", "speak.json"),
      JSON.stringify({ elevenlabs: { apiKey: "file-key" } }),
    );
    const cfg = loadCfg({ env: { ELEVENLABS_API_KEY: "env-key" }, home });
    expect(cfg.elevenlabs.apiKey).toBe("env-key");
  });

  it("missing key throws", () => {
    const cfg = loadCfg({ env: {}, home: tmp("speak-none-") });
    expect(() => resolveProvider(cfg)).toThrow(/ELEVENLABS_API_KEY or OPENAI_API_KEY/);
  });

  it("rejects unknown provider", () => {
    const cfg = loadCfg({ env: { ELEVENLABS_API_KEY: "x" }, home: tmp("speak-badp-") });
    expect(() => resolveProvider(cfg, "azure")).toThrow(/elevenlabs or openai/);
  });
});

describe("say / main", () => {
  it("writes elevenlabs bytes to --out", async () => {
    const cwd = tmp("speak-say-");
    const dest = path.join(cwd, "out.mp3");
    const cfg = loadCfg({ env: { ELEVENLABS_API_KEY: "sk_el" }, home: tmp("speak-h-") });
    const buf = Buffer.from("ID3fake");
    const destPath = await say({
      cfg,
      cwd,
      fetchFn: async (url: string, init: { method?: string; headers?: Record<string, string> }) => {
        expect(String(url)).toMatch(/text-to-speech\/JBFqnCBsd6RMkjVDRZzb/);
        expect(init.method).toBe("POST");
        expect(init.headers?.["xi-api-key"]).toBe("sk_el");
        return fakeRes({ buf });
      },
      out: dest,
      text: "hello",
    });
    expect(destPath).toBe(dest);
    expect(fs.readFileSync(dest)).toStrictEqual(buf);
  });

  it("saves under the repo root's .tmp/repo/speak from packages/a", async () => {
    const { r, a } = gitRepoWithPkg("speak-sub-");
    const cfg = loadCfg({ env: { OPENAI_API_KEY: "sk_oa" }, home: tmp("speak-sub-h-") });
    const dest = await say({ cfg, cwd: a, fetchFn: async () => fakeRes({ buf: Buffer.from("oa") }), text: "hi" });
    expect(path.dirname(dest)).toBe(path.join(r, ".tmp/repo/speak"));
    expect(fs.readFileSync(dest, "utf8")).toBe("oa");
    expect(fs.existsSync(path.join(a, ".tmp"))).toBe(false);
  });

  it("posts openai speech", async () => {
    const cwd = tmp("speak-oa-");
    const dest = path.join(cwd, "oa.mp3");
    const cfg = loadCfg({ env: { OPENAI_API_KEY: "sk_oa" }, home: tmp("speak-oh-") });
    await say({
      cfg,
      cwd,
      fetchFn: async (url: string, init: { body?: string; headers?: Record<string, string> }) => {
        expect(String(url)).toMatch(/audio\/speech/);
        expect(init.headers?.Authorization).toBe("Bearer sk_oa");
        const body = JSON.parse(init.body || "{}") as { input?: string; voice?: string };
        expect(body.input).toBe("hi");
        expect(body.voice).toBe("coral");
        return fakeRes({ buf: Buffer.from("oa") });
      },
      out: dest,
      text: "hi",
    });
    expect(fs.readFileSync(dest, "utf8")).toBe("oa");
  });

  it("usage on unknown verb", async () => {
    const errs: string[] = [];
    const code = await main(["nope"], {
      env: {},
      home: tmp("speak-u-"),
      log: {
        error(s: string) {
          errs.push(String(s));
        },
        log() {},
      },
    });
    expect(code).toBe(1);
    expect(errs.join("\n")).toContain(USAGE);
  });

  it("whoami without a key fails and does not print a key", async () => {
    const errs: string[] = [];
    const logs: string[] = [];
    const code = await main(["whoami"], {
      env: {},
      home: tmp("speak-who-"),
      log: {
        error(s: string) {
          errs.push(String(s));
        },
        log(s: string) {
          logs.push(String(s));
        },
      },
    });
    expect(code).toBe(1);
    const all = `${logs.join("\n")}\n${errs.join("\n")}`;
    expect(all).toMatch(/ELEVENLABS_API_KEY|OPENAI_API_KEY|speak\.json/);
    expect(all).toMatch(/setup: bun repo setup speak/);
    expect(all).not.toMatch(/sk_/);
  });

  it("401 does not dump JSON", async () => {
    const errs: string[] = [];
    const code = await main(["say", "--text", "hi"], {
      env: { ELEVENLABS_API_KEY: "sk_bad" },
      fetchFn: async () =>
        fakeRes({
          ok: false,
          status: 401,
          text: '{"detail":{"type":"authentication_error","message":"invalid"}}',
        }),
      home: tmp("speak-401-"),
      log: {
        error(s: string) {
          errs.push(String(s));
        },
        log() {},
      },
    });
    expect(code).toBe(1);
    const msg = errs.join("\n");
    expect(msg).toMatch(/setup: bun repo setup speak/);
    expect(msg).not.toMatch(/authentication_error/);
    expect(msg).not.toContain("sk_bad");
  });

  it("scoped elevenlabs whoami is ok without user_read", async () => {
    const logs: string[] = [];
    const code = await main(["whoami"], {
      env: { ELEVENLABS_API_KEY: "sk_scoped" },
      fetchFn: async () =>
        fakeRes({
          ok: false,
          status: 401,
          text: '{"detail":{"type":"authentication_error","code":"unauthorized","message":"missing the permission user_read","status":"missing_permissions"}}',
        }),
      home: tmp("speak-scope-"),
      log: {
        error() {},
        log(s: string) {
          logs.push(String(s));
        },
      },
    });
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(/elevenlabs\s+ok/);
    expect(logs.join("\n")).not.toMatch(/authentication_error/);
  });

  it("openai voices are local", async () => {
    const logs: string[] = [];
    const code = await main(["voices", "--provider", "openai"], {
      env: { OPENAI_API_KEY: "sk_oa" },
      home: tmp("speak-v-"),
      log: {
        error() {},
        log(s: string) {
          logs.push(String(s));
        },
      },
    });
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain(OPENAI_VOICES[0]);
  });
});

describe("speak cli", () => {
  it("no args prints usage and exits 1", () => {
    const r = spawnSync(bunPath(), [repoCli, "speak"], {
      encoding: "utf8",
      env: childEnv({ ELEVENLABS_API_KEY: "", OPENAI_API_KEY: "", SPEAK_PROVIDER: "" }),
      timeout: 15_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("usage: speak");
  });

  it("whoami without a key exits non-zero and does not print a key", () => {
    const home = tmp("speak-cli-");
    const r = spawnSync(bunPath(), [repoCli, "speak", "whoami"], {
      encoding: "utf8",
      env: childEnv({
        ELEVENLABS_API_KEY: "",
        HOME: home,
        OPENAI_API_KEY: "",
        SPEAK_PROVIDER: "",
      }),
      timeout: 15_000,
    });
    expect(r.status).not.toBe(0);
    const out = `${r.stdout}${r.stderr}`;
    expect(out).not.toMatch(/sk_/);
    expect(out).toMatch(/ELEVENLABS_API_KEY|OPENAI_API_KEY|speak\.json/);
    expect(out).toMatch(/setup: bun repo setup speak/);
  });
});
