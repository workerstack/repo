import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { playPath, say } from "./speak.ts";
import type { FetchFn, FetchResult } from "./speak.ts";
import { bytesRes, cfgOf, failRes, fetchReturning, okRes, plantDir } from "./fixtures/speak-kit.ts";

afterEach(() => vi.unstubAllGlobals());

const eleven = () => cfgOf({ ELEVENLABS_API_KEY: "sk_el" });
const openai = () => cfgOf({ OPENAI_API_KEY: "sk_oa" });
const outPath = (name = "out.mp3") => path.join(plantDir(), "a", name);

async function audioOf(res: FetchResult): Promise<number[]> {
  const dest = await say({ text: "hi", out: outPath(), cfg: eleven(), fetchFn: fetchReturning(res) });
  return [...fs.readFileSync(dest)];
}

it("audio: reads an ArrayBuffer or a typed array", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  expect(await audioOf(bytesRes(bytes.buffer))).toEqual([1, 2, 3]);
  expect(await audioOf(bytesRes(bytes))).toEqual([1, 2, 3]);
});

it("audio: reads a Buffer or a byte array body, and nothing from other bodies", async () => {
  expect(await audioOf(okRes({ body: Buffer.from([4, 5]) }))).toEqual([4, 5]);
  expect(await audioOf(okRes({ body: [6, 7] }))).toEqual([6, 7]);
  expect(await audioOf(okRes({ body: "text" }))).toEqual([]);
});

it("failures: name the status and the body", async () => {
  await expect(audioOf(failRes(500, "down"))).rejects.toThrow("500 down");
  await expect(audioOf({ ok: false })).rejects.toThrow("err");
});

it("failures: survive a missing reply or an unreadable body", async () => {
  const unreadable = { ok: false, status: 502, text: () => Promise.reject(new Error("read")) };
  await expect(audioOf(unreadable)).rejects.toThrow("502");
  const say401 = say({ text: "hi", out: outPath(), cfg: openai(), fetchFn: fetchReturning(failRes(401, "")) });
  await expect(say401).rejects.toThrow("openai key missing or rejected");
  const nothing = say({ text: "hi", out: outPath(), cfg: eleven(), fetchFn: fetchReturning(null) });
  await expect(nothing).rejects.toThrow("err");
});

it("failures: say there is no fetch when the platform has none", async () => {
  vi.stubGlobal("fetch", undefined);
  await expect(say({ text: "hi", out: outPath(), cfg: eleven() })).rejects.toThrow("fetch is not available");
});

it("fetch: uses the global fetch when none is injected", async () => {
  const seen: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    seen.push(url);
    return Promise.resolve(new Response(new Uint8Array([9])));
  });
  const out = outPath("g.mp3");
  await say({ text: "hi", out, cfg: openai() });
  expect(seen).toEqual(["https://api.openai.com/v1/audio/speech"]);
  expect([...fs.readFileSync(out)]).toEqual([9]);
});

it("say: needs text", async () => {
  const fetchFn = fetchReturning(bytesRes(new Uint8Array()));
  await expect(say({ text: "  ", cfg: eleven(), fetchFn })).rejects.toThrow("say needs --text");
  await expect(say({ cfg: eleven(), fetchFn })).rejects.toThrow("say needs --text");
});

it("say: sends the chosen voice, escaped, or the configured one", async () => {
  const urls: string[] = [];
  const fetchFn: FetchFn = (url, init) => {
    urls.push(`${url} ${init.body}`);
    return Promise.resolve(bytesRes(new Uint8Array()));
  };
  const out = outPath();
  await say({ text: " hi ", voice: "a b/c", out, cfg: eleven(), fetchFn });
  await say({ text: "hi", voice: " ", out, cfg: openai(), fetchFn });
  expect(urls[0]).toContain("/text-to-speech/a%20b%2Fc?output_format=mp3_44100_128");
  expect(urls[0]).toContain('"text":"hi"');
  expect(urls[1]).toContain('"voice":"coral"');
});

const spawned: string[][] = [];
afterEach(() => spawned.splice(0));
const sayPlaying = (play: boolean | string | undefined, out: string) =>
  say({
    text: "hi",
    out,
    cfg: eleven(),
    fetchFn: fetchReturning(bytesRes(new Uint8Array([1]))),
    play,
    spawn: (cmd, args) => void spawned.push([cmd, ...args]),
  });

it.each([undefined, false, "0", "no"])("play: does not play for %s", async (play) => {
  await sayPlaying(play, outPath());
  expect(spawned).toEqual([]);
});

it.each([true, "true", "1"])("play: plays the saved file for %s", async (play) => {
  const out = outPath();
  await sayPlaying(play, out);
  expect(spawned.map((call) => call.at(-1))).toEqual([out]);
});

it("play: builds the player command for mac and everything else", () => {
  const calls: [string, string[], unknown][] = [];
  const spy = (cmd: string, args: string[], opts: { stdio: "ignore" }) => void calls.push([cmd, args, opts]);
  playPath("/a.mp3", spy, "darwin");
  playPath("/a.mp3", spy, "linux");
  expect(calls).toEqual([
    ["afplay", ["/a.mp3"], { stdio: "ignore" }],
    ["ffplay", ["-nodisp", "-autoexit", "/a.mp3"], { stdio: "ignore" }],
  ]);
});

it("play: uses this platform's player by default", () => {
  const calls: string[] = [];
  playPath("/a.mp3", (cmd) => void calls.push(cmd));
  expect(calls).toEqual([process.platform === "darwin" ? "afplay" : "ffplay"]);
});
