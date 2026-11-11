import { afterEach, expect, it } from "vitest";
import { ELEVENLABS_KEY_URL, OPENAI_KEY_URL, setupSpeak } from "./setup.ts";
import type { SetupIo } from "./setup.ts";
import { captureIo, cleanSetup, okJson, plant, readSpeakJson, spyStd } from "./fixtures/setup-kit.ts";

afterEach(cleanSetup);

function tty(answers: { select?: string; keys?: string[] }) {
  const io: SetupIo & { logs: string[]; asked: string[]; initial: string[] } = {
    ...captureIo(),
    asked: [],
    initial: [],
    select: (o) => (io.initial.push(o.initialValue), Promise.resolve(answers.select ?? "")),
    password: (o) => (io.asked.push(o.message), Promise.resolve(answers.keys?.shift() ?? "")),
  };
  return io;
}

it("setupSpeak asks for the OpenAI key only when the user picks openai, starting the menu on the flag", async () => {
  const home = plant("setup-sp-oa-");
  const io = tty({ select: "openai", keys: ["sk_oa"] });
  const opened: string[] = [];
  const flags = { provider: "openai", "skip-verify": "true" };
  await setupSpeak({ flags, home, io, interactive: true, openUrlFn: (u) => opened.push(u) });
  expect(io.initial).toStrictEqual(["openai"]);
  expect(opened).toStrictEqual([OPENAI_KEY_URL]);
  expect(io.asked).toStrictEqual(["OpenAI API key"]);
  expect(readSpeakJson(home)).toStrictEqual({ provider: "openai", openai: { apiKey: "sk_oa" } });
});

it("setupSpeak asks for both keys on both and records no provider", async () => {
  const home = plant("setup-sp-both-");
  const io = tty({ select: "both", keys: ["sk_el", "sk_oa"] });
  const opened: string[] = [];
  await setupSpeak({ flags: { "skip-verify": "1" }, home, io, interactive: true, openUrlFn: (u) => opened.push(u) });
  expect(opened).toStrictEqual([ELEVENLABS_KEY_URL, OPENAI_KEY_URL]);
  expect(readSpeakJson(home)).toStrictEqual({ elevenlabs: { apiKey: "sk_el" }, openai: { apiKey: "sk_oa" } });
});

it("setupSpeak treats a blank menu answer as ElevenLabs", async () => {
  const home = plant("setup-sp-blank-");
  const io = tty({ select: "", keys: ["sk_el"] });
  await setupSpeak({ flags: { "skip-verify": "1" }, home, io, interactive: true, openUrlFn: () => 0 });
  expect(io.initial).toStrictEqual(["elevenlabs"]);
  expect(readSpeakJson(home)).toStrictEqual({ elevenlabs: { apiKey: "sk_el" } });
});

it("setupSpeak does not prompt for a key that was passed as a flag", async () => {
  const home = plant("setup-sp-flag-");
  const io = tty({ select: "elevenlabs" });
  const flags = { provider: "elevenlabs", elevenlabs: "sk_flag", "skip-verify": "1" };
  await setupSpeak({ flags, home, io, interactive: true, openUrlFn: () => 0 });
  expect(io.asked).toStrictEqual([]);
  expect(readSpeakJson(home)).toStrictEqual({ provider: "elevenlabs", elevenlabs: { apiKey: "sk_flag" } });
});

it("setupSpeak keeps both flag keys when a provider is named", async () => {
  const home = plant("setup-sp-keep-");
  const flags = { provider: "openai", "openai-key": "sk_oa", "elevenlabs-key": "sk_el", "skip-verify": "1" };
  await setupSpeak({ flags, home, io: captureIo() });
  expect(readSpeakJson(home)).toMatchObject({ elevenlabs: { apiKey: "sk_el" }, openai: { apiKey: "sk_oa" } });
});

it("setupSpeak fails without a key, naming the TTY route only when not interactive", async () => {
  const home = plant("setup-sp-nokey-");
  await expect(setupSpeak({ home, io: captureIo() })).rejects.toThrow(/--elevenlabs-key or --openai-key/);
  const io = tty({ select: "elevenlabs", keys: [""] });
  const ask = setupSpeak({ home, io, interactive: true, openUrlFn: () => 0 });
  await expect(ask).rejects.toThrow("need an ElevenLabs or OpenAI key");
});

it("setupSpeak with no context fails on the stubbed home without writing a file", async () => {
  plant("setup-sp-default-", true);
  await expect(setupSpeak()).rejects.toThrow(/need --elevenlabs-key/);
});

it("setupSpeak verifies ElevenLabs when no provider is named and prints the account", async () => {
  const home = plant("setup-sp-verify-");
  const io = captureIo();
  const fetchFn = () => Promise.resolve(okJson({ email: "a@b.c", subscription: { tier: "free" } }));
  const r = await setupSpeak({ flags: { "elevenlabs-key": "sk_el" }, home, io, fetchFn });
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
