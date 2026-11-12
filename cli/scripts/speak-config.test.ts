import os from "node:os";

import { afterEach, expect, it, vi } from "vitest";

import { cfgOf, plantDir, plantSpeakJson } from "./__fixtures__/speak-kit.ts";
import { formatHttpError } from "./speak-api.ts";
import { loadCfg, resolveProvider } from "./speak-config.ts";
import {
  DEFAULT_ELEVEN_MODEL,
  DEFAULT_ELEVEN_VOICE,
  DEFAULT_OPENAI_MODEL,
  NEED_ELEVEN,
  NEED_KEY,
  NEED_OPENAI,
} from "./speak.constants.ts";

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

it("loadCfg: fills the defaults when nothing is configured", () => {
  const cfg = cfgOf({});
  expect(cfg.providerPref).toBe("");
  expect(cfg.elevenlabs).toMatchObject({ apiKey: "", modelId: DEFAULT_ELEVEN_MODEL });
  expect(cfg.openai).toMatchObject({ apiKey: "", model: DEFAULT_OPENAI_MODEL });
});

it("loadCfg: reads every field from the environment, trimmed", () => {
  const cfg = cfgOf({
    ELEVENLABS_API_KEY: " ek ",
    ELEVENLABS_MODEL_ID: "em",
    ELEVENLABS_VOICE_ID: "ev",
    OPENAI_API_KEY: "ok",
    OPENAI_TTS_MODEL: "om",
    OPENAI_TTS_VOICE: "ov",
    SPEAK_PROVIDER: " OpenAI ",
  });

  expect(cfg).toMatchObject({
    elevenlabs: { apiKey: "ek", modelId: "em", voiceId: "ev" },
    openai: { apiKey: "ok", model: "om", voice: "ov" },
    providerPref: "openai",
  });
});

it("loadCfg: reads the nested file fields", () => {
  const home = plantDir();
  plantSpeakJson(home, {
    elevenlabs: { apiKey: "fk", modelId: "fm", voiceId: "fv" },
    openai: { apiKey: "ok", model: "om", voice: "ov" },
    provider: "ElevenLabs",
  });
  expect(loadCfg({ env: {}, home })).toMatchObject({
    elevenlabs: { apiKey: "fk", modelId: "fm", voiceId: "fv" },
    openai: { apiKey: "ok", model: "om", voice: "ov" },
    providerPref: "elevenlabs",
  });
});

it("loadCfg: reads the flat file fields as the elevenlabs fallback", () => {
  const home = plantDir();
  plantSpeakJson(home, { apiKey: "flat", modelId: "fm", voiceId: "fv" });
  expect(loadCfg({ env: {}, home }).elevenlabs).toStrictEqual({ apiKey: "flat", modelId: "fm", voiceId: "fv" });
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

it("loadCfg: reads env keys and defaults voices", () => {
  const cfg = cfgOf({ ELEVENLABS_API_KEY: "sk_el", OPENAI_API_KEY: "sk_oa" });
  expect(cfg.elevenlabs.apiKey).toBe("sk_el");
  expect(cfg.elevenlabs.voiceId).toBe(DEFAULT_ELEVEN_VOICE);
  expect(cfg.openai.apiKey).toBe("sk_oa");
  expect(cfg.openai.voice).toBe("coral");
  expect(resolveProvider(cfg)).toBe("elevenlabs");
  expect(resolveProvider(cfg, "openai")).toBe("openai");
});

it("loadCfg: reads ~/.workerstack/speak.json", () => {
  const home = plantDir("speak-file-");
  plantSpeakJson(home, { openai: { apiKey: "from-file", voice: "nova" }, provider: "openai" });
  const cfg = loadCfg({ env: {}, home });
  expect(cfg.openai.apiKey).toBe("from-file");
  expect(cfg.openai.voice).toBe("nova");
  expect(resolveProvider(cfg)).toBe("openai");
});

it("loadCfg: env overrides file key", () => {
  const home = plantDir("speak-ov-");
  plantSpeakJson(home, { elevenlabs: { apiKey: "file-key" } });
  expect(loadCfg({ env: { ELEVENLABS_API_KEY: "env-key" }, home }).elevenlabs.apiKey).toBe("env-key");
});

it("resolveProvider: a missing key throws, and so does an unknown provider", () => {
  expect(() => resolveProvider(cfgOf({}))).toThrow(/ELEVENLABS_API_KEY or OPENAI_API_KEY/);
  expect(() => resolveProvider(cfgOf({ ELEVENLABS_API_KEY: "x" }), "azure")).toThrow(/elevenlabs or openai/);
});
