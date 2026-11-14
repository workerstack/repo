import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { captureTool, runTool, tsgolintSpecifier } from "./lint.ts";

const SLOW = 60_000;

const { tempDir } = useTempDirs("workerstack-lint-spawn-");

afterEach(() => vi.unstubAllEnvs());

describe("the oxlint environment", () => {
  it("keeps an inherited NODE_PATH behind the plugin modules dir", { timeout: SLOW }, () => {
    vi.stubEnv("NODE_PATH", path.join(tempDir(), "modules"));
    const run = captureTool("oxlint", ["--version"], tempDir());
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/\d+\.\d+/);
  });
});

it("names the tsgolint binary with .exe on Windows only", () => {
  expect(tsgolintSpecifier("win32", "x64")).toBe("@oxlint-tsgolint/win32-x64/tsgolint.exe");
  expect(tsgolintSpecifier("linux", "arm64")).toBe("@oxlint-tsgolint/linux-arm64/tsgolint");
});

/** A temp repo with the standards pack on and an oxlint config, so runTool reaches the spawn. */
function standardsRepo(): string {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "package.json"), '{ "name": "app", "type": "module" }\n');
  fs.writeFileSync(path.join(root, "repo.config.ts"), 'export default { packs: ["standards"] };\n');
  fs.writeFileSync(path.join(root, ".oxlintrc.jsonc"), "{}\n");

  return root;
}

describe("runTool without an injected runner", () => {
  it("returns 1 when the tool process dies of a signal", async () => {
    const root = standardsRepo();
    const killer = path.join(tempDir(), "killer");
    fs.writeFileSync(killer, "#!/bin/sh\nkill -9 $$\n", { mode: 0o755 });
    vi.spyOn(process, "execPath", "get").mockReturnValue(killer);
    expect(await runTool("oxlint", [], { cwd: root, stderr: () => {} })).toBe(1);
  });

  it("returns 1 when the tool process cannot start", async () => {
    const root = standardsRepo();
    vi.spyOn(process, "execPath", "get").mockReturnValue(path.join(tempDir(), "no-such-bun"));
    expect(await runTool("oxlint", [], { cwd: root, stderr: () => {} })).toBe(1);
  });
});
