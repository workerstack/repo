import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { bunPath } from "../../dev/test-paths";
import { childEnv } from "../env.ts";
import { fetchResult } from "./__fixtures__/fetch-result.ts";
import { cleanupTmp, repoBin, run, tmp, which } from "./__fixtures__/listen-env.ts";
import { USAGE } from "./listen.constants.ts";
import type { FetchFn } from "./listen.types.ts";

/** What the fake fetch was posted. */
type Posted = { url?: string; body?: FormData; headers?: Record<string, string> };

afterEach(cleanupTmp);

const bin = repoBin();
const root = path.dirname(path.dirname(bin));
const ffmpegOnly = which({ ffmpeg: "/bin/ffmpeg" });

/** An openai reply body with the transcript `hello world`. */
function helloWorld() {
  return Promise.resolve({ text: "hello world" });
}

/** An openai reply with the transcript `sub hello`. */
function subHello() {
  return Promise.resolve(fetchResult({ json: () => Promise.resolve({ text: "sub hello" }), ok: true, status: 200 }));
}

describe("main usage and keys", () => {
  it("usage on unknown verb", async () => {
    const r = await run(["nope"], { env: {}, whichFn: () => "" });
    expect(r.code).toBe(1);
    expect(r.errs.join("\n")).toContain(USAGE);
  });

  it("file without a key fails and does not print a key", async () => {
    const cwd = tmp("listen-fk-");
    const wav = path.join(cwd, "a.wav");
    fs.writeFileSync(wav, "RIFF");
    const r = await run(["file", "--path", wav], { cwd, env: {}, whichFn: ffmpegOnly });
    expect(r.code).toBe(1);
    const all = `${r.logs.join("\n")}\n${r.errs.join("\n")}`;
    expect(all).toMatch(/OPENAI_API_KEY|speak\.json|whisper-cli/);
    expect(all).toMatch(/setup: bun repo setup listen/);
    expect(all).not.toMatch(/sk_/);
  });
});

describe("main file", () => {
  it("file posts multipart and prints text", async () => {
    const cwd = tmp("listen-file-");
    const wav = path.join(cwd, "clip.wav");
    fs.writeFileSync(wav, "RIFFDATA");
    let posted: Posted = {};

    function fetchFn(url: string, init: Parameters<FetchFn>[1]): ReturnType<FetchFn> {
      posted = { body: init.body, headers: init.headers, url };

      return Promise.resolve(fetchResult({ json: helloWorld, ok: true, status: 200 }));
    }

    const r = await run(["file", "--path", wav], { cwd, fetchFn, whichFn: ffmpegOnly });
    expect(r.code).toBe(0);
    expect(posted.url).toMatch(/audio\/transcriptions/);
    expect(posted.headers?.Authorization).toBe("Bearer sk_oa");
    expect(posted.body).toBeInstanceOf(FormData);
    expect(r.logs.join("\n")).toContain("hello world");
    expect(fs.readFileSync(path.join(cwd, ".repo/tmp/listen/latest.txt"), "utf8")).toMatch(/hello world/);
  });
});

describe("main file at the repo root", () => {
  it("file from packages/a saves the transcript at the repo root and prints its absolute path", async () => {
    const repo = tmp("listen-sub-");
    spawnSync("git", ["init", "-q"], { cwd: repo });
    const a = path.join(repo, "packages", "a");
    fs.mkdirSync(a, { recursive: true });
    const wav = path.join(a, "clip.wav");
    fs.writeFileSync(wav, "RIFFDATA");
    const r = await run(["file", "--path", wav], { cwd: a, fetchFn: subHello, whichFn: ffmpegOnly });
    expect(r.code).toBe(0);
    const latest = path.join(repo, ".repo/tmp/listen/latest.txt");
    expect(fs.readFileSync(latest, "utf8")).toMatch(/sub hello/);
    expect(r.logs).toContain(`transcript=${latest}`);
    expect(fs.existsSync(path.join(a, ".tmp"))).toBe(false);
  });
});

describe("listen cli", () => {
  it("no args prints usage and exits 1", () => {
    const r = spawnSync(bunPath(), [bin, "listen"], {
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
    const env = { HOME: home, LISTEN_STT: "openai", OPENAI_API_KEY: "", USERPROFILE: home };

    const r = spawnSync(bunPath(), [bin, "listen", "file", "--path", wav], {
      cwd,
      encoding: "utf8",
      env: childEnv({ ...env, PATH: "/nonexistent-repo-listen" }),
      timeout: 15_000,
    });

    expect(r.status).not.toBe(0);
    const out = `${r.stdout}${r.stderr}`;
    expect(out).not.toMatch(/sk_/);
    expect(out).toMatch(/OPENAI_API_KEY|speak\.json|whisper-cli|ggml/);
    expect(out).toMatch(/setup: bun repo setup listen/);
  });
});
