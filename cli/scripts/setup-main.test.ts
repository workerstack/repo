import fs from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { main } from "./setup.ts";
import type { SetupIo } from "./setup.ts";
import { bare, captureIo, cleanSetup, enablePacks, plant, spyStd } from "./fixtures/setup-kit.ts";

afterEach(cleanSetup);

const quiet = { interactive: false, env: { CI: "1" }, ...bare };

it("main resolves the gw alias and reports the target's failure", async () => {
  const home = plant("setup-m-alias-");
  const cwd = enablePacks(plant("setup-m-alias-cwd-"), ["google-workspace"]);
  const io = captureIo();
  const loginFn = () => Promise.resolve();
  const code = await main(["gw", "--creds", "{}"], { ...quiet, io, home, cwd, loginFn });
  expect(code).toBe(1);
  expect(io.errs.join("\n")).toMatch(/installed\.client_id/);
});

it("main prints a thrown string, or an Error without a message, as text", async () => {
  const home = plant("setup-m-throw-");
  const cwd = enablePacks(plant("setup-m-throw-cwd-"), ["google-workspace"]);
  const creds = JSON.stringify({ installed: { client_id: "c" } });
  const argv = ["google-workspace", "--creds", creds];
  const thrown = (v: unknown) => () => Promise.reject(v);
  const io = captureIo();
  expect(await main(argv, { ...quiet, io, home, cwd, loginFn: thrown("boom") })).toBe(1);
  expect(await main(argv, { ...quiet, io, home, cwd, loginFn: thrown({ message: "" }) })).toBe(1);
  expect(await main(argv, { ...quiet, io, home, cwd, loginFn: thrown(new Error("bad login")) })).toBe(1);
  expect(io.errs).toEqual(["boom", "[object Object]", "bad login"]);
});

it("main takes home from env HOME, then USERPROFILE, then the stubbed os home", async () => {
  const a = plant("setup-m-home-a-");
  const b = plant("setup-m-home-b-");
  const cwd = plant("setup-m-home-cwd-");
  const c = plant("setup-m-home-c-", true);
  const run = (env: Record<string, string>) => main(["jev", "--api-key", "k"], { ...quiet, env, io: captureIo(), cwd });
  await run({ HOME: a, USERPROFILE: b });
  await run({ USERPROFILE: b });
  await run({});
  expect([a, b, c].map((h) => fs.existsSync(`${h}/.workerstack/jev.json`))).toEqual([true, true, true]);
});

it("main defaults cwd, env, platform and PATH from the process", async () => {
  const cwd = plant("setup-m-defaults-");
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  vi.stubEnv("PATH", plant("setup-m-defaults-bin-"));
  const io = captureIo();
  const code = await main(["browser"], { interactive: false, home: plant("setup-m-defaults-home-"), io });
  expect(code).toBe(0);
  expect(io.logs.at(-1)).toMatch(/browser {2}missing/);
});

it("main decides interactivity from the given stdin and stdout", async () => {
  const home = plant("setup-m-tty-");
  const cwd = plant("setup-m-tty-cwd-");
  const select = vi.fn(() => Promise.resolve("jev"));
  const io: SetupIo = { ...captureIo(), select, password: () => Promise.resolve("k") };
  const tty = { isTTY: true };
  const opts = { io, home, cwd, env: {}, stdin: tty, stdout: tty, ...bare };
  expect(await main([], opts)).toBe(0);
  expect(select).toHaveBeenCalledTimes(1);
  expect(await main([], { ...opts, stdin: { isTTY: false } })).toBe(1);
});

it("main reads the process stdio when none are given", async () => {
  const io = captureIo();
  const opts = { io, home: plant("setup-m-stdio-"), cwd: plant("setup-m-stdio-cwd-"), env: { CI: "1" }, ...bare };
  expect(await main([], opts)).toBe(1);
  expect(io.errs.join("\n")).toContain("usage: setup");
});

it("main shows usage when the terminal menu answer is not a target or there is no select", async () => {
  const base = { home: plant("setup-m-menu-"), cwd: plant("setup-m-menu-cwd-"), interactive: true, ...bare };
  const odd = { ...captureIo(), select: () => Promise.resolve("nope") };
  expect(await main([], { ...base, io: odd })).toBe(1);
  const none = captureIo();
  expect(await main([], { ...base, io: none })).toBe(1);
  expect(odd.errs.join("")).toContain("usage: setup");
});

it("main builds the default prompts and writes through stdout and stderr", async () => {
  const std = spyStd();
  const home = plant("setup-m-default-io-");
  const cwd = plant("setup-m-default-io-cwd-");
  const opts = { interactive: true, home, cwd, env: {}, ...bare };
  expect(await main(["jev", "--api-key", "k"], opts)).toBe(0);
  expect(std.out.join("")).toContain("jev  ok");
  expect(await main(["listen"], opts)).toBe(1);
  expect(std.err.join("")).toContain("listen is off");
});

it("main asks before redoing a target that is ok, and --redo skips the question", async () => {
  const home = plant("setup-m-redo-");
  const cwd = plant("setup-m-redo-cwd-");
  const confirm = vi.fn(() => Promise.resolve(false));
  const io = { ...captureIo(), confirm };
  const opts = { io, home, cwd, interactive: true, env: {}, ...bare };
  await main(["jev", "--api-key", "k1"], opts);
  expect(await main(["jev"], opts)).toBe(0);
  expect(confirm.mock.calls[0]).toEqual([{ message: "jev already ok (config). Redo?", initialValue: false }]);
  expect(io.logs).toContain("skip jev (already ok)");
  expect(await main(["jev", "--redo", "--api-key", "k2"], opts)).toBe(0);
  expect(confirm).toHaveBeenCalledTimes(1);
});

it("main redoes an ok target without asking when the io cannot confirm, or when confirmed", async () => {
  const home = plant("setup-m-redo2-");
  const cwd = plant("setup-m-redo2-cwd-");
  const opts = { home, cwd, interactive: true, env: {}, ...bare };
  await main(["jev", "--api-key", "k1"], { ...opts, io: captureIo() });
  expect(await main(["jev", "--api-key", "k2"], { ...opts, io: captureIo() })).toBe(0);
  const yes = { ...captureIo(), confirm: () => Promise.resolve(true) };
  expect(await main(["jev", "--api-key", "k3"], { ...opts, io: yes })).toBe(0);
  expect(yes.logs).not.toContain("skip jev (already ok)");
});
