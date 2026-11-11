import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, vi } from "vitest";
import { runBrowser } from "../browser.ts";
import { serveCdp } from "../browser-serve.ts";
import type {
  BrowserResult,
  Engine,
  FakeCdpState,
  RunOpts,
} from "../browser.types.ts";
import { bunPath } from "../../../dev/test-paths.ts";
import { plantStub } from "../../__fixtures__/stub-bin.ts";
import { childEnv, readEnv } from "../../env.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const serveScript = path.join(here, "..", "browser-serve.ts");

const tmpDirs: string[] = [];
const stopFns: (() => void)[] = [];

/** Stops `pid` and its group, or on Windows its tree. */
export function killPid(pid: number): void {
  if (!pid) return;
  const quiet = (fn: () => void) => {
    try {
      fn();
    } catch {
      // already dead
    }
  };
  if (process.platform === "win32") {
    // The tree first: a shell shim's child outlives the shell and holds the dir open.
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      timeout: 1500,
      windowsHide: true,
    });
    quiet(() => process.kill(pid));
    return;
  }
  quiet(() => process.kill(-pid, "SIGTERM"));
  quiet(() => process.kill(pid, "SIGTERM"));
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function rmRetry(dir: string, tries = 6): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    const code = (err as /* rmSync throws errno errors */ NodeJS.ErrnoException)
      .code;
    if (
      tries <= 1 ||
      (code !== "EBUSY" && code !== "ENOTEMPTY" && code !== "EPERM")
    )
      throw err;
    pause(25 * (7 - tries));
    rmRetry(dir, tries - 1);
  }
}

export function sessionPath(cwd: string): string {
  return path.join(cwd, ".tmp/repo/browser/session.json");
}

/** Ends every engine, socket and stand-in the case started, then removes its dirs. */
export function cleanBrowser(): void {
  for (const f of stopFns.splice(0)) f();
  for (const d of tmpDirs.splice(0)) {
    try {
      const s = JSON.parse(
        fs.readFileSync(sessionPath(d), "utf8"),
      ) as /* written by the session code */ { pid?: number };
      if (s.pid) killPid(s.pid);
    } catch {
      // no session
    }
    rmRetry(d);
  }
}

/** Runs `fn` when the case ends. */
export function onStop(fn: () => void): void {
  stopFns.push(fn);
}

export function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

const BROWSER_NAMES = [
  "lightpanda",
  "chromium",
  "chromium-browser",
  "google-chrome",
  "google-chrome-stable",
  "chrome",
  "msedge",
  "microsoft-edge",
  "playwright",
];

function dirHasBrowser(dir: string): boolean {
  const names = BROWSER_NAMES.flatMap((n) =>
    process.platform === "win32" ? [n, `${n}.exe`, `${n}.cmd`] : [n],
  );
  return names.some((n) => fs.existsSync(path.join(dir, n)));
}

function mockPath(binDir: string): string {
  const rest = (readEnv().PATH || "")
    .split(path.delimiter)
    .filter((dir) => dir && dir !== binDir && !dirHasBrowser(dir));
  return [binDir, ...rest].join(path.delimiter);
}

/** A bun script at `file` that serves a fake engine with `state` on the port its argv names. */
export function writeMjs(file: string, state: Partial<FakeCdpState>): string {
  const body = `import { serveCdp } from ${JSON.stringify(pathToFileURL(serveScript).href)};
const argv = process.argv.slice(2);
let port = 0;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--port" || argv[i] === "--remote-debugging-port") {
    const v = argv[i + 1] || "";
    port = Number(String(v).replace(/^[^=]*=/, "")) || 0;
  } else if (String(argv[i]).startsWith("--remote-debugging-port=")) {
    port = Number(String(argv[i]).split("=")[1]) || 0;
  }
}
const { close } = await serveCdp(${JSON.stringify(state)}, { port });
process.on("SIGTERM", () => { close(); process.exit(0); });
process.on("SIGINT", () => { close(); process.exit(0); });
`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

/** An executable at dest that runs the bun script mjs with its arguments. */
export function writeLauncher(dest: string, mjs: string): string {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (process.platform === "win32") {
    fs.writeFileSync(
      dest,
      `@echo off\r\n${JSON.stringify(bunPath())} ${JSON.stringify(mjs)} %*\r\n`,
    );
  } else {
    fs.writeFileSync(
      dest,
      `#!/bin/sh\nexec ${JSON.stringify(bunPath())} ${JSON.stringify(mjs)} "$@"\n`,
      { mode: 0o755 },
    );
  }
  return dest;
}

/** A fake engine named `name` in binDir. */
export function writeFake(
  binDir: string,
  name: string,
  opts: {
    failProbe?: boolean;
    thinSnap?: boolean;
    state?: Partial<FakeCdpState>;
  } = {},
): string {
  const mjs = writeMjs(path.join(binDir, `${name}.mjs`), {
    failProbe: opts.failProbe ?? false,
    thinSnap: opts.thinSnap ?? false,
    ...opts.state,
  });
  return writeLauncher(
    path.join(binDir, process.platform === "win32" ? `${name}.cmd` : name),
    mjs,
  );
}

/** A launcher that exits at once, so the engine never answers. */
export function writeDud(dir: string, name: string): string {
  return plantStub(dir, name, { sh: "exit 1\n", cmd: "exit /b 1" });
}

/** The session as written to disk. */
export interface StoredSession {
  engine: string;
  pid: number;
  port: number;
  lastURL: string;
  lastRefs: Record<
    string,
    { role: string; name: string; backendNodeId: number }
  >;
  escalated: boolean;
  swapCount: number;
}

export function readStored(cwd: string): StoredSession {
  return JSON.parse(
    fs.readFileSync(sessionPath(cwd), "utf8"),
  ) as /* written by the session code */ StoredSession;
}

export function envFor(binDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = childEnv({ PATH: mockPath(binDir) });
  delete env.REPO_BROWSER;
  delete env.REPO_BROWSER_ENGINE;
  delete env.LIGHTPANDA_CDP_URL;
  return env;
}

/** A runner of `repo browser` in cwd with binDir's fakes first on PATH, as `platform`. */
export function runOn(
  platform: NodeJS.Platform,
): (cwd: string, args: string[], binDir: string) => Promise<BrowserResult> {
  return (cwd, args, binDir) =>
    runBrowser(args, { cwd, env: envFor(binDir), platform });
}

export const run: (
  cwd: string,
  args: string[],
  binDir: string,
) => Promise<BrowserResult> = runOn("linux");

export function runCli(
  cwd: string,
  args: string[],
  binDir: string,
): SpawnSyncReturns<string> {
  return spawnSync(
    bunPath(),
    [path.join(here, "..", "..", "..", "bin", "repo.ts"), "browser", ...args],
    {
      encoding: "utf8",
      cwd,
      timeout: 20_000,
      env: envFor(binDir),
    },
  );
}

// ---- planted sessions: an in-process fake engine plus a live stand-in pid ----

export type Calls = { method: string; params: Record<string, unknown> }[];

export function nth<T>(items: readonly T[], i: number): T {
  const v = items[i];
  if (v === undefined) throw new Error(`no item ${i}`);
  return v;
}

export function portOf(server: net.Server): number {
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("not listening");
  return a.port;
}

export async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  stopFns.push(() => server.close());
  return portOf(server);
}

