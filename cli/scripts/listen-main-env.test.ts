import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { readEnv } from "../env.ts";
import { FFMPEG, failFetch, plantSpeakJson, quiet, run, tmp, which, cleanupTmp } from "./fixtures/listen-env.ts";
import { NEED_STT, USAGE } from "./listen.constants.ts";
import { main } from "./listen.ts";
import type { SpawnSyncResult } from "./listen.types.ts";

afterEach(cleanupTmp);

describe("main with no options", () => {
  it("prints usage to the console and exits 1", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["nope"])).toBe(1);
    expect(err).toHaveBeenCalledWith(USAGE);
  });

  it("falls back to the process home when the environment names none", async () => {
    expect(await main(["nope"], { env: {}, log: quiet })).toBe(1);
  });

  it("prints usage for no verb", async () => {
    const r = await run([]);
    expect(r.code).toBe(1);
    expect(r.errs).toStrictEqual([USAGE]);
  });
});

describe("main home and PATH", () => {
  it("takes the home directory from HOME, then USERPROFILE", async () => {
    const homeA = tmp("listen-hm-a-");
    const homeB = tmp("listen-hm-b-");
    plantSpeakJson(homeA, { listen: { model: "model-a" }, openai: { apiKey: "from-home" } });
    plantSpeakJson(homeB, { listen: { model: "model-b" }, openai: { apiKey: "from-profile" } });
    const logs: string[] = [];
    const log = { error: () => {}, log: (s: string) => logs.push(s) };
    const base = { cwd: tmp("listen-hm-c-"), log, platform: "linux" as const, whichFn: which() };
    await main(["whoami"], { ...base, env: { HOME: homeA, USERPROFILE: homeB } });
    await main(["whoami"], { ...base, env: { USERPROFILE: homeB } });
    expect(logs[0]).toContain("model=model-a");
    expect(logs[1]).toContain("model=model-b");
  });

  it("looks ffmpeg up on the given PATH, else the env PATH, else the process PATH", async () => {
    const seen: Array<string | undefined> = [];
    const whichFn = (_name: string, pathEnv?: string) => {
      seen.push(pathEnv);
      return "";
    };
    const base = { log: quiet, platform: "linux" as const, whichFn };
    await main(["nope"], { ...base, env: { PATH: "/env" }, pathEnv: "/given" });
    await main(["nope"], { ...base, env: { PATH: "/env" } });
    await main(["nope"], { ...base, env: {} });
    expect(seen).toStrictEqual(["/given", "/env", readEnv().PATH]);
  });
});

describe("main options", () => {
  it("--cwd overrides the cwd option", async () => {
    const real = tmp("listen-cwdflag-");
    fs.mkdirSync(path.join(real, ".tmp/repo/listen"), { recursive: true });
    fs.writeFileSync(path.join(real, ".tmp/repo/listen/latest.txt"), "kept\n");
    const r = await run(["latest", "--cwd", real], { cwd: tmp("listen-cwdflag-o-") });
    expect(r.logs).toStrictEqual(["kept"]);
  });

  it.each([
    ["a thrown string", "plain string", "plain string"],
    ["an empty-message error", new Error(""), "Error"],
    ["an error with a message", new Error("with message"), "with message"],
  ])("reports %s", async (_label, thrown, want) => {
    const spawnSyncFn = (): SpawnSyncResult => {
      throw thrown;
    };
    expect((await run(["devices"], { spawnSyncFn })).errs).toStrictEqual([want]);
  });
});

describe("whoami", () => {
  it("prints the openai engine and ffmpeg path", async () => {
    const r = await run(["whoami"]);
    expect(r.code).toBe(0);
    expect(r.logs).toStrictEqual([`stt=openai  model=whisper-1  ffmpeg=${FFMPEG}`]);
  });

  it("prints the local engine once the model exists", async () => {
    const home = tmp("listen-who-l-");
    const model = path.join(home, ".workerstack", "whisper", "ggml-base.en.bin");
    fs.mkdirSync(path.dirname(model), { recursive: true });
    fs.writeFileSync(model, "ggml");
    const r = await run(["whoami"], { home, whichFn: which({ "whisper-cli": "/w/whisper-cli" }) });
    expect(r.code).toBe(0);
    expect(r.logs).toStrictEqual([`stt=local  bin=/w/whisper-cli  model=${model}  ffmpeg=missing`]);
  });

  it("reports no engine, and a failed model download, with exit 1", async () => {
    const whichFn = which({ "whisper-cli": "/w/whisper-cli" });
    const r = await run(["whoami"], { env: {}, fetchFn: failFetch, whichFn });
    expect(r.code).toBe(1);
    expect(r.logs).toStrictEqual(["stt=none  ffmpeg=missing"]);
    expect(r.errs.some((e) => e.startsWith("downloading"))).toBe(true);
    expect(r.errs).toContain(NEED_STT);
  });
});
