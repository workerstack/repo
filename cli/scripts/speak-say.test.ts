import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { bytesRes, cfgOf, failRes, fetchReturning, okRes, plantDir } from "./__fixtures__/speak-kit.ts";
import { playPath, say } from "./speak-say.ts";
import type { FetchFn, FetchResult } from "./speak.types.ts";

afterEach(() => vi.unstubAllGlobals());

function eleven() {
  return cfgOf({ ELEVENLABS_API_KEY: "sk_el" });
}

function openai() {
  return cfgOf({ OPENAI_API_KEY: "sk_oa" });
}

function outPath(name = "out.mp3") {
  return path.join(plantDir(), "a", name);
}

async function audioOf(res: FetchResult): Promise<number[]> {
  const dest = await say({ cfg: eleven(), fetchFn: fetchReturning(res), out: outPath(), text: "hi" });

  return [...fs.readFileSync(dest)];
}

it("audio: reads an ArrayBuffer or a typed array", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  expect(await audioOf(bytesRes(bytes.buffer))).toStrictEqual([1, 2, 3]);
  expect(await audioOf(bytesRes(bytes))).toStrictEqual([1, 2, 3]);
});

it("audio: reads a Buffer or a byte array body, and nothing from other bodies", async () => {
  expect(await audioOf(okRes({ body: Buffer.from([4, 5]) }))).toStrictEqual([4, 5]);
  expect(await audioOf(okRes({ body: [6, 7] }))).toStrictEqual([6, 7]);
  expect(await audioOf(okRes({ body: "text" }))).toStrictEqual([]);
});

it("failures: name the status and the body", async () => {
  await expect(audioOf(failRes(500, "down"))).rejects.toThrow("500 down");
  await expect(audioOf({ ok: false })).rejects.toThrow("err");
});

it("failures: survive a missing reply or an unreadable body", async () => {
  const unreadable = { ok: false, status: 502, text: () => Promise.reject(new Error("read")) };
  await expect(audioOf(unreadable)).rejects.toThrow("502");
  const say401 = say({ cfg: openai(), fetchFn: fetchReturning(failRes(401, "")), out: outPath(), text: "hi" });
  await expect(say401).rejects.toThrow("openai key missing or rejected");
  const nothing = say({ cfg: eleven(), fetchFn: fetchReturning(null), out: outPath(), text: "hi" });
  await expect(nothing).rejects.toThrow("err");
});

it("failures: say there is no fetch when the platform has none", async () => {
  vi.stubGlobal("fetch", undefined);
  await expect(say({ cfg: eleven(), out: outPath(), text: "hi" })).rejects.toThrow("fetch is not available");
});

it("fetch: uses the global fetch when none is injected", async () => {
  const seen: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    seen.push(url);

    return Promise.resolve(new Response(new Uint8Array([9])));
  });
  const out = outPath("g.mp3");
  await say({ cfg: openai(), out, text: "hi" });
  expect(seen).toStrictEqual(["https://api.openai.com/v1/audio/speech"]);
  expect([...fs.readFileSync(out)]).toStrictEqual([9]);
});

it("say: needs text", async () => {
  const fetchFn = fetchReturning(bytesRes(new Uint8Array()));
  await expect(say({ cfg: eleven(), fetchFn, text: "  " })).rejects.toThrow("say needs --text");
  await expect(say({ cfg: eleven(), fetchFn })).rejects.toThrow("say needs --text");
});

it("say: sends the chosen voice, escaped, or the configured one", async () => {
  const urls: string[] = [];

  function fetchFn(url: string, init: Parameters<FetchFn>[1]): ReturnType<FetchFn> {
    urls.push(`${url} ${init.body}`);

    return Promise.resolve(bytesRes(new Uint8Array()));
  }

  const out = outPath();
  await say({ cfg: eleven(), fetchFn, out, text: " hi ", voice: "a b/c" });
  await say({ cfg: openai(), fetchFn, out, text: "hi", voice: " " });
  expect(urls[0]).toContain("/text-to-speech/a%20b%2Fc?output_format=mp3_44100_128");
  expect(urls[0]).toContain('"text":"hi"');
  expect(urls[1]).toContain('"voice":"coral"');
});

