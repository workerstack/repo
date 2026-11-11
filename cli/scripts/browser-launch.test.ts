import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  alive,
  cleanBrowser,
  deadPid,
  exec,
  expectGone,
  failure,
  holder,
  killPid,
  onStop,
  plant,
  readStored,
  sessionPath,
  tmp,
  writeDud,
  writeFake,
  writeLauncher,
  writeMjs,
} from "./fixtures/browser-kit.ts";

afterEach(cleanBrowser);

it("nav needs a url", async () => {
  const cwd = tmp("browser-nav-nourl-");
  expect((await exec(cwd, ["nav"])).stderr).toBe("nav <url>\n");
  expect((await exec(cwd, ["nav", "   "])).stderr).toBe("nav <url>\n");
});

it("nav stops the engine of the session it replaces, with or without a recorded pid", async () => {
  const cwd = tmp("browser-nav-prev-");
  const lightpanda = writeFake(path.join(cwd, "bin"), "lightpanda");
  const bins = { chromium: "", lightpanda };
  const old = holder();
  plant(cwd, { engine: "chromium", lastRefs: {}, pid: old, port: 1 });
  expect((await exec(cwd, ["nav", "https://example.com/"], { bins })).code).toBe(0);
  await expectGone(old);
  const fresh = readStored(cwd).pid;
  onStop(() => killPid(fresh));
  expect(alive(fresh)).toBe(true);
  plant(cwd, { engine: "chromium", lastRefs: {}, port: 1 });
  expect((await exec(cwd, ["nav", "https://example.com/b"], { bins })).code).toBe(0);
});

it("nav fails with the install hint when the engine never comes up", async () => {
  const cwd = tmp("browser-nav-dud-");
  const bins = {
    chromium: "",
    lightpanda: writeDud(path.join(cwd, "bin"), "lightpanda"),
  };
  const r = await exec(cwd, ["nav", "https://example.com/"], {
    bins,
    readyMs: 250,
  });
  expect(r.code).toBe(1);
  expect(r.stderr).toMatch(/^no browser engine; install lightpanda/);
  expect(fs.existsSync(sessionPath(cwd))).toBe(false);
});

it("nav reports a missing engine binary as a failure instead of an unhandled spawn error", async () => {
  const cwd = tmp("browser-nav-missing-");
  const bins = {
    chromium: "",
    lightpanda: path.join(cwd, "bin", "no-such-lightpanda"),
  };
  const r = await exec(cwd, ["nav", "https://example.com/"], {
    bins,
    readyMs: 2000,
  });
  expect(r.code).toBe(1);
  expect(r.stderr).toMatch(/^no browser engine; install lightpanda/);
  expect(r.stderr).not.toMatch(/ENOENT|Unhandled/);
});

it("nav fails with the install hint when chromium is forced and never comes up", async () => {
  const cwd = tmp("browser-nav-dudc-");
  const bins = {
    chromium: writeDud(path.join(cwd, "bin"), "chromium"),
    lightpanda: "",
  };
  const r = await exec(cwd, ["nav", "https://example.com/"], {
    bins,
    platform: "win32",
    readyMs: 250,
  });
  expect(r.stderr).toMatch(/^no browser engine; install lightpanda/);
});

it("nav fails with the install hint when lightpanda fails its probe and there is no chromium", async () => {
  const cwd = tmp("browser-nav-probe-");
  const lightpanda = writeFake(path.join(cwd, "bin"), "lightpanda", {
    failProbe: true,
  });
  const r = await exec(cwd, ["nav", "https://example.com/"], {
    bins: { chromium: "", lightpanda },
  });
  expect(r.code).toBe(1);
  expect(r.stderr).toMatch(/^no browser engine; install lightpanda/);
  expect(fs.existsSync(sessionPath(cwd))).toBe(false);
});

