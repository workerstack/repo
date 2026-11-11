import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  cleanBrowser,
  deadPid,
  exec,
  live,
  methods,
  NEVER,
  NO_SESSION,
  readStored,
  run,
  tmp,
  writeFake,
} from "./fixtures/browser-kit.ts";

afterEach(cleanBrowser);

it("shot with Lightpanda session → swap to Chromium replay; one swap cap", async () => {
  const cwd = tmp("browser-shot-");
  const bin = path.join(cwd, "bin");
  writeFake(bin, "lightpanda");
  writeFake(bin, "chromium");
  expect((await run(cwd, ["nav", "https://example.com/"], bin)).code).toBe(0);
  expect(readStored(cwd).engine).toBe("lightpanda");
  const shot = await run(cwd, ["shot"], bin);
  expect(shot.code).toBe(0);
  const s = readStored(cwd);
  expect(s.engine).toBe("chromium");
  expect(s.swapCount).toBe(1);
  expect(s.lastURL).toMatch(/example\.com/);
  const art = path.join(cwd, ".tmp/repo/browser/shot.png");
  expect(fs.existsSync(art)).toBe(true);
  const shot2 = await run(cwd, ["shot"], bin);
  expect(shot2.code).toBe(0);
  expect(readStored(cwd).swapCount).toBe(1);
});

it("pdf → Chromium path; never Lightpanda paint", async () => {
  const cwd = tmp("browser-pdf-");
  const bin = path.join(cwd, "bin");
  writeFake(bin, "lightpanda");
  writeFake(bin, "chromium");
  expect((await run(cwd, ["nav", "https://example.com/"], bin)).code).toBe(0);
  const pdf = await run(cwd, ["pdf"], bin);
  expect(pdf.code).toBe(0);
  expect(readStored(cwd).engine).toBe("chromium");
  expect(fs.existsSync(path.join(cwd, ".tmp/repo/browser/page.pdf"))).toBe(true);
});

it("shot/pdf with no session fails clearly", async () => {
  const cwd = tmp("browser-shot-none-");
  const bin = path.join(cwd, "bin");
  writeFake(bin, "chromium");
  const shot = await run(cwd, ["shot"], bin);
  expect(shot.code).not.toBe(0);
  expect(shot.stderr).toMatch(/session|nav/i);
  const pdf = await run(cwd, ["pdf"], bin);
  expect(pdf.code).not.toBe(0);
  expect(pdf.stderr).toMatch(/session|nav/i);
});

it("shot and pdf need a session with a url", async () => {
  expect((await exec(tmp("browser-shot-nosess-"), ["shot"], { bins: NEVER })).stderr).toBe(NO_SESSION);
  const noUrl = await live({ lastURL: "" });
  expect((await exec(noUrl.cwd, ["pdf"], { bins: NEVER })).stderr).toBe(NO_SESSION);
});

it("shot names the install hint when no chromium exists", async () => {
  const t = await live();
  const r = await exec(t.cwd, ["shot"]);
  expect(r.code).toBe(1);
  expect(r.stderr).toMatch(/^no browser engine; install lightpanda/);
});

it("shot and pdf write the png and the pdf the engine paints, and say where", async () => {
  const t = await live({ engine: "chromium" });
  const shot = await exec(t.cwd, ["shot"], { bins: NEVER });
  expect(shot).toStrictEqual({
    code: 0,
    stderr: "",
    stdout: `engine: chromium\nfile: ${path.join(".tmp/repo/browser", "shot.png")}\n`,
  });
  const png = fs.readFileSync(path.join(t.cwd, ".tmp/repo/browser/shot.png"));
  expect(png.subarray(0, 4)).toStrictEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const pdf = await exec(t.cwd, ["pdf"], { bins: NEVER });
  expect(pdf.stdout).toBe(`engine: chromium\nfile: ${path.join(".tmp/repo/browser", "page.pdf")}\n`);
  expect(fs.readFileSync(path.join(t.cwd, ".tmp/repo/browser/page.pdf")).subarray(0, 5).toString()).toBe("%PDF-");
  expect(methods(t.calls)).toStrictEqual(["Page.captureScreenshot", "Page.printToPDF"]);
});

it("shot swaps a lightpanda session that recorded no pid to chromium before painting", async () => {
  const t = await live({ pid: undefined });
  const chromium = writeFake(t.bin, "chromium");
  expect((await exec(t.cwd, ["shot"], { bins: { chromium, lightpanda: "" } })).code).toBe(0);
  expect(readStored(t.cwd)).toMatchObject({ engine: "chromium", swapCount: 1 });
  expect(fs.existsSync(path.join(t.cwd, ".tmp/repo/browser/shot.png"))).toBe(true);
});

it("shot fails a chromium session whose process is gone", async () => {
  const t = await live({ engine: "chromium", pid: deadPid() });
  expect((await exec(t.cwd, ["shot"], { bins: NEVER })).stderr).toBe(NO_SESSION);
  expect(fs.existsSync(path.join(t.cwd, ".tmp/repo/browser/shot.png"))).toBe(false);
});
