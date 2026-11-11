import { afterEach, expect, it } from "vitest";

import { captureIo, cleanSetup, okJson, plant, readSpeakJson, spyStd } from "./__fixtures__/setup-kit.ts";
import { setupSpeak } from "./setup-speak.ts";
import { ELEVENLABS_KEY_URL, OPENAI_KEY_URL } from "./setup.constants.ts";
import type { SetupIo } from "./setup.types.ts";

afterEach(cleanSetup);

function fetchFn() {
  return Promise.resolve(okJson({ email: "a@b.c", subscription: { tier: "free" } }));
}

function tty(answers: { select?: string; keys?: string[] }) {
  const io: SetupIo & { logs: string[]; asked: string[]; initial: string[] } = {
    ...captureIo(),
    asked: [],
    initial: [],
    password: (o) => (io.asked.push(o.message), Promise.resolve(answers.keys?.shift() ?? "")),
    select: (o) => (io.initial.push(o.initialValue), Promise.resolve(answers.select ?? "")),
  };
  return io;
}

it("setupSpeak asks for the OpenAI key only when the user picks openai, starting the menu on the flag", async () => {
  const home = plant("setup-sp-oa-");
  const io = tty({ keys: ["sk_oa"], select: "openai" });
  const opened: string[] = [];
  const flags = { provider: "openai", "skip-verify": "true" };
  await setupSpeak({ flags, home, interactive: true, io, openUrlFn: (u) => opened.push(u) });
  expect(io.initial).toStrictEqual(["openai"]);
  expect(opened).toStrictEqual([OPENAI_KEY_URL]);
  expect(io.asked).toStrictEqual(["OpenAI API key"]);
  expect(readSpeakJson(home)).toStrictEqual({ openai: { apiKey: "sk_oa" }, provider: "openai" });
});

it("setupSpeak asks for both keys on both and records no provider", async () => {
  const home = plant("setup-sp-both-");
  const io = tty({ keys: ["sk_el", "sk_oa"], select: "both" });
  const opened: string[] = [];
  await setupSpeak({ flags: { "skip-verify": "1" }, home, interactive: true, io, openUrlFn: (u) => opened.push(u) });
  expect(opened).toStrictEqual([ELEVENLABS_KEY_URL, OPENAI_KEY_URL]);
  expect(readSpeakJson(home)).toStrictEqual({ elevenlabs: { apiKey: "sk_el" }, openai: { apiKey: "sk_oa" } });
});

it("setupSpeak treats a blank menu answer as ElevenLabs", async () => {
  const home = plant("setup-sp-blank-");
  const io = tty({ keys: ["sk_el"], select: "" });
  await setupSpeak({ flags: { "skip-verify": "1" }, home, interactive: true, io, openUrlFn: () => 0 });
  expect(io.initial).toStrictEqual(["elevenlabs"]);
  expect(readSpeakJson(home)).toStrictEqual({ elevenlabs: { apiKey: "sk_el" } });
});

it("setupSpeak does not prompt for a key that was passed as a flag", async () => {
  const home = plant("setup-sp-flag-");
  const io = tty({ select: "elevenlabs" });
  const flags = { elevenlabs: "sk_flag", provider: "elevenlabs", "skip-verify": "1" };
  await setupSpeak({ flags, home, interactive: true, io, openUrlFn: () => 0 });
  expect(io.asked).toStrictEqual([]);
  expect(readSpeakJson(home)).toStrictEqual({ elevenlabs: { apiKey: "sk_flag" }, provider: "elevenlabs" });
});

it("setupSpeak keeps both flag keys when a provider is named", async () => {
  const home = plant("setup-sp-keep-");
  const flags = { "elevenlabs-key": "sk_el", "openai-key": "sk_oa", provider: "openai", "skip-verify": "1" };
  await setupSpeak({ flags, home, io: captureIo() });
  expect(readSpeakJson(home)).toMatchObject({ elevenlabs: { apiKey: "sk_el" }, openai: { apiKey: "sk_oa" } });
});

it("setupSpeak fails without a key, naming the TTY route only when not interactive", async () => {
  const home = plant("setup-sp-nokey-");
  await expect(setupSpeak({ home, io: captureIo() })).rejects.toThrow(/--elevenlabs-key or --openai-key/);
  const io = tty({ keys: [""], select: "elevenlabs" });
  const ask = setupSpeak({ home, interactive: true, io, openUrlFn: () => 0 });
  await expect(ask).rejects.toThrow("need an ElevenLabs or OpenAI key");
});

it("setupSpeak with no context fails on the stubbed home without writing a file", async () => {
  plant("setup-sp-default-", true);
  await expect(setupSpeak()).rejects.toThrow(/need --elevenlabs-key/);
});

it("setupSpeak verifies ElevenLabs when no provider is named and prints the account", async () => {
  const home = plant("setup-sp-verify-");
  const io = captureIo();
  const r = await setupSpeak({ fetchFn, flags: { "elevenlabs-key": "sk_el" }, home, io });
  expect(r).toMatchObject({ verified: true, who: "elevenlabs  a@b.c  tier=free" });
  expect(io.logs.at(-1)).toBe("elevenlabs  a@b.c  tier=free");
});

it("setupSpeak prints to stdout when it has no io and skips verification", async () => {
  const home = plant("setup-sp-noio-");
  const std = spyStd();
  const r = await setupSpeak({ flags: { "openai-key": "sk_oa", "skip-verify": "1" }, home });
  expect(r.verified).toBe(false);
  expect(std.out.join("")).toContain(`wrote ${r.dest}`);
});

it("writes elevenlabs key, verifies, does not echo the secret", async () => {
  const home = plant("setup-speak-");
  const io = captureIo();
  const r = await setupSpeak({ flags: { "elevenlabs-key": "sk_secret_el", "skip-verify": "1" }, home, io });
  expect(r.ok).toBe(true);
  const j = readSpeakJson(home);
  expect(j.elevenlabs?.apiKey).toBe("sk_secret_el");
  expect(io.logs.join("\n")).toMatch(/speak\.json/);
  expect(io.logs.join("\n")).not.toContain("sk_secret_el");
});

it("verifies openai via fetch", async () => {
  const home = plant("setup-speak-oa-");
  const io = captureIo();
  const r = await setupSpeak({
    fetchFn: () => Promise.resolve(okJson({ data: [] })),
    flags: { "openai-key": "sk-oa", provider: "openai" },
    home,
    io,
  });
  expect(r.verified).toBe(true);
  expect(io.logs.join("\n")).toMatch(/openai ok/);
  expect(io.logs.join("\n")).not.toContain("sk-oa");
});

it("interactive elevenlabs opens the key page and takes a password", async () => {
  const home = plant("setup-speak-tty-");
  const io = {
    ...captureIo(),
    password: () => Promise.resolve("sk_from_prompt"),
    select: () => Promise.resolve("elevenlabs"),
  };
  const opened: string[] = [];
  await setupSpeak({
    flags: { "skip-verify": "1" },
    home,
    interactive: true,
    io,
    openUrlFn: (u: string) => opened.push(u),
  });
  expect(opened).toStrictEqual([ELEVENLABS_KEY_URL]);
  const j = readSpeakJson(home);
  expect(j.elevenlabs?.apiKey).toBe("sk_from_prompt");
});
