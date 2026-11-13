import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { repoEnv } from "../repo-env.ts";
import {
  cleanBrowser,
  expectGone,
  readStored,
  run,
  runCli,
  runOn,
  sessionPath,
  tmp,
  writeFake,
} from "./__fixtures__/browser-kit.ts";
import { navigated } from "./__fixtures__/browser-nav-kit.ts";

afterEach(cleanBrowser);

it("lightpanda on PATH → nav uses Lightpanda; session under .repo/tmp/browser/; no env", async () => {
  const cwd = tmp("browser-lp-");
  const bin = path.join(cwd, "bin");
  writeFake(bin, "lightpanda");
  writeFake(bin, "chromium");
  const r = await run(cwd, ["nav", "https://example.com/"], bin);
  expect(r.code).toBe(0);
  expect(r.stderr).toBe("");
  expect(r.stdout).toMatch(/engine: lightpanda/);
  const s = readStored(cwd);
  expect(s.engine).toBe("lightpanda");
  expect(s.lastURL).toMatch(/example\.com/);
  expect(s.pid).toBeGreaterThan(0);
  expect(path.normalize(sessionPath(cwd))).toContain(path.join(".repo", "tmp", "browser"));
  expect(repoEnv.process.REPO_BROWSER).toBeUndefined();
});

it("no lightpanda; Playwright Chromium present → nav uses Chromium", async () => {
  const cwd = tmp("browser-cr-");
  const bin = path.join(cwd, "bin");
  writeFake(bin, "chromium");
  writeFake(bin, "playwright");
  const r = await run(cwd, ["nav", "https://example.com/"], bin);
  expect(r.code).toBe(0);
  expect(readStored(cwd).engine).toBe("chromium");
  expect(r.stdout).toMatch(/engine: chromium/);
});

it("neither binary → non-zero + install hint; no stack dump", async () => {
  const cwd = tmp("browser-none-");
  const bin = path.join(cwd, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const r = await run(cwd, ["nav", "https://example.com/"], bin);
  expect(r.code).not.toBe(0);
  const err = r.stderr + r.stdout;
  expect(err).toMatch(/lightpanda|chromium|install/i);
  expect(err).not.toMatch(/at runBrowser/);
  expect(err).not.toMatch(/Error: /);
  expect(fs.existsSync(sessionPath(cwd))).toBe(false);
});

it("process.platform=win32 → Chromium even if Lightpanda mock exists", async () => {
  const cwd = tmp("browser-win-");
  const bin = path.join(cwd, "bin");
  writeFake(bin, "lightpanda");
  writeFake(bin, "chromium");
  const r = await runOn("win32")(cwd, ["nav", "https://example.com/"], bin);
  expect(r.code).toBe(0);
  expect(readStored(cwd).engine).toBe("chromium");
});

it("paint-host URL on nav → Chromium immediately", async () => {
  const cwd = tmp("browser-paint-");
  const bin = path.join(cwd, "bin");
  writeFake(bin, "lightpanda");
  writeFake(bin, "chromium");
  const r = await run(cwd, ["nav", "https://www.figma.com/file/abc"], bin);
  expect(r.code).toBe(0);
  expect(readStored(cwd).engine).toBe("chromium");
  const amazon = await run(cwd, ["nav", "https://www.amazon.com/dp/B0"], bin);
  expect(amazon.code).toBe(0);
  expect(readStored(cwd).engine).toBe("chromium");
});

it("Lightpanda probe fail → one Chromium replay; no loop", async () => {
  const cwd = tmp("browser-probe-");
  const bin = path.join(cwd, "bin");
  writeFake(bin, "lightpanda", { failProbe: true });
  writeFake(bin, "chromium");
  const r = await run(cwd, ["nav", "https://example.com/page"], bin);
  expect(r.code).toBe(0);
  const s = readStored(cwd);
  expect(s.engine).toBe("chromium");
  expect(s.lastURL).toMatch(/example\.com\/page/);
  expect(s.escalated).toBe(true);
  expect(s.swapCount).toBe(1);
});

it("thin Lightpanda snap → one Chromium replay then snap", async () => {
  const cwd = tmp("browser-thin-");
  const bin = path.join(cwd, "bin");
  writeFake(bin, "lightpanda", { thinSnap: true });
  writeFake(bin, "chromium");
  const nav = await run(cwd, ["nav", "https://example.com/spa"], bin);
  expect(nav.code).toBe(0);
  expect(readStored(cwd).engine).toBe("lightpanda");
  const snap = await run(cwd, ["snap"], bin);
  expect(snap.code).toBe(0);
  expect(snap.stdout).toMatch(/engine: chromium/);
  const s = readStored(cwd);
  expect(s.engine).toBe("chromium");
  expect(s.escalated).toBe(true);
  expect(s.swapCount).toBe(1);
  const snap2 = await run(cwd, ["snap"], bin);
  expect(snap2.code).toBe(0);
  expect(readStored(cwd).swapCount).toBe(1);
});

it("nav then snap → markdown + numbered refs; session keeps lastURL/lastRefs/engine/pid", async () => {
  const { bin, cwd } = await navigated("browser-snap-", ["lightpanda"]);
  const snap = await run(cwd, ["snap"], bin);
  expect(snap.code).toBe(0);
  expect(snap.stdout).toMatch(/\[1\]/);
  expect(snap.stdout).toMatch(/link|textbox|button/i);
  const s = readStored(cwd);
  expect(s.lastURL).toMatch(/example\.com/);
  expect(s.lastRefs["1"]).toBeTruthy();
  expect(s.engine).toBe("lightpanda");
  expect(s.pid).toBeGreaterThan(0);
});

it("stop kills pid; session cleared; second stop ok", async () => {
  const { bin, cwd } = await navigated("browser-stop-", ["lightpanda"]);
  const pid = readStored(cwd).pid;
  expect(() => process.kill(pid, 0)).not.toThrow();
  const stop = await run(cwd, ["stop"], bin);
  expect(stop.code).toBe(0);
  expect(fs.existsSync(sessionPath(cwd))).toBe(false);
  await expectGone(pid);
  const stop2 = await run(cwd, ["stop"], bin);
  expect(stop2.code).toBe(0);
});

it.skipIf(process.platform === "win32")("CLI spawn: lightpanda on PATH, no env knobs", () => {
  const cwd = tmp("browser-cli-");
  const bin = path.join(cwd, "bin");
  writeFake(bin, "lightpanda");
  const r = runCli(cwd, ["nav", "https://example.com/"], bin);
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/engine: lightpanda/);
  expect(readStored(cwd).engine).toBe("lightpanda");
});

it.skipIf(process.platform !== "win32")("CLI spawn: chromium on PATH, no env knobs", () => {
  const cwd = tmp("browser-cli-win-");
  const bin = path.join(cwd, "bin");
  writeFake(bin, "lightpanda");
  writeFake(bin, "chromium");
  const r = runCli(cwd, ["nav", "https://example.com/"], bin);
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/engine: chromium/);
  expect(readStored(cwd).engine).toBe("chromium");
});
