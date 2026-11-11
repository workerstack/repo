import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bunMinimum, BUN_MIN_FALLBACK, installHints, versionAtLeast, whichBin } from "./doctor.ts";

const REAL_PLATFORM = Object.getOwnPropertyDescriptor(
  process,
  "platform",
) /* process always has platform */ as PropertyDescriptor;
const dirs: string[] = [];
afterEach(() => {
  Object.defineProperty(process, "platform", REAL_PLATFORM);
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmp() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "doc-which-")));
  dirs.push(dir);
  return dir;
}

function hostIs(platform: string) {
  Object.defineProperty(process, "platform", { ...REAL_PLATFORM, value: platform });
}

function plant(dir: string, name: string, mode: number) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, "#!/bin/sh\nexit 0\n", { mode });
  return file;
}

describe("whichBin", () => {
  it("returns nothing for an empty name", () => {
    expect(whichBin("", tmp(), "linux")).toBe("");
  });

  it("splits a Windows-style PATH on semicolons even from another host", () => {
    const a = tmp();
    const b = tmp();
    const tool = plant(b, "tool.exe", 0o755);
    expect(whichBin("tool", `${a};${b}`, "win32")).toBe(tool);
  });
});

describe("whichBin on a Windows host", () => {
  it("tries each PATHEXT spelling on a Windows host and skips empty entries", () => {
    hostIs("win32");
    vi.stubEnv("PATHEXT", ".BAT;;.CMD");
    const dir = tmp();
    const tool = plant(dir, "tool.cmd", 0o755);
    expect(whichBin("tool", dir, "win32")).toBe(tool);
    expect(whichBin("absent", dir, "win32")).toBe("");
  });

  it("falls back to the default PATHEXT list when the host sets none", () => {
    hostIs("win32");
    vi.stubEnv("PATHEXT", "");
    const dir = tmp();
    const tool = plant(dir, "tool.cmd", 0o755);
    expect(whichBin("tool", dir, "win32")).toBe(tool);
  });
});

describe("whichBin on a Windows host, files and extensions", () => {
  it("accepts a file that exists but is not executable on a Windows host", () => {
    hostIs("win32");
    vi.stubEnv("PATHEXT", ".CMD");
    const dir = tmp();
    const tool = plant(dir, "tool.cmd", 0o644);
    expect(whichBin("tool", dir, "win32")).toBe(tool);
  });

  it("keeps a name that already has an extension", () => {
    hostIs("win32");
    const dir = tmp();
    const tool = plant(dir, "tool.exe", 0o755);
    expect(whichBin("tool.exe", dir, "win32")).toBe(tool);
  });

  it("uses the process platform and PATH by default", () => {
    const dir = tmp();
    const tool = plant(dir, "doc-which-tool", 0o755);
    vi.stubEnv("PATH", dir);
    expect(whichBin("doc-which-tool")).toBe(tool);
  });
});

describe("installHints", () => {
  it("names the ffmpeg install per platform", () => {
    expect(installHints("ffmpeg", "win32")).toStrictEqual(["winget install Gyan.FFmpeg"]);
    expect(installHints("ffmpeg", "darwin")).toStrictEqual(["brew install ffmpeg"]);
    expect(installHints("ffmpeg", "linux")).toStrictEqual(["sudo apt install ffmpeg"]);
  });

  it("defaults to the process platform", () => {
    hostIs("linux");
    expect(installHints("git")).toStrictEqual(["sudo apt install git"]);
  });
});

describe("bun version floor", () => {
  it("reads the floor from engines.bun and falls back when there is none", () => {
    const dir = tmp();
    const file = path.join(dir, "package.json");
    fs.writeFileSync(file, JSON.stringify({ engines: { bun: ">=1.5" } }));
    expect(bunMinimum(file)).toBe("1.5");
    fs.writeFileSync(file, JSON.stringify({ engines: { bun: "latest" } }));
    expect(bunMinimum(file)).toBe(BUN_MIN_FALLBACK);
    fs.writeFileSync(file, JSON.stringify({ engines: "none" }));
    expect(bunMinimum(file)).toBe(BUN_MIN_FALLBACK);
    fs.writeFileSync(file, "[1]");
    expect(bunMinimum(file)).toBe(BUN_MIN_FALLBACK);
    expect(bunMinimum(path.join(dir, "missing.json"))).toBe(BUN_MIN_FALLBACK);
  });

  it("reads this package's own floor by default", () => {
    expect(bunMinimum()).toMatch(/^\d+\.\d+/);
  });

  it("compares dotted versions, padding the shorter one with zeros", () => {
    expect(versionAtLeast("1.5", "1.4.4")).toBe(true);
    expect(versionAtLeast("v1.4.4", "1.4.4")).toBe(true);
    expect(versionAtLeast("1.4", "1.4.4")).toBe(false);
    expect(versionAtLeast("1.4.9", "1.4")).toBe(true);
    expect(versionAtLeast("1", "1.0.1")).toBe(false);
    expect(versionAtLeast("garbage", "1.4.4")).toBe(false);
  });
});
