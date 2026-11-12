import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Json } from "../json.ts";
import { cfgFor, cleanupTmp, plantSpeakJson, tmp } from "./__fixtures__/listen-env.ts";
import { clampSeconds, loadCfg } from "./listen-argv.ts";
import { DEFAULT_MODEL } from "./listen.constants.ts";

afterEach(cleanupTmp);

/** Writes speak.json as given: a string verbatim, anything else as JSON. */
function plantSpeak(home: string, body: Json) {
  fs.mkdirSync(path.join(home, ".workerstack"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".workerstack", "speak.json"),
    typeof body === "string" ? body : JSON.stringify(body),
  );
}

describe("clampSeconds", () => {
  it("caps seconds", () => {
    expect(clampSeconds(8)).toBe(8);
    expect(clampSeconds(0)).toBe(8);
    expect(clampSeconds(999)).toBe(120);
  });
});

describe("clampSeconds edges", () => {
  it("clamps garbage to the fallback and fractions up to one second", () => {
    expect(clampSeconds("abc")).toBe(8);
    expect(clampSeconds(-3, 5)).toBe(5);
    expect(clampSeconds(0.4)).toBe(1);
  });
});

describe("loadCfg", () => {
  it("reads openai key and listen fields from speak.json", () => {
    const home = tmp("listen-cfg-");
    plantSpeakJson(home, {
      listen: { device: ":1", model: "gpt-4o-mini-transcribe", seconds: 4 },
      openai: { apiKey: "sk_file" },
    });
    const cfg = loadCfg({ env: {}, home });
    expect(cfg.apiKey).toBe("sk_file");
    expect(cfg.model).toBe("gpt-4o-mini-transcribe");
    expect(cfg.device).toBe(":1");
    expect(cfg.seconds).toBe(4);
  });

  it("env overrides file", () => {
    const home = tmp("listen-ov-");
    plantSpeakJson(home, { listen: { model: "whisper-1" }, openai: { apiKey: "file" } });

    const cfg = loadCfg({
      env: { LISTEN_MODEL: "whisper-1", OPENAI_API_KEY: "sk_env" },
      home,
    });

    expect(cfg.apiKey).toBe("sk_env");
    expect(cfg.model).toBe(DEFAULT_MODEL);
  });
});

describe("loadCfg from the environment", () => {
  it("reads every field", () => {
    const env = {
      LISTEN_DEVICE: "hw:2",
      LISTEN_FFMPEG_FORMAT: "ALSA",
      LISTEN_MODEL: "m-env",
      LISTEN_SECONDS: "500",
      LISTEN_STT: "LOCAL",
      OPENAI_API_KEY: " sk_e ",
      WHISPER_MODEL: "/m/a.bin",
    };

    expect(cfgFor(tmp("listen-cfg-env-"), env)).toMatchObject({
      apiKey: "sk_e",
      device: "hw:2",
      ffmpegFormat: "alsa",
      model: "m-env",
      seconds: 120,
      stt: "local",
      whisperModel: "/m/a.bin",
    });
  });

  it("falls back to LISTEN_WHISPER_MODEL when WHISPER_MODEL is unset", () => {
    expect(cfgFor(tmp("listen-cfg-wm-"), { LISTEN_WHISPER_MODEL: "/m/b.bin" }).whisperModel).toBe("/m/b.bin");
  });
});

describe("loadCfg from speak.json", () => {
  it("reads the listen fields and defaults the rest", () => {
    const home = tmp("listen-cfg-file-");
    plantSpeak(home, { listen: { format: "Pulse", stt: "OpenAI", whisperModel: "/m/c.bin" } });
    expect(cfgFor(home)).toMatchObject({
      apiKey: "",
      device: "",
      ffmpegFormat: "pulse",
      model: DEFAULT_MODEL,
      seconds: 8,
      stt: "openai",
      whisperModel: "/m/c.bin",
    });
  });

  it("ignores a speak.json that is not an object or not JSON", () => {
    const home = tmp("listen-cfg-bad-");
    plantSpeak(home, "[1]");
    expect(cfgFor(home).stt).toBe("auto");
    plantSpeak(home, "{nope");
    expect(cfgFor(home).stt).toBe("auto");
    plantSpeak(home, { listen: "x", openai: 4 });
    expect(cfgFor(home).apiKey).toBe("");
  });
});

describe("loadCfg seconds from speak.json", () => {
  it("reads seconds written as text and drops seconds of another kind", () => {
    const home = tmp("listen-cfg-secs-");
    plantSpeak(home, { listen: { seconds: "6" } });
    expect(cfgFor(home).seconds).toBe(6);
    plantSpeak(home, { listen: { seconds: true } });
    expect(cfgFor(home).seconds).toBe(8);
  });
});