/** A fake engine in this process; `calls` records every CDP request it gets. */
export async function engine(
  state: Partial<FakeCdpState> = {},
): Promise<{ port: number; calls: Calls; state: FakeCdpState }> {
  const calls: Calls = [];
  const s = await serveCdp({ calls, ...state });
  stopFns.push(() => s.close());
  return { port: s.port, calls, state: s.state };
}

/** A detached process that stays alive until the case ends or something reaps it. */
export function holder(): number {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  const pid = child.pid ?? 0;
  stopFns.push(() => killPid(pid));
  return pid;
}

/** A pid that is certainly gone. */
export function deadPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function expectGone(pid: number): Promise<void> {
  await vi.waitFor(() => expect(alive(pid)).toBe(false), {
    timeout: 3000,
    interval: 30,
  });
}

export function plant(
  cwd: string,
  session: Record<string, unknown> | string,
): void {
  fs.mkdirSync(path.dirname(sessionPath(cwd)), { recursive: true });
  fs.writeFileSync(
    sessionPath(cwd),
    typeof session === "string" ? session : JSON.stringify(session),
  );
}

export const REFS: Record<
  string,
  { role: string; name: string; backendNodeId: number }
> = {
  "1": { role: "link", name: "Home", backendNodeId: 10 },
  "2": { role: "textbox", name: "Search", backendNodeId: 11 },
};
export const NO_SESSION = "no browser session; run nav\n";
export const URL_X = "https://x.test/";
export const NEVER: { lightpanda: string; chromium: string } = {
  lightpanda: "",
  chromium: "/never/spawned",
};
export const HOME_AND_SEARCH = "[1] link Home\n[2] textbox Search\n";

/** A session over a fresh fake engine, the stand-in pid, and the cwd/bin dir to run it in. */
export async function live(
  over: Record<string, unknown> = {},
  state: Partial<FakeCdpState> = {},
): Promise<{
  cwd: string;
  bin: string;
  port: number;
  calls: Calls;
  state: FakeCdpState;
}> {
  const cwd = tmp("browser-live-");
  const bin = path.join(cwd, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const e = await engine(state);
  const base = {
    engine: "lightpanda" satisfies Engine,
    pid: holder(),
    port: e.port,
    lastURL: URL_X,
    lastRefs: REFS,
  };
  plant(cwd, { ...base, escalated: false, swapCount: 0, ...over });
  return { cwd, bin, ...e };
}

/** runBrowser in cwd with an empty PATH, so only planted state and passed bins can launch anything. */
export function exec(
  cwd: string,
  argv: string[],
  extra: RunOpts = {},
): Promise<BrowserResult> {
  // Linux unless a case says otherwise: Windows has no Lightpanda, so a Windows host would pick Chromium for every case.
  return runBrowser(argv, {
    cwd,
    env: childEnv({ PATH: "" }),
    platform: "linux",
    ...extra,
  });
}

export const methods = (calls: Calls): string[] => calls.map((c) => c.method);
export const failure = (stderr: string): BrowserResult => ({
  code: 1,
  stdout: "",
  stderr,
});
export const callParams = (calls: Calls): Record<string, unknown>[] =>
  calls
    .filter((c) => c.method === "Runtime.callFunctionOn")
    .map((c) => c.params);

/** The stdout of a snap over a planted session. */
export async function snapped(
  over: Record<string, unknown>,
  state: Partial<FakeCdpState>,
  bins?: typeof NEVER,
): Promise<string> {
  const t = await live(over, state);
  return (await exec(t.cwd, ["snap"], bins ? { bins } : {})).stdout;
}
