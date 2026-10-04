import crossSpawn from "cross-spawn";
import { describe, expect, it, vi } from "vitest";
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

  // Mocked: Windows has no signals, so a real kill reports an exit code there.
  it("throws with the signal when the child is killed", () => {
    const sync = vi.spyOn(crossSpawn, "sync").mockReturnValueOnce({ status: null, signal: "SIGTERM" } as never);
    expect(() => execFileSync("npm", ["install"], {})).toThrow(/^npm install exited with SIGTERM$/);
    sync.mockRestore();
  });

  it("throws the spawn error for a missing command", () => {
    expect(() => execFileSync("grunt-no-such-command-e2e", [], {})).toThrow(/ENOENT/);
  });
});
