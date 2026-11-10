import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { rootPath } from "./temp-root-env.ts";
import { setup } from "./temp-root.ts";

/** The runtime's own `bun-node-<hash>` dir in a run's temp root is not a test's leak; a test's own entry still is. */
let parent = "";
let exitCode: typeof process.exitCode;
const errors: string[] = [];

beforeEach(() => {
  parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "temp-root-shim-")));
  for (const name of ["TMPDIR", "TEMP", "TMP"]) vi.stubEnv(name, parent);
  vi.stubEnv("REPO_E2E_KEEP", undefined);
  exitCode = process.exitCode;
  process.exitCode = 0;
  errors.length = 0;
  vi.spyOn(process.stderr, "write").mockImplementation((text) => errors.push(String(text)) > 0);
});

afterEach(() => {
  process.exitCode = exitCode ?? 0;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(parent, { recursive: true, force: true });
});

it("lets a run pass that left only bun's node shim dir", () => {
  const teardown = setup();
  fs.mkdirSync(path.join(rootPath(), "bun-node-38afee6c8"));
  teardown();
  expect(process.exitCode).toBe(0);
  expect(errors).toEqual([]);
});

it("still names a test's own entry beside the shim dir", () => {
  const teardown = setup();
  fs.mkdirSync(path.join(rootPath(), "bun-node-38afee6c8"));
  fs.mkdirSync(path.join(rootPath(), "x"));
  teardown();
  expect(process.exitCode).toBe(1);
  expect(errors.join("")).toContain("tests left 1 entry in the run's temp root: x;");
});
