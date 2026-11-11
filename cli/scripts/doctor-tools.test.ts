import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { BUN_MIN_FALLBACK } from "./doctor.constants.ts";
import {
  enablePacks,
  expectStdoutPath,
  here,
  linuxRun,
  REQUIRED,
  runDoctor,
  tmp,
  toolsCwd,
  writeBin,
  writeBun,
  writeRequired,
} from "./fixtures/doctor-kit.ts";

it("empty PATH → exit 1; all required missing; OS hints; optional gh; no playwright", () => {
  const cwd = tmp("doc-empty-");
  enablePacks();
  const linux = runDoctor({ cwd, pathEnv: "", platform: "linux" });
  const darwin = runDoctor({ cwd, pathEnv: "", platform: "darwin" });
  const win = runDoctor({ cwd, pathEnv: "", platform: "win32" });
  for (const r of [linux, darwin, win]) {
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("");
    for (const name of REQUIRED) expect(r.stdout).toMatch(new RegExp(`${name}\\s+missing`));

    expect(r.stdout).toMatch(/gh\s+missing \(optional\)/);
    expect(r.stdout).toMatch(/clasp\s+missing \(optional\)/);
    expect(r.stdout).toMatch(/google-workspace\s+missing \(optional\)/);
    expect(r.stdout).toMatch(/speak\s+missing \(optional\)/);
    expect(r.stdout).toMatch(/ffmpeg\s+missing \(optional\)/);
    expect(r.stdout).toMatch(/whisper-cli\s+missing \(optional\)/);
    expect(r.stdout).toMatch(/install \(print-only; not run\)/);
    expect(r.stdout).not.toMatch(/playwright install/);
  }
  expect(linux.stdout).toMatch(/curl -fsSL https:\/\/pkg\.lightpanda\.io\/install\.sh \| bash/);
  expect(darwin.stdout).toMatch(/brew tap lightpanda-io\/browser/);
  expect(win.stdout).toMatch(/winget install Google\.Chrome/);
  expect(win.stdout).toMatch(/PATH|shim/i);
  expect(win.stdout).toMatch(/WSL/i);
});

it("all required present, gh missing → exit 0; gh optional only; no required install dump", () => {
  const { cwd, bin } = toolsCwd("doc-ok-");
  const r = linuxRun(cwd, bin);
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/bun\s+ok/);
  expect(r.stdout).toMatch(/git\s+ok/);
  expect(r.stdout).toMatch(/gh\s+missing \(optional\)/);
  expect(r.stdout).not.toMatch(/^maps /m);
  expect(r.stdout).not.toMatch(/maps missing/);
  expect(r.stdout).not.toMatch(/install \(print-only; not run\)/);
});

it.each([
  ["gh", []],
  ["clasp", ["clasp"]],
  ["ffmpeg", ["listen"]],
  ["whisper-cli", ["listen"]],
])("%s present is ok not a required miss", (name, packs) => {
  const { cwd, bin } = toolsCwd(`doc-${name}-`);
  if (packs.length > 0) enablePacks(packs);
  const found = writeBin(bin, name);
  const r = linuxRun(cwd, bin);
  expect(r.code).toBe(0);
  expectStdoutPath(r.stdout, found);
  expect(r.stdout).not.toMatch(new RegExp(`${name}\\s+missing`));
});

it("prints the bun version and path on the bun row", () => {
  const { cwd, bin } = toolsCwd("doc-bun-ok-");
  const r = linuxRun(cwd, bin);
  expect(r.stdout).toMatch(/^bun\s+ok\s+1\.4\.4 \(.*bun.*\)$/m);
});

it("needs the bun in package.json engines: 1.3.0 fails, a newer bun passes", () => {
  const { cwd, bin } = toolsCwd("doc-bun-old-");
  const pkg = JSON.parse(
    fs.readFileSync(path.join(here, "..", "..", "package.json"), "utf8"),
  ) /* the repo's package.json declares engines.bun */ as { engines: { bun: string } };
  expect(pkg.engines.bun).toBe(`>=${BUN_MIN_FALLBACK}`);
  writeBun(bin, "1.3.0");
  const old = linuxRun(cwd, bin);
  expect(old.code).toBe(1);
  expect(old.stdout).toMatch(/^bun\s+need ≥1\.4\.4\s+1\.3\.0 \(.*bun.*\)$/m);
  writeBun(bin, "1.10.0");
  const newer = linuxRun(cwd, bin);
  expect(newer.stdout).toMatch(/^bun\s+ok\s+1\.10\.0 /m);
});

it("rtk from node_modules/.bin counts as bunx-able", () => {
  const cwd = tmp("doc-bunx-");
  const bin = path.join(cwd, "bin");
  writeBun(bin);
  writeBin(bin, "git");
  writeBin(bin, "lightpanda");
  writeBin(bin, "chromium");
  const rtk = writeBin(path.join(cwd, "node_modules", ".bin"), "rtk");
  const r = linuxRun(cwd, bin);
  expect(r.code).toBe(0);
  expectStdoutPath(r.stdout, rtk);
  expect(r.stdout).not.toMatch(/rulesync/);
});

it("chromium family name google-chrome satisfies chromium", () => {
  const cwd = tmp("doc-chrome-");
  const bin = path.join(cwd, "bin");
  writeRequired(bin, { chromiumName: "google-chrome" });
  const r = linuxRun(cwd, bin);
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/chromium\s+ok/);
  expect(r.stdout).not.toMatch(/chromium\s+missing/);
});
