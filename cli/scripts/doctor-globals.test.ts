import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { globalsSetup, linuxRun, runDoctor, tmp, toolsCwd } from "./__fixtures__/doctor-kit.ts";
import { globalsRow } from "./doctor-rows.ts";
import { syncGlobals } from "./sync-global-settings.ts";

it("globals row is ok once the globals were applied", async () => {
  const { cwd, home, run } = globalsSetup();
  expect(syncGlobals({ apply: true, home, workspaceRoot: cwd }).ok).toBe(true);
  const r = await run();
  expect(r.stdout).toMatch(/^globals\s+ok\s*$/m);
  expect(r.code).toBe(0);
});

it("globals row shows the first drift line with the apply hint", async () => {
  const { cwd, home, run } = globalsSetup();
  expect(syncGlobals({ apply: true, home, workspaceRoot: cwd }).ok).toBe(true);
  fs.writeFileSync(path.join(home, ".cursor/cli-config.json"), "{}");
  const r = await run();
  expect(r.stdout).toMatch(/^globals\s+drift: cursor \.cursor\/cli-config\.json approvalMode; run `bun repo yolo`$/m);
  expect(r.stdout.match(/^globals/gm)).toHaveLength(1);
  expect(r.code).toBe(0);
});

it("globals row shows the first drift line when nothing was applied", async () => {
  const { run } = globalsSetup();
  const r = await run();
  expect(r.stdout).toMatch(/^globals\s+drift: grok \.grok\/config\.toml ui\.permission_mode;/m);
});

it("globals row shows a check error", async () => {
  const { cwd, run } = globalsSetup();
  fs.rmSync(path.join(cwd, "agents/global-settings/cursor.json"));
  const r = await run();
  expect(r.stdout).toMatch(/^globals\s+missing payload: agents\/global-settings\/cursor\.json$/m);
});

it("globals row reads the manifest from the package root, not from the workspace", async () => {
  const { cwd, home } = globalsSetup();
  const bin = path.join(cwd, "bin");
  const empty = tmp("doc-empty-pkg-");
  expect(await globalsRow(cwd, home, empty)).toBeNull();
  const other = tmp("doc-work-");

  const ws = runDoctor({
    cwd: other,
    globals: await globalsRow(other, home, cwd),
    home,
    pathEnv: bin,
    platform: "linux",
  });

  expect(ws.stdout).toMatch(/^globals\s/m);
});

it("globals row says unavailable with the install hint when check-globals cannot load", async () => {
  const { cwd, home } = globalsSetup();
  vi.doMock(new URL("./check-globals.ts", import.meta.url).href, () => {
    throw new Error("Cannot find package 'smol-toml'");
  });

  try {
    // vitest wraps the factory's error; the row keeps the first line of whatever the load threw
    expect(await globalsRow(cwd, home, cwd)).toMatch(/^globals\s+unavailable\s+[^\n]+; run bun install$/);
  } finally {
    vi.doUnmock(new URL("./check-globals.ts", import.meta.url).href);
  }

  expect(await globalsRow(cwd, home, cwd)).toMatch(/^globals\s+drift/);
});

it("globals row is absent when the repo ships no globals manifest", async () => {
  const { cwd, bin } = toolsCwd("doc-no-globals-");
  expect(await globalsRow(cwd, undefined, cwd)).toBeNull();
  const r = linuxRun(cwd, bin);
  expect(r.stdout).not.toMatch(/^globals/m);
});
