import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { USAGE, main } from "./speak.ts";
import type { FetchFn } from "./speak.ts";
import { bytesRes, collector, failRes, fetchReturning, fetchThrowing, okRes, plantDir } from "./fixtures/speak-kit.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const env = { OPENAI_API_KEY: "sk_oa" };
const audio = fetchReturning(bytesRes(new Uint8Array([1, 2])));

it.each([[[]], [["dance"]]])("prints the usage text and exits 1 for no verb or an unknown one (%j)", async (argv) => {
  const c = collector();
  expect(await main(argv, { env, home: plantDir(), log: c.log })).toBe(1);
  expect(c.errs).toStrictEqual([USAGE]);
});

it("matches the verb case-insensitively", async () => {
  const c = collector();
  expect(await main(["VOICES", "--provider", "openai"], { env, home: plantDir(), log: c.log })).toBe(0);
  expect(c.logs[0]).toContain("coral");
});

it("checks the account", async () => {
  const c = collector();
  const fetchFn = fetchReturning(okRes());
  expect(await main(["whoami"], { env, home: plantDir(), fetchFn, log: c.log })).toBe(0);
  expect(c.logs).toStrictEqual(["openai ok"]);
});

it("says text to --out and prints where it went", async () => {
  const dir = plantDir();
  const out = path.join(dir, "x.mp3");
  const c = collector();
  const argv = ["say", "--text", "hi", "--voice", "nova", "--out", out, "--provider", "openai"];
  expect(await main(argv, { env, home: dir, fetchFn: audio, log: c.log })).toBe(0);
  expect(c.logs).toStrictEqual([out]);
  expect([...fs.readFileSync(out)]).toStrictEqual([1, 2]);
});

it("saves under the working directory's repo root and plays through the injected player", async () => {
  const root = fs.realpathSync(plantDir("speak-root-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  const played: string[] = [];
  const c = collector();
  const spawn = (cmd: string, args: string[]) => void played.push(`${cmd} ${args.at(-1)}`);
  const opts = { env, home: plantDir(), cwd: root, fetchFn: audio, log: c.log, spawn };
  expect(await main(["say", "--text", "hi", "--play"], opts)).toBe(0);
  const saved = c.logs[0] ?? "";
  expect(path.dirname(saved)).toBe(path.join(root, ".tmp", "repo", "speak"));
  expect(played.join("").endsWith(saved)).toBe(true);
});

it("reports a failure on stderr and exits 1", async () => {
  const c = collector();
  const fetchFn: FetchFn = fetchReturning(failRes(500, "down"));
  expect(await main(["say", "--text", "hi"], { env, home: plantDir(), fetchFn, log: c.log })).toBe(1);
  expect(c.errs).toStrictEqual(["500 down"]);
});

it.each([
  ["a thrown string", "plain text", "plain text"],
  ["a thrown bare object", {}, "[object Object]"],
])("reports %s", async (_name, thrown, line) => {
  const c = collector();
  await main(["whoami"], { env, home: plantDir(), fetchFn: fetchThrowing(thrown), log: c.log });
  expect(c.errs).toStrictEqual([line]);
});

it("reads the process environment, home, fetch and console when nothing is injected", async () => {
  vi.spyOn(os, "homedir").mockReturnValue(plantDir());
  vi.stubEnv("ELEVENLABS_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "sk_oa");
  vi.stubEnv("SPEAK_PROVIDER", "");
  const seen: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    seen.push(url);
    return Promise.resolve(new Response("{}"));
  });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await main(["whoami"])).toBe(0);
  expect(log).toHaveBeenCalledWith("openai ok");
  expect(seen).toStrictEqual(["https://api.openai.com/v1/models"]);
  expect(await main(["dance"])).toBe(1);
  expect(error).toHaveBeenCalledWith(USAGE);
});
