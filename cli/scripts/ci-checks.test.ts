import type { SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkGate, defaultSpawn, type CiSpawn } from "./ci-checks.ts";
import { cleanTemps, tempDir } from "./fixtures/turn-repo.ts";

afterEach(cleanTemps);

const reply = (over: Partial<SpawnSyncReturns<string>> = {}): SpawnSyncReturns<string> => ({
  status: 0,
  signal: null,
  stdout: "",
  stderr: "",
  output: [],
  pid: 0,
  ...over,
});
const run = (over: Partial<SpawnSyncReturns<string>>): { root: string; spawn: CiSpawn } => ({
  root: "/r",
  spawn: () => reply(over),
});

describe("checkGate", () => {
  it("spawns argv from the root and passes on exit 0", () => {
    const calls: unknown[] = [];
    const spawn: CiSpawn = (cmd, args, opts) => {
      calls.push([cmd, args, opts.cwd]);
      return reply();
    };
    const gate = checkGate("product-tree", ["bun", "a.ts", "--x"], { root: "/root", spawn });
    expect(gate).toEqual({ label: "product-tree ok", ok: true, output: [], ran: true });
    expect(calls).toEqual([["bun", ["a.ts", "--x"], "/root"]]);
  });

  it("fails with the exit code and the command's output", () => {
    const gate = checkGate("a", ["x"], run({ status: 1, stdout: "out\n", stderr: "err\n" }));
    expect(gate).toEqual({ label: "a failed (exit 1)", ok: false, output: ["out\nerr\n"], ran: true });
  });

  it("names the signal of a killed command", () => {
    const gate = checkGate("a", ["x"], run({ status: null, signal: "SIGKILL" }));
    expect(gate.label).toBe("a failed (exit SIGKILL)");
  });

  it("says the command was not found when it is missing", () => {
    const error = Object.assign(new Error("spawnSync infra-gen-cli ENOENT"), { code: "ENOENT" });
    const gate = checkGate("infra-gen", ["infra-gen-cli", "--check"], run({ error, status: null }));
    expect(gate).toEqual({ label: "infra-gen failed (infra-gen-cli not found)", ok: false, output: [], ran: false });
  });

  it("gives any other spawn error's message", () => {
    const gate = checkGate("a", ["x"], run({ error: new Error("EACCES nope"), status: null }));
    expect(gate).toEqual({ label: "a failed (EACCES nope)", ok: false, output: [], ran: false });
  });
});

describe("defaultSpawn", () => {
  it("runs a real command", () => {
    const opts = { cwd: tempDir("ci-spawn-"), encoding: "utf8" } as const;
    expect(defaultSpawn(process.execPath, ["-e", "process.stdout.write('hi')"], opts).stdout).toBe("hi");
  });

  it.skipIf(process.platform !== "win32")("starts a .cmd shim", () => {
    const dir = tempDir("ci-shim-");
    const shim = path.join(dir, "shim-tool.cmd");
    fs.writeFileSync(shim, "@echo shimmed\r\n");
    const done = defaultSpawn(shim, [], { cwd: dir, encoding: "utf8" });
    expect(done.status).toBe(0);
    expect(done.stdout).toContain("shimmed");
  });
});
