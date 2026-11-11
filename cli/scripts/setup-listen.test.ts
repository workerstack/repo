import fs from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { defaultGgmlPath } from "./listen.ts";
import { setupListen } from "./setup.ts";
import type { SetupIo } from "./setup.ts";
import { bare, captureIo, cleanSetup, plant, readSpeakJson, spyStd } from "./fixtures/setup-kit.ts";

afterEach(cleanSetup);

const withWhisper = { whichFn: (n: string) => (n === "ffmpeg" ? "" : `/bin/${n}`), pathEnv: "/bin", env: {} };
const model = () => Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(Buffer.from("ggml")) });

it("setupListen downloads the model when whisper is found, and reports local STT", async () => {
  const home = plant("setup-li-dl-");
  const io = captureIo();
  const r = await setupListen({ home, io, platform: "linux", fetchFn: model, ...withWhisper });
  expect(fs.readFileSync(defaultGgmlPath(home), "utf8")).toBe("ggml");
  expect(io.logs.join("\n")).toContain(`model ${defaultGgmlPath(home)}`);
  expect(io.logs.at(-1)).toMatch(/^stt=local {2}bin=\/bin\/\S+ {2}model=/);
  expect(r.stt?.kind).toBe("local");
});

it("setupListen skips the download on --skip-download and when the user declines", async () => {
  const home = plant("setup-li-nodl-");
  const fetchFn = vi.fn(model);
  const flags = { "skip-download": "1" };
  const skipped = captureIo();
  await setupListen({ flags, home, io: skipped, platform: "linux", fetchFn, ...withWhisper });
  expect(skipped.logs.at(-1)).toBe("stt=none");
  const io: SetupIo & { logs: string[] } = { ...captureIo(), confirm: () => Promise.resolve(false) };
  await setupListen({ home, io, interactive: true, platform: "linux", fetchFn, ...withWhisper });
  expect(fetchFn).not.toHaveBeenCalled();
});

it("setupListen asks before downloading on a terminal and downloads on yes", async () => {
  const home = plant("setup-li-yes-");
  const asked: string[] = [];
  const confirm: SetupIo["confirm"] = (o) => (asked.push(o.message), Promise.resolve(true));
  const io = { ...captureIo(), confirm };
  await setupListen({ home, io, interactive: true, platform: "linux", fetchFn: model, ...withWhisper });
  expect(asked.some((m) => m.startsWith("Download ggml-base.en.bin"))).toBe(true);
  expect(fs.existsSync(defaultGgmlPath(home))).toBe(true);
});

it("setupListen prompts for an OpenAI key on a terminal when there is no local STT", async () => {
  const home = plant("setup-li-key-");
  const opened: string[] = [];
  const password = () => Promise.resolve(" sk_fallback ");
  const io = { ...captureIo(), password };
  const openUrlFn = (u: string) => opened.push(u);
  await setupListen({ home, io, interactive: true, openUrlFn, env: {}, ...bare });
  expect(opened).toStrictEqual(["https://platform.openai.com/api-keys"]);
  expect(readSpeakJson(home)).toStrictEqual({ openai: { apiKey: "sk_fallback" } });
  expect(io.logs.at(-1)).toMatch(/^stt=openai/);
});

it("setupListen records --device and a mic id typed on a terminal", async () => {
  const home = plant("setup-li-dev-");
  const flags = { "openai-key": "sk", "skip-download": "1", device: "hw:2" };
  const base = { whichFn: (n: string) => `/bin/${n}`, pathEnv: "/bin", env: {}, platform: "linux" as const };
  await setupListen({ flags, home, io: captureIo(), ...base });
  expect(readSpeakJson(home)["listen"]).toStrictEqual({ device: "hw:2" });
  const text = () => Promise.resolve("hw:7");
  const io = { ...captureIo(), text };
  await setupListen({ flags: { "openai-key": "sk", "skip-download": "1" }, home, io, interactive: true, ...base });
  expect(readSpeakJson(home)["listen"]).toStrictEqual({ device: "hw:7" });
});

it("setupListen leaves the device alone when the typed mic id is blank, and writes nothing without a patch", async () => {
  const home = plant("setup-li-blank-");
  const io = { ...captureIo(), text: () => Promise.resolve("  ") };
  const base = { whichFn: (n: string) => `/bin/${n}`, pathEnv: "/bin", env: {}, platform: "linux" as const };
  const flags = { "skip-download": "1" };
  await setupListen({ flags, home, io, interactive: true, ...base });
  expect(fs.existsSync(`${home}/.workerstack/speak.json`)).toBe(false);
});

it("setupListen with no context fails on a bare PATH, and prints stt=openai to stdout with a key", async () => {
  plant("setup-li-default-", true);
  vi.stubEnv("PATH", plant("setup-li-default-bin-"));
  vi.stubEnv("OPENAI_API_KEY", "");
  const std = spyStd();
  await expect(setupListen()).rejects.toThrow(/whisper-cli or --openai-key/);
  await setupListen({ flags: { "openai-key": "sk" } });
  expect(std.out.join("")).toContain("stt=openai");
});

it("setupListen reports stt=none when whisper exists without a model and no key", async () => {
  const home = plant("setup-li-none-");
  const io = captureIo();
  await setupListen({ flags: { "skip-download": "1" }, home, io, platform: "linux", ...withWhisper });
  expect(io.logs.at(-1)).toBe("stt=none");
});
