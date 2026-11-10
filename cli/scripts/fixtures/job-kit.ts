import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { BUN } from "../../../dev/test-paths.ts";
import { main } from "../job.ts";

const realPath = process.env.PATH ?? "";
const planted: string[] = [];

/** `PATH` without the dirs that hold any of `tools`. */
export function pathSans(...tools: string[]): string {
  return realPath
    .split(path.delimiter)
    .filter((dir) => !tools.some((t) => fs.existsSync(path.join(dir, t)) || fs.existsSync(path.join(dir, `${t}.exe`))))
    .join(path.delimiter);
}

/**
 * Every test in the calling file runs with no `rtk` on PATH, so the exec fallback arm is the same on a machine that
 * has rtk and on one that has not, and removes the temp dirs it planted.
 */
export function useJobEnv(): void {
  beforeEach(() => {
    vi.stubEnv("PATH", pathSans("rtk"));
  });
  afterEach(() => {
    // A child (the planted tool a killed shell left running) may hold the dir for a moment on Windows: EBUSY.
    for (const d of planted.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
}

/** A new temp dir in the realpath spelling, removed after the test. */
export function plant(prefix = "job-"): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  planted.push(dir);
  return dir;
}

/** Writes `files` (relative path → text) under `dir`. */
export function plantFiles(dir: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
}

/** The stash dir of a root, created. */
export function stashDirOf(root: string): string {
  const dir = path.join(root, ".tmp", "repo", "stash");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A script the planted tool runs: a bun script behind a PATH-resolvable `name` launcher. Returns its dir. */
export function plantTool(name: string, js: string): string {
  const dir = plant("job-tool-");
  fs.writeFileSync(path.join(dir, `${name}.js`), js);
  fs.writeFileSync(path.join(dir, name), `#!/bin/sh\nexec "${BUN}" "${path.join(dir, `${name}.js`)}" "$@"\n`, {
    mode: 0o755,
  });
  fs.writeFileSync(path.join(dir, `${name}.cmd`), `@"${BUN}" "%~dp0${name}.js" %*\r\n`);
  return dir;
}

/** Puts `dir` first on PATH and leaves out any real rtk and rg. */
export function pathWith(dir: string): void {
  vi.stubEnv("PATH", `${dir}${path.delimiter}${pathSans("rtk", "rg")}`);
}

/** Runs `fn` with `dir` as the process cwd, for code that defaults to it. */
export function inDir<T>(dir: string, fn: () => T): T {
  const before = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(before);
  }
}

/** Runs `main(argv)` from `cwd` and returns the exit code with what it wrote to stdout. */
export function runMain(argv: string[], cwd: string): { code: number; out: string } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    const code = inDir(cwd, () => main(argv));
    return { code, out: chunks.join("") };
  } finally {
    spy.mockRestore();
  }
}
