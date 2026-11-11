import type { SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { spawnReply } from "./__fixtures__/ci-config-run.ts";
import { cleanTemps, tempDir } from "./__fixtures__/turn-repo.ts";
import { checkGate, defaultSpawn, type CiSpawn } from "./ci-checks.ts";

afterEach(cleanTemps);

function run(over: Partial<SpawnSyncReturns<string>>): { root: string; spawn: CiSpawn } {
  return {
    root: "/r",
    spawn: () => spawnReply(over),
  };
}

describe("checkGate", () => {
  it("spawns argv from the root and passes on exit 0", () => {
    const spawn = vi.fn<CiSpawn>(() => spawnReply());
    const gate = checkGate("product-tree", ["bun", "a.ts", "--x"], { root: "/root", spawn });
    expect(gate).toStrictEqual({ label: "product-tree ok", ok: true, output: [], ran: true });
    expect(spawn.mock.calls).toStrictEqual([["bun", ["a.ts", "--x"], { cwd: "/root", encoding: "utf8" }]]);
  });

  it("fails with the exit code and the command's output", () => {
    const gate = checkGate("a", ["x"], run({ status: 1, stderr: "err\n", stdout: "out\n" }));
    expect(gate).toStrictEqual({ label: "a failed (exit 1)", ok: false, output: ["out\nerr\n"], ran: true });
  });

  it("names the signal of a killed command", () => {
    const gate = checkGate("a", ["x"], run({ signal: "SIGKILL", status: null }));
    expect(gate.label).toBe("a failed (exit SIGKILL)");
  });

  it("says the command was not found when it is missing", () => {
    const error = Object.assign(new Error("spawnSync infra-gen-cli ENOENT"), { code: "ENOENT" });
    const gate = checkGate("infra-gen", ["infra-gen-cli", "--check"], run({ error, status: null }));
    expect(gate).toStrictEqual({
      label: "infra-gen failed (infra-gen-cli not found)",
      ok: false,
      output: [],
      ran: false,
    });
  });

  it("gives any other spawn error's message", () => {
    const gate = checkGate("a", ["x"], run({ error: new Error("EACCES nope"), status: null }));
    expect(gate).toStrictEqual({ label: "a failed (EACCES nope)", ok: false, output: [], ran: false });
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
