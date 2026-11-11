import { afterEach, expect, it } from "vitest";

import { captureIo, cleanSetup, spyStd } from "./__fixtures__/setup-kit.ts";
import { reprobeHint } from "./setup-status.ts";

afterEach(cleanSetup);

function probe() {
  return "/never";
}

it("reprobeHint reports a binary that is already found", async () => {
  const io = captureIo();
  expect(await reprobeHint({ found: "/bin/ffmpeg", id: "ffmpeg", io })).toBe("/bin/ffmpeg");
  expect(io.logs).toStrictEqual(["ffmpeg ok  /bin/ffmpeg"]);
});

it("reprobeHint prints the install hints for the platform and never prompts when not interactive", async () => {
  const io = { ...captureIo(), confirm: () => Promise.reject(new Error("must not prompt")) };
  expect(await reprobeHint({ id: "chromium", io, platform: "darwin" })).toBe("");
  expect(io.logs[0]).toBe("chromium missing. print-only; not installed:");
  expect(io.logs.length).toBeGreaterThan(1);
});

it("reprobeHint writes to stdout when there is no io", async () => {
  const std = spyStd();
  await reprobeHint({ found: "/bin/ffmpeg", id: "ffmpeg" });
  expect(std.out).toStrictEqual(["ffmpeg ok  /bin/ffmpeg\n"]);
});

it("reprobeHint skips the re-check when the user says nothing was installed", async () => {
  const io = { ...captureIo(), confirm: () => Promise.resolve(false) };
  expect(await reprobeHint({ id: "ffmpeg", interactive: true, io, probe })).toBe("");
  expect(io.logs.join("\n")).not.toContain("still missing");
});

it("reprobeHint re-checks and reports a binary that appeared", async () => {
  const io = { ...captureIo(), confirm: () => Promise.resolve(true) };
  expect(await reprobeHint({ id: "ffmpeg", interactive: true, io, probe: () => "/bin/ffmpeg" })).toBe("/bin/ffmpeg");
  expect(io.logs.at(-1)).toBe("ffmpeg ok  /bin/ffmpeg");
});

it("reprobeHint says still missing, also when no probe was given", async () => {
  const io = { ...captureIo(), confirm: () => Promise.resolve(true) };
  expect(await reprobeHint({ id: "ffmpeg", interactive: true, io, probe: () => "" })).toBe("");
  expect(await reprobeHint({ id: "ffmpeg", interactive: true, io })).toBe("");
  expect(io.logs.filter((l) => l === "ffmpeg still missing")).toHaveLength(2);
});

it("reprobeHint does not prompt on an io without confirm", async () => {
  const io = captureIo();
  expect(await reprobeHint({ id: "ffmpeg", interactive: true, io })).toBe("");
  expect(io.logs.join("\n")).not.toContain("still missing");
});
