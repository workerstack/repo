import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "./spawn.mjs";

const node = process.execPath;

describe("spawnSync", () => {
  it("returns status and output like child_process.spawnSync", () => {
    const r = spawnSync(node, ["-e", "process.stdout.write('hi'); process.exit(3)"], { encoding: "utf8" });
    expect(r.status).toBe(3);
    expect(r.stdout).toBe("hi");
  });
});

describe("execFileSync", () => {
  it("returns stdout on exit 0", () => {
    expect(execFileSync(node, ["-e", "process.stdout.write('ok')"], { encoding: "utf8" })).toBe("ok");
  });

  it("throws with the exit code on a nonzero exit", () => {
    expect(() => execFileSync(node, ["-e", "process.exit(2)"], {})).toThrow(/exited with 2$/);
  });

  it("throws with the signal when the child is killed", () => {
    expect(() => execFileSync(node, ["-e", "process.kill(process.pid, 'SIGTERM')"], {})).toThrow(
      process.platform === "win32" ? /exited with/ : /exited with SIGTERM$/,
    );
  });

  it("throws the spawn error for a missing command", () => {
    expect(() => execFileSync("grunt-no-such-command-e2e", [], {})).toThrow(/ENOENT/);
  });
});
