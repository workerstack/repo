import type { ChildProcess } from "node:child_process";
import fs from "node:fs";

import { expect, it } from "vitest";

import { put, tempDir, useTempDirs } from "./sync/__fixtures__/temp-dirs.ts";
import { configOf, tsgoOf, withTsApi } from "./ts-api.ts";
import { posix } from "./ts-program.ts";

useTempDirs();

/** A folder with a tsconfig.json, as a real posix path. */
function folder(): string {
  const dir = posix(fs.realpathSync(tempDir("ts-api-exit-")));
  put(dir, "tsconfig.json", "{}");

  return dir;
}

/** Whether `child` has exited, by a code or a signal. */
function hasExited(child: ChildProcess | undefined): boolean {
  return child !== undefined && (child.exitCode !== null || child.signalCode !== null);
}

it("returns only once the tsgo process it started has exited", async () => {
  const dir = folder();
  let tsgo: ChildProcess | undefined;

  await withTsApi(dir, async (run) => {
    await configOf(run, `${dir}/tsconfig.json`);
    tsgo = tsgoOf(run.api);
  });

  expect(hasExited(tsgo)).toBe(true);
});

it("returns when tsgo died during the work", async () => {
  const dir = folder();
  let tsgo: ChildProcess | undefined;

  const closed = withTsApi(dir, async (run) => {
    await configOf(run, `${dir}/tsconfig.json`);
    tsgo = tsgoOf(run.api);
    tsgo?.kill("SIGKILL");
    await new Promise((resolve) => tsgo?.once("exit", resolve));
  });

  await expect(closed).resolves.toBeUndefined();
  expect(hasExited(tsgo)).toBe(true);
});
