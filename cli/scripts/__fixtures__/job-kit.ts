import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { bunPath } from "../../../dev/test-paths.ts";
import { main } from "../job.ts";
import { NO_SUCH_PROCESS, PID_FILE, STUB_EXIT_POLL_MS, STUB_EXIT_WAIT_MS } from "./job-kit.constants.ts";
import { removeTemps } from "../../__fixtures__/remove-temps.ts";

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
  afterEach(async () => {
    // A stub a killed shim left running holds its dir (EBUSY on Windows): end every recorded pid first, on every OS.
    await Promise.all(planted.flatMap((d) => stubPids(d)).map(endProcess));
    removeTemps(planted.splice(0));
  });
}

/** The pids the stubs planted in `dir` recorded. */
function stubPids(dir: string): number[] {
  try {
    return fs
      .readFileSync(path.join(dir, PID_FILE), "utf8")
      .split("\n")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== NO_SUCH_PROCESS;
  }
}

/** Kills `pid` if it is still running and waits until it is gone. */
async function endProcess(pid: number): Promise<void> {
  try {
    process.kill(pid);
  } catch {
    return;
  }
  for (let waited = 0; alive(pid) && waited < STUB_EXIT_WAIT_MS; waited += STUB_EXIT_POLL_MS) {
    await new Promise((r) => setTimeout(r, STUB_EXIT_POLL_MS));
  }
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
  const dir = path.join(root, ".repo", "tmp", "stash");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A script the planted tool runs: a bun script behind a PATH-resolvable `name` launcher. Returns its dir. */
export function plantTool(name: string, js: string): string {
  const dir = plant("job-tool-");
  const record = `require("node:fs").appendFileSync(require("node:path").join(__dirname, ${JSON.stringify(PID_FILE)}), process.pid + "\\n");\n`;
  fs.writeFileSync(path.join(dir, `${name}.js`), record + js);
  fs.writeFileSync(path.join(dir, name), `#!/bin/sh\nexec "${bunPath()}" "${path.join(dir, `${name}.js`)}" "$@"\n`, {
    mode: 0o755,
  });
  fs.writeFileSync(path.join(dir, `${name}.cmd`), `@"${bunPath()}" "%~dp0${name}.js" %*\r\n`);
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
