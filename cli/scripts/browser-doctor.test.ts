import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { lookupBins, pickEngine } from "./browser-engine.ts";
import { cleanBrowser, envFor, run, runOn, tmp, writeFake } from "./fixtures/browser-kit.ts";

afterEach(cleanBrowser);

it(
  "missing engines linux/darwin/win32 → unified doctor exit 1 OS install strings; " +
    "no playwright install; lightpanda-io/browser",
  async () => {
    const cwd = tmp("browser-doc-");
    const bin = path.join(cwd, "bin");
    fs.mkdirSync(bin, { recursive: true });
    const linux = await runOn("linux")(cwd, ["doctor"], bin);
    const darwin = await runOn("darwin")(cwd, ["doctor"], bin);
    const win = await runOn("win32")(cwd, ["doctor"], bin);
    const ensure = await runOn("linux")(cwd, ["ensure"], bin);
    for (const r of [linux, darwin, win, ensure]) {
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(/lightpanda-io\/browser/);
      expect(`${r.stdout}${r.stderr}`).not.toMatch(/playwright install/);
    }
    expect(linux.stdout).toMatch(/curl -fsSL https:\/\/pkg\.lightpanda\.io\/install\.sh \| bash/);
    expect(darwin.stdout).toMatch(/brew tap lightpanda-io\/browser|brew install lightpanda-io\/browser\/lightpanda/);
    expect(win.stdout).toMatch(/winget/);
    expect(win.stdout).toMatch(/WSL2/i);
    expect(ensure.stdout).toBe(linux.stdout);
    const help = await run(cwd, ["help"], bin);
    expect(help.stdout).toMatch(/doctor/);
    expect(help.stdout).toMatch(/ensure/);
  },
);

it("win32: Chromium/winget/WSL2 notes; not native Lightpanda required", async () => {
  const cwd = tmp("browser-doc-win-");
  const bin = path.join(cwd, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const r = await runOn("win32")(cwd, ["doctor"], bin);
  expect(r.code).toBe(1);
  expect(r.stdout).toMatch(/winget install Google\.Chrome|winget install Microsoft\.Edge/);
  expect(r.stdout).toMatch(/PATH|shim/i);
  expect(r.stdout).toMatch(/WSL2/i);
  expect(r.stdout).toMatch(/not required|no native/i);
});

it("bins present → reports paths via unified doctor", async () => {
  const cwd = tmp("browser-doc-ok-");
  const bin = path.join(cwd, "bin");
  const lp = writeFake(bin, "lightpanda");
  const cr = writeFake(bin, "chromium");
  const r = await runOn("linux")(cwd, ["doctor"], bin);
  expect(r.stdout).toContain(lp);
  expect(r.stdout).toContain(cr);
});

it("playwright-only PATH is NOT treated as Chromium engine", async () => {
  const cwd = tmp("browser-pwonly-");
  const bin = path.join(cwd, "bin");
  writeFake(bin, "playwright");
  const looked = lookupBins(envFor(bin).PATH, "linux");
  expect(looked.chromium).toBeFalsy();
  expect(looked).not.toHaveProperty("playwright");
  const picked = pickEngine({
    bins: { playwright: path.join(bin, "playwright") },
    platform: "linux",
    url: "https://example.com/",
    verb: "nav",
  });
  expect(picked.engine).toBeNull();
  const r = await run(cwd, ["nav", "https://example.com/"], bin);
  expect(r.code).not.toBe(0);
  expect(`${r.stdout}${r.stderr}`).not.toMatch(/playwright install/);
});
