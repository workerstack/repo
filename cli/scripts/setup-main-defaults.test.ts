import { afterEach, expect, it, vi } from "vitest";
import { main } from "./setup.ts";
import { bare, captureIo, cleanSetup, enablePacks, plant, readSpeakJson, spyStd } from "./fixtures/setup-kit.ts";

afterEach(cleanSetup);

it("main with no options reads the process cwd, home, env and stdio, and reports a disabled target on stderr", async () => {
  plant("setup-md-home-", true);
  vi.spyOn(process, "cwd").mockReturnValue(plant("setup-md-cwd-"));
  vi.stubEnv("PATH", plant("setup-md-bin-"));
  vi.stubEnv("CI", "1");
  const std = spyStd();
  expect(await main(["listen"])).toBe(1);
  expect(std.err.join("")).toContain("listen is off");
  expect(await main([])).toBe(1);
  expect(std.err.join("")).toContain("usage: setup");
});

it("main looks binaries up on the process PATH when neither options nor env carry one", async () => {
  vi.stubEnv("PATH", plant("setup-md-path-"));
  const io = captureIo();
  const cwd = plant("setup-md-path-cwd-");
  const code = await main(["browser"], { interactive: false, env: {}, home: plant("setup-md-path-home-"), cwd, io });
  expect(code).toBe(0);
  expect(io.logs.at(-1)).toMatch(/browser {2}missing {2}need lightpanda,need chromium/);
});

it("main runs the listen target when its pack is on", async () => {
  const home = plant("setup-md-listen-");
  const cwd = enablePacks(plant("setup-md-listen-cwd-"), ["listen"]);
  const io = captureIo();
  const argv = ["listen", "--openai-key", "sk", "--skip-download"];
  expect(await main(argv, { interactive: false, env: {}, home, cwd, io, ...bare })).toBe(0);
  expect(readSpeakJson(home)).toStrictEqual({ openai: { apiKey: "sk" } });
  expect(io.logs.at(-1)).toMatch(/^listen {2}ok/);
});
