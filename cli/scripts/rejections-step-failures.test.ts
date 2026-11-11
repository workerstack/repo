import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { cleanTemps, tempDir, write } from "./fixtures/turn-repo.ts";
import { rejectionsStep } from "./rejections-step.ts";
import type { Turn } from "./turn-steps.ts";

afterEach(() => {
  cleanTemps();
  vi.unstubAllEnvs();
});

const turnOf = (root: string, packages: string[], owner: string): Turn => ({
  bins: { tsc: () => ({ code: 0, stderr: "", stdout: "" }), vitest: () => null },
  changes: [{ deleted: false, owner, rel: `${owner}/a.ts` }],
  packages,
  root,
  skips: [],
});

/** A hook running these tests may have pointed git at its own repo. */
function clearGitEnv() {
  for (const name of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_PREFIX"]) {
    vi.stubEnv(name, undefined);
  }
}

it("a root git cannot list fails the step with git's reason", () => {
  clearGitEnv();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rej-nogit-"));
  try {
    const result = rejectionsStep(turnOf(root, [], ""));
    expect(result?.ok).toBe(false);
    expect(result?.label).toBe("rejections failed");
    expect(result?.output[0]).toMatch(/^repo turn: git ls-files failed: .*not a git repository/);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

it("a problem that names no reject file fails the step without a count", () => {
  clearGitEnv();
  const root = tempDir("rej-notsconfig-");
  spawnSync("git", ["init", "-q"], { cwd: root });
  write(root, { "pkg/a.reject.ts": "export {};\n", "pkg/package.json": "{}\n" });
  fs.mkdirSync(path.join(root, "pkg/tsconfig.json"));
  const result = rejectionsStep(turnOf(root, ["pkg"], "pkg"));
  expect(result?.ok).toBe(false);
  expect(result?.label).toBe("rejections failed");
  expect(result?.output).toHaveLength(1);
  expect(result?.output[0]).toMatch(/^repo turn: rejections: pkg\/tsconfig\.json: /);
});

it("a touched package without reject files is absent", () => {
  clearGitEnv();
  const root = tempDir("rej-none-");
  spawnSync("git", ["init", "-q"], { cwd: root });
  write(root, { "pkg/a.ts": "export {};\n" });
  expect(rejectionsStep(turnOf(root, ["pkg"], "pkg"))).toBeNull();
});
