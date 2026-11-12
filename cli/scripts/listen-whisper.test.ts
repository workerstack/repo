import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cfgFor, cleanupTmp, plantModel, sttFor, tmp, which } from "./__fixtures__/listen-env.ts";
import { findWhisperBin, findWhisperModel, formatHttpError, probeStt, resolveStt } from "./listen-whisper.ts";
import { DEFAULT_MODEL, NEED_GGML, NEED_OPENAI, NEED_STT } from "./listen.constants.ts";

afterEach(cleanupTmp);

const bins = which({ "whisper-cli": "/usr/bin/whisper-cli" });

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

describe("findWhisperBin", () => {
  it("tries whisper-cli then whisper-cpp and forwards PATH and platform", () => {
    const seen: unknown[][] = [];

    function whichFn(name: string, pathEnv?: string, platform?: string) {
      seen.push([name, pathEnv, platform]);

      return name === "whisper-cpp" ? "/x/whisper-cpp" : "";
    }

    expect(findWhisperBin(whichFn, "/p", "darwin")).toBe("/x/whisper-cpp");
    expect(seen).toStrictEqual([
      ["whisper-cli", "/p", "darwin"],
      ["whisper-cpp", "/p", "darwin"],
    ]);
    expect(findWhisperBin(which({}), undefined, "linux")).toBe("");
  });
});

describe("findWhisperModel", () => {
  it("searches cwd/models, then home/models, ignoring a blank cwd", () => {
    const home = tmp("listen-fm-h-");
    const cwd = tmp("listen-fm-c-");
    const cfg = cfgFor(home);
    expect(findWhisperModel({ cfg, cwd, home })).toBe("");
    const inCwd = path.join(cwd, "models", "ggml-base.en.bin");
    plantModel(inCwd);
    expect(findWhisperModel({ cfg, cwd, home })).toBe(inCwd);
    expect(findWhisperModel({ cfg, cwd: "", home })).toBe("");
    const inHome = path.join(home, "models", "ggml-base.en.bin");
    plantModel(inHome);
    expect(findWhisperModel({ cfg, cwd, home })).toBe(inHome);
  });

  it("prefers the configured path but never accepts a directory", () => {
    const home = tmp("listen-fm2-h-");
    const cwd = tmp("listen-fm2-c-");
    const cfg = cfgFor(home);
    plantModel(path.join(home, "models", "ggml-base.en.bin"));
    const explicit = path.join(cwd, "custom.bin");
    fs.writeFileSync(explicit, "x");
    expect(findWhisperModel({ cfg: { ...cfg, whisperModel: explicit }, cwd, home })).toBe(explicit);
    expect(findWhisperModel({ cfg: { ...cfg, whisperModel: cwd }, cwd, home })).toBe(
      path.join(home, "models", "ggml-base.en.bin"),
    );
  });
});

describe("probeStt", () => {
  it("forced local needs both the binary and a model", () => {
    const home = tmp("listen-sel-l-");
    const cfg = cfgFor(home, { LISTEN_STT: "local", OPENAI_API_KEY: "k" });
    expect(probeStt(sttFor(home, { cfg, whichFn: bins }))).toBeNull();
    plantModel(path.join(home, ".workerstack", "whisper", "ggml-base.en.bin"));
    expect(probeStt(sttFor(home, { cfg, whichFn: bins }))).toMatchObject({
      bin: "/usr/bin/whisper-cli",
      kind: "local",
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
    expect(probeStt(sttFor(home, { cfg }))).toStrictEqual({ kind: "openai", model: DEFAULT_MODEL });
  });
});

describe("probeStt picks", () => {
  it("LISTEN_STT=openai forces the API", () => {
    const home = tmp("listen-force-");
    plantModel(path.join(home, ".workerstack", "whisper", "ggml-base.en.bin"));
    const cfg = cfgFor(home, { LISTEN_STT: "openai", OPENAI_API_KEY: "sk_oa" });
    expect(probeStt(sttFor(home, { cfg, whichFn: bins }))).toStrictEqual({ kind: "openai", model: DEFAULT_MODEL });
  });

  it("prefers local whisper-cli when bin and ggml model exist", () => {
    const home = tmp("listen-loc-h-");
    const cwd = tmp("listen-loc-");
    const model = path.join(home, ".workerstack", "whisper", "ggml-base.en.bin");
    plantModel(model);
    const cfg = cfgFor(home, { OPENAI_API_KEY: "sk_oa" });
    const stt = probeStt(sttFor(home, { cfg, cwd, whichFn: bins }));
    expect(stt).toStrictEqual({ bin: "/usr/bin/whisper-cli", kind: "local", model: path.resolve(model) });
    expect(findWhisperModel({ cfg, cwd, home })).toBe(path.resolve(model));
  });
});

describe("resolveStt", () => {
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

  it("without local or key throws", () => {
    const h = tmp("listen-none-");
    expect(() => resolveStt(sttFor(h))).toThrow(/whisper-cli|OPENAI_API_KEY/);
  });
});
