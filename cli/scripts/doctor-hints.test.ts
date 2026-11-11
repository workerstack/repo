import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { installHints, whichBin } from "./doctor-which.ts";
import { CHROMIUM_BINS } from "./doctor.constants.ts";
import { tmp } from "./fixtures/doctor-kit.ts";

it("CHROMIUM_BINS matches browser family names", () => {
  expect(CHROMIUM_BINS).toStrictEqual([
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
    "chrome",
    "msedge",
    "microsoft-edge",
  ]);
});

it("installHints: linux/darwin/win32 print-only strings; no playwright install", () => {
  const linux = installHints("all", "linux").join("\n");
  const darwin = installHints("all", "darwin").join("\n");
  const win = installHints("all", "win32").join("\n");
  for (const t of [linux, darwin, win]) {
    expect(t).not.toMatch(/playwright install/);
    expect(t).not.toMatch(/nodejs|node/i);
    expect(t).not.toMatch(/rulesync/);
  }
  expect(linux).toMatch(/apt install git|apt install.*git/);
  expect(linux).toMatch(/curl -fsSL https:\/\/raw\.githubusercontent\.com\/rtk-ai\/rtk\/master\/install\.sh \| sh/);
  expect(linux).toMatch(/pkg\.lightpanda\.io\/install\.sh/);
  expect(linux).toMatch(/apt install chromium/);
  expect(darwin).toMatch(/brew install git/);
  expect(darwin).toMatch(/brew install rtk/);
  expect(darwin).toMatch(/brew tap lightpanda-io\/browser/);
  expect(darwin).toMatch(/brew install --cask chromium|brew install --cask google-chrome/);
  expect(win).toMatch(/winget install Git\.Git/);
  expect(win).toMatch(/rtk\.exe|WSL/);
  expect(win).toMatch(/rtk-ai\.app\/docs\/getting-started\/installation/);
  expect(win).toMatch(/winget install Google\.Chrome/);
  expect(win).toMatch(/winget install Microsoft\.Edge/);
  expect(win).toMatch(/WSL/i);
  expect(linux).toMatch(/bun\.sh\/install/);
  expect(installHints("bun", "linux").join("\n")).toMatch(/bun\.sh/);
});

it("installHints for optional tools: whisper-cli release on win32, brew on darwin, the repo elsewhere; unknown gets none", () => {
  expect(installHints("whisper-cli", "win32")).toStrictEqual([
    "whisper.cpp release: whisper-cli.exe on PATH",
    "https://github.com/ggml-org/whisper.cpp",
  ]);
  expect(installHints("whisper-cli", "darwin")).toStrictEqual(["brew install whisper-cpp"]);
  expect(installHints("whisper-cli", "linux")).toStrictEqual(["https://github.com/ggml-org/whisper.cpp"]);
  expect(installHints("nope", "linux")).toStrictEqual([]);
});

it("whichBin finds chrome.exe on win32 PATH dir", () => {
  const dir = tmp("which-win-");
  const exe = path.join(dir, "chrome.exe");
  fs.writeFileSync(exe, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  expect(whichBin("chrome", dir, "win32").toLowerCase()).toBe(exe.toLowerCase());
});