it("nav reports 'engine not ready' when the chromium fallback never comes up either", async () => {
  const cwd = tmp("browser-nav-probe2-");
  const lightpanda = writeFake(path.join(cwd, "bin"), "lightpanda", {
    failProbe: true,
  });
  const chromium = writeDud(path.join(cwd, "bin"), "chromium");
  const r = await exec(cwd, ["nav", "https://example.com/"], {
    bins: { chromium, lightpanda },
    readyMs: 250,
  });
  expect(r).toStrictEqual(failure("engine not ready\n"));
});

it("nav fails when the engine refuses to navigate, but goes on when it only cannot enable pages", async () => {
  const cwd = tmp("browser-nav-refuse-");
  const bad = writeFake(path.join(cwd, "bin"), "lightpanda", {
    state: { replies: { "Page.navigate": "nav broke" } },
  });
  const r = await exec(cwd, ["nav", "https://example.com/"], {
    bins: { chromium: "", lightpanda: bad },
  });
  expect(r).toStrictEqual(failure("nav broke\n"));
  const ok = writeFake(path.join(cwd, "bin2"), "lightpanda", {
    state: { replies: { "Page.enable": "no" } },
  });
  const r2 = await exec(cwd, ["nav", "https://example.com/"], {
    bins: { chromium: "", lightpanda: ok },
  });
  expect(r2.stdout).toBe("engine: lightpanda\nurl: https://example.com/\n");
});

it("nav launches a windows .cmd shim through its sibling .mjs, or through a shell without one", async () => {
  const cwd = tmp("browser-nav-cmd-");
  const bin = path.join(cwd, "bin");
  const withMjs = writeLauncher(path.join(bin, "chromium.cmd"), writeMjs(path.join(bin, "chromium.mjs"), {}));
  const a = await exec(cwd, ["nav", "https://example.com/"], {
    bins: { chromium: withMjs, lightpanda: "" },
    platform: "win32",
  });
  expect(a.stdout).toBe("engine: chromium\nurl: https://example.com/\n");
  const lone = writeLauncher(path.join(bin, "edge.BAT"), writeMjs(path.join(bin, "engine.mjs"), {}));
  const b = await exec(cwd, ["nav", "https://example.com/b"], {
    bins: { chromium: lone, lightpanda: "" },
    platform: "win32",
  });
  expect(b.stdout).toBe("engine: chromium\nurl: https://example.com/b\n");
});

it("stop clears a session that has no pid or a dead one", async () => {
  const cwd = tmp("browser-stop-nopid-");
  plant(cwd, { engine: "lightpanda", lastRefs: {}, port: 1 });
  expect(await exec(cwd, ["stop"])).toStrictEqual({
    code: 0,
    stderr: "",
    stdout: "stopped\n",
  });
  expect(fs.existsSync(sessionPath(cwd))).toBe(false);
  plant(cwd, { engine: "lightpanda", lastRefs: {}, pid: deadPid(), port: 1 });
  expect((await exec(cwd, ["stop"])).code).toBe(0);
  expect(fs.existsSync(sessionPath(cwd))).toBe(false);
});

it("stop ends a stubborn process on windows by force, and shrugs off a dead one", async () => {
  const cwd = tmp("browser-stop-win-");
  const src = "process.on('SIGTERM', () => {}); console.log('up'); setTimeout(() => {}, 60000)";
  const stubborn = spawn(process.execPath, ["-e", src], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const pid = stubborn.pid ?? 0;
  onStop(() => killPid(pid));
  await new Promise<void>((r) => stubborn.stdout.once("data", () => r()));
  plant(cwd, { engine: "chromium", lastRefs: {}, pid, port: 1 });
  expect((await exec(cwd, ["stop"], { platform: "win32" })).code).toBe(0);
  expect(fs.existsSync(sessionPath(cwd))).toBe(false);
  plant(cwd, { engine: "chromium", lastRefs: {}, pid: deadPid(), port: 1 });
  expect((await exec(cwd, ["stop"], { platform: "win32" })).code).toBe(0);
});
