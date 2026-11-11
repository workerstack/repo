import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_ELEVEN_MODEL,
  DEFAULT_OPENAI_MODEL,
  NEED_ELEVEN,
  NEED_KEY,
  NEED_OPENAI,
  formatHttpError,
  loadCfg,
  parseArgv,
  resolveProvider,
} from "./speak.ts";
import { cfgOf, plantDir, plantSpeakJson } from "./fixtures/speak-kit.ts";

afterEach(() => vi.restoreAllMocks());

it("formatHttpError: names a missing permission before anything else", () => {
  expect(formatHttpError(401, '{"status":"missing_permissions"}', "elevenlabs")).toBe(
    "elevenlabs key present but missing permission (401). setup: bun repo setup speak",
  );
  expect(formatHttpError("err", "MISSING_PERMISSIONS", "openai")).toContain("(err)");
});

it("formatHttpError: calls a 401, a 403 or an authentication message a rejected key", () => {
  const rejected = "openai key missing or rejected";
  expect(formatHttpError(401, "", "openai")).toContain(rejected);
  expect(formatHttpError(403, "", "openai")).toContain(rejected);
  expect(formatHttpError(500, "Invalid API key", "openai")).toContain(rejected);
  expect(formatHttpError("err", "unauthorized", "openai")).toContain("(err)");
});

it("formatHttpError: keeps status and the first 200 characters of any other body", () => {
  expect(formatHttpError(500, "", "openai")).toBe("500");
  expect(formatHttpError(500, undefined, "openai")).toBe("500");
  expect(formatHttpError(500, "x".repeat(300), "openai")).toBe(`500 ${"x".repeat(200)}`);
});

it("parseArgv: collects positionals, flags, bare flags and everything after --", () => {
  expect(parseArgv(["say", "--text", "hi", "--play", "--voice", "v", "--", "--raw", "x"])).toStrictEqual({
    _: ["say", "--raw", "x"],
    flags: { text: "hi", play: "1", voice: "v" },
  });
});

it("parseArgv: treats a lone -- prefix and non-string input as positionals or nothing", () => {
  expect(parseArgv(["---"]).flags).toStrictEqual({ "-": "1" });
  expect(parseArgv([1, "a", null])).toStrictEqual({ _: ["a"], flags: {} });
  expect(parseArgv("say")).toStrictEqual({ _: [], flags: {} });
});

it("loadCfg: fills the defaults when nothing is configured", () => {
  const cfg = cfgOf({});
  expect(cfg.providerPref).toBe("");
  expect(cfg.elevenlabs).toMatchObject({ apiKey: "", modelId: DEFAULT_ELEVEN_MODEL });
  expect(cfg.openai).toMatchObject({ apiKey: "", model: DEFAULT_OPENAI_MODEL });
});

it("loadCfg: reads every field from the environment, trimmed", () => {
  const cfg = cfgOf({
    SPEAK_PROVIDER: " OpenAI ",
    ELEVENLABS_API_KEY: " ek ",
    ELEVENLABS_VOICE_ID: "ev",
    ELEVENLABS_MODEL_ID: "em",
    OPENAI_API_KEY: "ok",
    OPENAI_TTS_VOICE: "ov",
    OPENAI_TTS_MODEL: "om",
  });
  expect(cfg).toMatchObject({
    providerPref: "openai",
    elevenlabs: { apiKey: "ek", voiceId: "ev", modelId: "em" },
    openai: { apiKey: "ok", voice: "ov", model: "om" },
  });
});

it("loadCfg: reads the nested file fields", () => {
  const home = plantDir();
  plantSpeakJson(home, {
    provider: "ElevenLabs",
    elevenlabs: { apiKey: "fk", voiceId: "fv", modelId: "fm" },
    openai: { apiKey: "ok", voice: "ov", model: "om" },
  });
  expect(loadCfg({ env: {}, home })).toMatchObject({
    providerPref: "elevenlabs",
    elevenlabs: { apiKey: "fk", voiceId: "fv", modelId: "fm" },
    openai: { apiKey: "ok", voice: "ov", model: "om" },
  });
});

it("loadCfg: reads the flat file fields as the elevenlabs fallback", () => {
  const home = plantDir();
  plantSpeakJson(home, { apiKey: "flat", voiceId: "fv", modelId: "fm" });
  expect(loadCfg({ env: {}, home }).elevenlabs).toStrictEqual({ apiKey: "flat", voiceId: "fv", modelId: "fm" });
});

it("loadCfg: ignores a file that is broken, not an object, or has non-object sections", () => {
  for (const content of ["{broken", "[1]", { elevenlabs: "x", openai: 3 }]) {
    const home = plantDir();
    plantSpeakJson(home, content);
    expect(loadCfg({ env: {}, home }).elevenlabs.apiKey).toBe("");
  }
});

it("loadCfg: reads the process environment and the user's home by default", () => {
  const home = plantDir();
  vi.spyOn(os, "homedir").mockReturnValue(home);
  plantSpeakJson(home, { openai: { apiKey: "from-file" } });
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("ELEVENLABS_API_KEY", "from-env");
  const cfg = loadCfg();
  expect(cfg.elevenlabs.apiKey).toBe("from-env");
  expect(cfg.openai.apiKey).toBe("from-file");
});

it("resolveProvider: prefers ElevenLabs, then OpenAI, from whichever key exists", () => {
  expect(resolveProvider(cfgOf({ ELEVENLABS_API_KEY: "a", OPENAI_API_KEY: "b" }))).toBe("elevenlabs");
  expect(resolveProvider(cfgOf({ OPENAI_API_KEY: "b" }))).toBe("openai");
});

it("resolveProvider: honours a flag, then the configured preference, case-insensitively", () => {
  const both = { ELEVENLABS_API_KEY: "a", OPENAI_API_KEY: "b" };
  expect(resolveProvider(cfgOf(both), " OpenAI ")).toBe("openai");
  expect(resolveProvider(cfgOf({ ...both, SPEAK_PROVIDER: "openai" }))).toBe("openai");
  expect(resolveProvider(cfgOf({ ...both, SPEAK_PROVIDER: "openai" }), "elevenlabs")).toBe("elevenlabs");
});

it("resolveProvider: says which key is missing", () => {
  expect(() => resolveProvider(cfgOf({}))).toThrow(NEED_KEY);
  expect(() => resolveProvider(cfgOf({ OPENAI_API_KEY: "b" }), "elevenlabs")).toThrow(NEED_ELEVEN);
  expect(() => resolveProvider(cfgOf({ ELEVENLABS_API_KEY: "a" }), "openai")).toThrow(NEED_OPENAI);
  expect(() => resolveProvider(null)).toThrow(NEED_KEY);
  expect(() => resolveProvider(undefined, "openai")).toThrow(NEED_OPENAI);
  expect(() => resolveProvider(null, "elevenlabs")).toThrow(NEED_ELEVEN);
});

it("resolveProvider: rejects an unknown provider", () => {
  expect(() => resolveProvider(cfgOf({ ELEVENLABS_API_KEY: "a" }), "azure")).toThrow(
    "provider must be elevenlabs or openai",
  );
});