const spawned: string[][] = [];

afterEach(() => spawned.splice(0));

function sayPlaying({ play, out }: { play: boolean | string | undefined; out: string }) {
  return say({
    cfg: eleven(),
    fetchFn: fetchReturning(bytesRes(new Uint8Array([1]))),
    out,
    play,
    spawn: (cmd, args) => void spawned.push([cmd, ...args]),
    text: "hi",
  });
}

it.each([undefined, false, "0", "no"])("play: does not play for %s", async (play) => {
  await sayPlaying({ out: outPath(), play });
  expect(spawned).toStrictEqual([]);
});

it.each([true, "true", "1"])("play: plays the saved file for %s", async (play) => {
  const out = outPath();
  await sayPlaying({ out, play });
  expect(spawned.map((call) => call.at(-1))).toStrictEqual([out]);
});

it("play: builds the player command for mac and everything else", () => {
  const calls: [string, string[], unknown][] = [];

  function spy(cmd: string, args: string[], opts: { stdio: "ignore" }) {
    return void calls.push([cmd, args, opts]);
  }

  playPath("/a.mp3", spy, "darwin");
  playPath("/a.mp3", spy, "linux");
  expect(calls).toStrictEqual([
    ["afplay", ["/a.mp3"], { stdio: "ignore" }],
    ["ffplay", ["-nodisp", "-autoexit", "/a.mp3"], { stdio: "ignore" }],
  ]);
});

it("play: uses this platform's player by default", () => {
  const calls: string[] = [];
  playPath("/a.mp3", (cmd) => void calls.push(cmd));
  expect(calls).toStrictEqual([process.platform === "darwin" ? "afplay" : "ffplay"]);
});

it("say: writes elevenlabs bytes to --out", async () => {
  const cwd = plantDir("speak-say-");
  const dest = path.join(cwd, "out.mp3");
  const buf = Buffer.from("ID3fake");

  function fetchFn(url: string, init: Parameters<FetchFn>[1]): ReturnType<FetchFn> {
    expect(url).toMatch(/text-to-speech\/JBFqnCBsd6RMkjVDRZzb/);
    expect(init.method).toBe("POST");
    expect(init.headers["xi-api-key"]).toBe("sk_el");

    return Promise.resolve(bytesRes(buf));
  }

  expect(await say({ cfg: eleven(), cwd, fetchFn, out: dest, text: "hello" })).toBe(dest);
  expect(fs.readFileSync(dest)).toStrictEqual(buf);
});

it("say: saves under the repo root's .tmp/repo/speak from packages/a", async () => {
  const r = fs.realpathSync(plantDir("speak-sub-"));
  spawnSync("git", ["init", "-q"], { cwd: r });
  const a = path.join(r, "packages", "a");
  fs.mkdirSync(a, { recursive: true });
  const dest = await say({ cfg: openai(), cwd: a, fetchFn: fetchReturning(bytesRes(Buffer.from("oa"))), text: "hi" });
  expect(path.dirname(dest)).toBe(path.join(r, ".tmp/repo/speak"));
  expect(fs.readFileSync(dest, "utf8")).toBe("oa");
  expect(fs.existsSync(path.join(a, ".tmp"))).toBe(false);
});

function openaiSpeechFetch(url: string, init: Parameters<FetchFn>[1]): ReturnType<FetchFn> {
  expect(url).toMatch(/audio\/speech/);
  expect(init.headers.Authorization).toBe("Bearer sk_oa");
  const body: unknown = JSON.parse(init.body ?? "{}");
  expect(body).toMatchObject({ input: "hi", voice: "coral" });

  return Promise.resolve(bytesRes(Buffer.from("oa")));
}

it("say: posts openai speech", async () => {
  const cwd = plantDir("speak-oa-");
  const dest = path.join(cwd, "oa.mp3");
  await say({ cfg: openai(), cwd, fetchFn: openaiSpeechFetch, out: dest, text: "hi" });
  expect(fs.readFileSync(dest, "utf8")).toBe("oa");
});
