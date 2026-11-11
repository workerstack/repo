import { afterEach, expect, it } from "vitest";
import { reprobeHint } from "./setup.ts";
import { captureIo, cleanSetup, spyStd } from "./fixtures/setup-kit.ts";

afterEach(cleanSetup);

it("reprobeHint reports a binary that is already found", async () => {
  const io = captureIo();
  expect(await reprobeHint({ id: "ffmpeg", found: "/bin/ffmpeg", io })).toBe("/bin/ffmpeg");
  expect(io.logs).toStrictEqual(["ffmpeg ok  /bin/ffmpeg"]);
});

it("reprobeHint prints the install hints for the platform and never prompts when not interactive", async () => {
  const io = { ...captureIo(), confirm: () => Promise.reject(new Error("must not prompt")) };
  expect(await reprobeHint({ id: "chromium", platform: "darwin", io })).toBe("");
  expect(io.logs[0]).toBe("chromium missing. print-only; not installed:");
  expect(io.logs.length).toBeGreaterThan(1);
});

it("reprobeHint writes to stdout when there is no io", async () => {
  const std = spyStd();
  await reprobeHint({ id: "ffmpeg", found: "/bin/ffmpeg" });
  expect(std.out).toStrictEqual(["ffmpeg ok  /bin/ffmpeg\n"]);
});

it("reprobeHint skips the re-check when the user says nothing was installed", async () => {
  const io = { ...captureIo(), confirm: () => Promise.resolve(false) };
  const probe = () => "/never";
  expect(await reprobeHint({ id: "ffmpeg", probe, io, interactive: true })).toBe("");
  expect(io.logs.join("\n")).not.toContain("still missing");
});

it("reprobeHint re-checks and reports a binary that appeared", async () => {
  const io = { ...captureIo(), confirm: () => Promise.resolve(true) };
  expect(await reprobeHint({ id: "ffmpeg", probe: () => "/bin/ffmpeg", io, interactive: true })).toBe("/bin/ffmpeg");
  expect(io.logs.at(-1)).toBe("ffmpeg ok  /bin/ffmpeg");
});

it("reprobeHint says still missing, also when no probe was given", async () => {
  const io = { ...captureIo(), confirm: () => Promise.resolve(true) };
  expect(await reprobeHint({ id: "ffmpeg", probe: () => "", io, interactive: true })).toBe("");
  expect(await reprobeHint({ id: "ffmpeg", io, interactive: true })).toBe("");
  expect(io.logs.filter((l) => l === "ffmpeg still missing")).toHaveLength(2);
});

it("reprobeHint does not prompt on an io without confirm", async () => {
  const io = captureIo();
  expect(await reprobeHint({ id: "ffmpeg", io, interactive: true })).toBe("");
  expect(io.logs.join("\n")).not.toContain("still missing");
});
