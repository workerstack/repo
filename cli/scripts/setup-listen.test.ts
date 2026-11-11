import fs from "node:fs";

import { afterEach, expect, it, vi } from "vitest";

import { bare, captureIo, cleanSetup, plant, readSpeakJson, spyStd } from "./fixtures/setup-kit.ts";
import { defaultGgmlPath } from "./listen-whisper.ts";
import { setupListen } from "./setup-listen.ts";
import type { SetupIo } from "./setup.types.ts";

afterEach(cleanSetup);

const withWhisper = { env: {}, pathEnv: "/bin", whichFn: (n: string) => (n === "ffmpeg" ? "" : `/bin/${n}`) };
const model = () => Promise.resolve({ arrayBuffer: () => Promise.resolve(Buffer.from("ggml")), ok: true, status: 200 });

it("setupListen downloads the model when whisper is found, and reports local STT", async () => {
  const home = plant("setup-li-dl-");
  const io = captureIo();
  const r = await setupListen({ fetchFn: model, home, io, platform: "linux", ...withWhisper });
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
  await setupListen({ fetchFn, flags, home, io: skipped, platform: "linux", ...withWhisper });
  expect(skipped.logs.at(-1)).toBe("stt=none");
  const io: SetupIo & { logs: string[] } = { ...captureIo(), confirm: () => Promise.resolve(false) };
  await setupListen({ fetchFn, home, interactive: true, io, platform: "linux", ...withWhisper });
  expect(fetchFn).not.toHaveBeenCalled();
});

it("setupListen asks before downloading on a terminal and downloads on yes", async () => {
  const home = plant("setup-li-yes-");
  const asked: string[] = [];
  const confirm: SetupIo["confirm"] = (o) => (asked.push(o.message), Promise.resolve(true));
  const io = { ...captureIo(), confirm };
  await setupListen({ fetchFn: model, home, interactive: true, io, platform: "linux", ...withWhisper });
  expect(asked.some((m) => m.startsWith("Download ggml-base.en.bin"))).toBe(true);
  expect(fs.existsSync(defaultGgmlPath(home))).toBe(true);
});

it("setupListen prompts for an OpenAI key on a terminal when there is no local STT", async () => {
  const home = plant("setup-li-key-");
  const opened: string[] = [];
  const password = () => Promise.resolve(" sk_fallback ");
  const io = { ...captureIo(), password };
  const openUrlFn = (u: string) => opened.push(u);
  await setupListen({ env: {}, home, interactive: true, io, openUrlFn, ...bare });
  expect(opened).toStrictEqual(["https://platform.openai.com/api-keys"]);
  expect(readSpeakJson(home)).toStrictEqual({ openai: { apiKey: "sk_fallback" } });
  expect(io.logs.at(-1)).toMatch(/^stt=openai/);
});

it("setupListen records --device and a mic id typed on a terminal", async () => {
  const home = plant("setup-li-dev-");
  const flags = { device: "hw:2", "openai-key": "sk", "skip-download": "1" };
  const base = { env: {}, pathEnv: "/bin", platform: "linux" as const, whichFn: (n: string) => `/bin/${n}` };
  await setupListen({ flags, home, io: captureIo(), ...base });
  expect(readSpeakJson(home)["listen"]).toStrictEqual({ device: "hw:2" });
  const text = () => Promise.resolve("hw:7");
  const io = { ...captureIo(), text };
  await setupListen({ flags: { "openai-key": "sk", "skip-download": "1" }, home, interactive: true, io, ...base });
  expect(readSpeakJson(home)["listen"]).toStrictEqual({ device: "hw:7" });
});

it("setupListen leaves the device alone when the typed mic id is blank, and writes nothing without a patch", async () => {
  const home = plant("setup-li-blank-");
  const io = { ...captureIo(), text: () => Promise.resolve("  ") };
  const base = { env: {}, pathEnv: "/bin", platform: "linux" as const, whichFn: (n: string) => `/bin/${n}` };
  const flags = { "skip-download": "1" };
  await setupListen({ flags, home, interactive: true, io, ...base });
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

it("openai fallback writes speak.json and does not echo the key", async () => {
  const home = plant("setup-listen-");
  const io = captureIo();
  const flags = { "openai-key": "sk_listen", "skip-download": "1" };
  const r = await setupListen({ env: {}, flags, home, io, pathEnv: "/none", platform: "linux", whichFn: () => "" });
  expect(r.stt?.kind).toBe("openai");
  const j = readSpeakJson(home);
  expect(j.openai?.apiKey).toBe("sk_listen");
  expect(io.logs.join("\n")).toMatch(/stt=openai/);
  expect(io.logs.join("\n")).not.toContain("sk_listen");
  expect(io.logs.join("\n")).toMatch(/ffmpeg missing/);
});

it("re-checks PATH after install confirm", async () => {
  const home = plant("setup-listen-re-");
  const seen = { ffmpeg: 0 };
  const io = { ...captureIo(), confirm: () => Promise.resolve(true) };
  await setupListen({
    env: {},
    flags: { "openai-key": "sk_re", "skip-download": "1" },
    home,
    interactive: true,
    io,
    pathEnv: "/none",
    platform: "linux",
    whichFn: (name: string) => {
      if (name === "ffmpeg") {
        seen.ffmpeg += 1;
        return seen.ffmpeg > 1 ? "/usr/bin/ffmpeg" : "";
      }
      return "";
    },
  });
  expect(seen.ffmpeg).toBeGreaterThan(1);
  expect(io.logs.join("\n")).toMatch(/ffmpeg ok/);
});

it("non-interactive without local STT or key fails", async () => {
  const home = plant("setup-listen-miss-");
  await expect(
    setupListen({
      env: {},
      flags: { "skip-download": "1" },
      home,
      io: captureIo(),
      pathEnv: "/none",
      platform: "linux",
      whichFn: () => "",
    }),
  ).rejects.toThrow(/whisper-cli or --openai-key/);
});
