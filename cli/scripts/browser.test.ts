import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectCdp,
  doctorHints,
  installHint,
  isBlockedSnap,
  isPaintHost,
  lookupBins,
  pickEngine,
  runBrowser,
  serveCdp,
  sessionDir,
  whichBin,
  type FakeCdpState,
} from "./browser.ts";
import { bunPath } from "../../dev/test-paths";
import { plantStub } from "../fixtures/stub-bin.ts";
import { childEnv, readEnv } from "../env.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "browser.ts");

const tmpDirs: string[] = [];

function killPid(pid: number) {
  if (!pid) return;
  if (process.platform === "win32") {
    // The tree first: a shell shim's child outlives the shell and holds the dir open.
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", timeout: 1500, windowsHide: true });
    try {
      process.kill(pid);
    } catch {
      // already dead
    }
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // ignore
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // ignore
  }
}

function pause(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function rmRetry(dir: string) {
  let last: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      last = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" && code !== "ENOTEMPTY" && code !== "EPERM") throw err;
      pause(25 * (i + 1));
    }
  }
  throw last;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(d, ".tmp/repo/browser/session.json"), "utf8")) as { pid?: number };
      if (s.pid) killPid(s.pid);
    } catch {
      // ignore
    }
    rmRetry(d);
  }
});

function tmp(prefix: string) {
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

function dirHasBrowser(dir: string) {
  const names = BROWSER_NAMES.flatMap((n) => (process.platform === "win32" ? [n, `${n}.exe`, `${n}.cmd`] : [n]));
  return names.some((n) => {
    try {
      fs.accessSync(path.join(dir, n), fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function mockPath(binDir: string) {
  const rest = (readEnv().PATH || "")
    .split(path.delimiter)
    .filter((dir) => dir && dir !== binDir && !dirHasBrowser(dir));
  return [binDir, ...rest].join(path.delimiter);
}

function writeMjs(file: string, state: Partial<FakeCdpState>) {
  const body = `import { serveCdp } from ${JSON.stringify(pathToFileURL(script).href)};
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
function writeLauncher(dest: string, mjs: string) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (process.platform === "win32") {
    fs.writeFileSync(dest, `@echo off\r\n${JSON.stringify(bunPath())} ${JSON.stringify(mjs)} %*\r\n`);
  } else {
    fs.writeFileSync(dest, `#!/bin/sh\nexec ${JSON.stringify(bunPath())} ${JSON.stringify(mjs)} "$@"\n`, {
      mode: 0o755,
    });
  }
  return dest;
}

function writeFake(
  binDir: string,
  name: string,
  opts: { failProbe?: boolean; thinSnap?: boolean; state?: Partial<FakeCdpState> } = {},
) {
  const mjs = writeMjs(path.join(binDir, `${name}.mjs`), {
    failProbe: opts.failProbe ?? false,
    thinSnap: opts.thinSnap ?? false,
    ...opts.state,
  });
  return writeLauncher(path.join(binDir, process.platform === "win32" ? `${name}.cmd` : name), mjs);
}

function sessionPath(cwd: string) {
  return path.join(cwd, ".tmp/repo/browser/session.json");
}

interface StoredSession {
  engine: string;
  pid: number;
  port: number;
  lastURL: string;
  lastRefs: Record<string, { role: string; name: string; backendNodeId: number }>;
  escalated: boolean;
  swapCount: number;
}

function readSession(cwd: string) {
  return JSON.parse(fs.readFileSync(sessionPath(cwd), "utf8")) as StoredSession;
}

function envFor(binDir: string) {
  const env: NodeJS.ProcessEnv = childEnv({ PATH: mockPath(binDir) });
  delete env.REPO_BROWSER;
  delete env.REPO_BROWSER_ENGINE;
  delete env.LIGHTPANDA_CDP_URL;
  return env;
}

async function run(cwd: string, args: string[], binDir: string, extra: { platform?: NodeJS.Platform } = {}) {
  return runBrowser(args, {
    cwd,
    env: envFor(binDir),
    platform: extra.platform ?? "linux",
  });
}

function runCli(cwd: string, args: string[], binDir: string) {
  return spawnSync(bunPath(), [path.join(here, "..", "..", "bin", "repo.ts"), "browser", ...args], {
    encoding: "utf8",
    cwd,
    timeout: 20_000,
    env: envFor(binDir),
  });
}

describe("pickEngine / paint hosts", () => {
  it("paint-host URLs", () => {
    expect(isPaintHost("https://www.figma.com/file/x")).toBe(true);
    expect(isPaintHost("https://docs.google.com/document/d/1")).toBe(true);
    expect(isPaintHost("https://docs.google.com/spreadsheets/d/1")).toBe(true);
    expect(isPaintHost("https://docs.google.com/presentation/d/1")).toBe(true);
    expect(isPaintHost("https://mail.google.com/mail/u/0/")).toBe(true);
    expect(isPaintHost("https://earth.google.com/web/")).toBe(true);
    expect(isPaintHost("https://www.amazon.com/dp/B0")).toBe(true);
    expect(isPaintHost("https://amazon.co.uk/")).toBe(true);
    expect(isPaintHost("https://example.com/")).toBe(false);
  });

  it("blocked/empty snaps", () => {
    expect(isBlockedSnap("# https://x/\n", [])).toBe(true);
    expect(isBlockedSnap("# https://x/\n\nhello", ["[1] link Home"])).toBe(false);
    expect(isBlockedSnap("Enable JavaScript to continue", ["[1] button ok"])).toBe(true);
    expect(isBlockedSnap("Sorry, we just need to make sure you're not a robot", [])).toBe(true);
  });

  it("win32 → chromium even if lightpanda present", () => {
    const r = pickEngine({
      platform: "win32",
      verb: "nav",
      url: "https://example.com/",
      bins: { lightpanda: "/x/lightpanda", chromium: "/x/chromium" },
    });
    expect(r.engine).toBe("chromium");
  });

  it("shot/pdf/trace → chromium", () => {
    const bins = { lightpanda: "/x/lightpanda", chromium: "/x/chromium" };
    expect(pickEngine({ platform: "linux", verb: "shot", bins }).engine).toBe("chromium");
    expect(pickEngine({ platform: "linux", verb: "pdf", bins }).engine).toBe("chromium");
    expect(pickEngine({ platform: "linux", verb: "trace", bins }).engine).toBe("chromium");
  });

  it("defaults to the host's platform and to a nav of no url with no engines", () => {
    const bins = { lightpanda: "/x/lightpanda", chromium: "/x/chromium" };
    expect(pickEngine({ bins })).toStrictEqual(pickEngine({ platform: process.platform, bins }));
    expect(pickEngine()).toStrictEqual(pickEngine({ platform: process.platform, verb: "nav", url: "", bins: {} }));
  });
});

describe("nav / snap / stop", () => {
  it("lightpanda on PATH → nav uses Lightpanda; session under .tmp/repo/browser/; no env", async () => {
    const cwd = tmp("browser-lp-");
    const bin = path.join(cwd, "bin");
    writeFake(bin, "lightpanda");
    writeFake(bin, "chromium");
    const r = await run(cwd, ["nav", "https://example.com/"], bin);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toMatch(/engine: lightpanda/);
    const s = readSession(cwd);
    expect(s.engine).toBe("lightpanda");
    expect(s.lastURL).toMatch(/example\.com/);
    expect(s.pid).toBeGreaterThan(0);
    expect(path.normalize(sessionPath(cwd))).toContain(path.join(".tmp", "repo", "browser"));
    expect(readEnv().REPO_BROWSER).toBeUndefined();
  });

  it("no lightpanda; Playwright Chromium present → nav uses Chromium", async () => {
    const cwd = tmp("browser-cr-");
    const bin = path.join(cwd, "bin");
    writeFake(bin, "chromium");
    writeFake(bin, "playwright");
    const r = await run(cwd, ["nav", "https://example.com/"], bin);
    expect(r.code).toBe(0);
    expect(readSession(cwd).engine).toBe("chromium");
    expect(r.stdout).toMatch(/engine: chromium/);
  });

  it("neither binary → non-zero + install hint; no stack dump", async () => {
    const cwd = tmp("browser-none-");
    const bin = path.join(cwd, "bin");
    fs.mkdirSync(bin, { recursive: true });
    const r = await run(cwd, ["nav", "https://example.com/"], bin);
    expect(r.code).not.toBe(0);
    const err = r.stderr + r.stdout;
    expect(err).toMatch(/lightpanda|chromium|install/i);
    expect(err).not.toMatch(/at runBrowser/);
    expect(err).not.toMatch(/Error: /);
    expect(fs.existsSync(sessionPath(cwd))).toBe(false);
  });

  it("process.platform=win32 → Chromium even if Lightpanda mock exists", async () => {
    const cwd = tmp("browser-win-");
    const bin = path.join(cwd, "bin");
    writeFake(bin, "lightpanda");
    writeFake(bin, "chromium");
    const r = await run(cwd, ["nav", "https://example.com/"], bin, { platform: "win32" });
    expect(r.code).toBe(0);
    expect(readSession(cwd).engine).toBe("chromium");
  });

  it("paint-host URL on nav → Chromium immediately", async () => {
    const cwd = tmp("browser-paint-");
    const bin = path.join(cwd, "bin");
    writeFake(bin, "lightpanda");
    writeFake(bin, "chromium");
    const r = await run(cwd, ["nav", "https://www.figma.com/file/abc"], bin);
    expect(r.code).toBe(0);
    expect(readSession(cwd).engine).toBe("chromium");
    const amazon = await run(cwd, ["nav", "https://www.amazon.com/dp/B0"], bin);
    expect(amazon.code).toBe(0);
    expect(readSession(cwd).engine).toBe("chromium");
  });

  it("Lightpanda probe fail → one Chromium replay; no loop", async () => {
    const cwd = tmp("browser-probe-");
    const bin = path.join(cwd, "bin");
    writeFake(bin, "lightpanda", { failProbe: true });
    writeFake(bin, "chromium");
    const r = await run(cwd, ["nav", "https://example.com/page"], bin);
    expect(r.code).toBe(0);
    const s = readSession(cwd);
    expect(s.engine).toBe("chromium");
    expect(s.lastURL).toMatch(/example\.com\/page/);
    expect(s.escalated).toBe(true);
    expect(s.swapCount).toBe(1);
  });

  it("thin Lightpanda snap → one Chromium replay then snap", async () => {
    const cwd = tmp("browser-thin-");
    const bin = path.join(cwd, "bin");
    writeFake(bin, "lightpanda", { thinSnap: true });
    writeFake(bin, "chromium");
    expect((await run(cwd, ["nav", "https://example.com/spa"], bin)).code).toBe(0);
    expect(readSession(cwd).engine).toBe("lightpanda");
    const snap = await run(cwd, ["snap"], bin);
    expect(snap.code).toBe(0);
    expect(snap.stdout).toMatch(/engine: chromium/);
    const s = readSession(cwd);
    expect(s.engine).toBe("chromium");
    expect(s.escalated).toBe(true);
    expect(s.swapCount).toBe(1);
    const snap2 = await run(cwd, ["snap"], bin);
    expect(snap2.code).toBe(0);
    expect(readSession(cwd).swapCount).toBe(1);
  });

  it("nav then snap → markdown + numbered refs; session keeps lastURL/lastRefs/engine/pid", async () => {
    const cwd = tmp("browser-snap-");
    const bin = path.join(cwd, "bin");
    writeFake(bin, "lightpanda");
    const nav = await run(cwd, ["nav", "https://example.com/"], bin);
    expect(nav.code).toBe(0);
    const snap = await run(cwd, ["snap"], bin);
    expect(snap.code).toBe(0);
    expect(snap.stdout).toMatch(/\[1\]/);
    expect(snap.stdout).toMatch(/link|textbox|button/i);
    const s = readSession(cwd);
    expect(s.lastURL).toMatch(/example\.com/);
    expect(s.lastRefs["1"]).toBeTruthy();
    expect(s.engine).toBe("lightpanda");
    expect(s.pid).toBeGreaterThan(0);
  });

  it("stop kills pid; session cleared; second stop ok", async () => {
    const cwd = tmp("browser-stop-");
    const bin = path.join(cwd, "bin");
    writeFake(bin, "lightpanda");
    const nav = await run(cwd, ["nav", "https://example.com/"], bin);
    expect(nav.code).toBe(0);
    const pid = readSession(cwd).pid;
    expect(() => process.kill(pid, 0)).not.toThrow();
    const stop = await run(cwd, ["stop"], bin);
    expect(stop.code).toBe(0);
    expect(fs.existsSync(sessionPath(cwd))).toBe(false);
    const t0 = Date.now();
    while (Date.now() - t0 < 2000) {
      try {
        process.kill(pid, 0);
        await new Promise((r) => setTimeout(r, 40));
      } catch {
        break;
      }
    }
    expect(() => process.kill(pid, 0)).toThrow();
    const stop2 = await run(cwd, ["stop"], bin);
    expect(stop2.code).toBe(0);
  });

  it.skipIf(process.platform === "win32")("CLI spawn: lightpanda on PATH, no env knobs", () => {
    const cwd = tmp("browser-cli-");
    const bin = path.join(cwd, "bin");
    writeFake(bin, "lightpanda");
    const r = runCli(cwd, ["nav", "https://example.com/"], bin);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/engine: lightpanda/);
    expect(readSession(cwd).engine).toBe("lightpanda");
  });

  it.skipIf(process.platform !== "win32")("CLI spawn: chromium on PATH, no env knobs", () => {
    const cwd = tmp("browser-cli-win-");
    const bin = path.join(cwd, "bin");
    writeFake(bin, "lightpanda");
    writeFake(bin, "chromium");
    const r = runCli(cwd, ["nav", "https://example.com/"], bin);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/engine: chromium/);
    expect(readSession(cwd).engine).toBe("chromium");
  });
});

describe("click / fill", () => {
  it("click <ref> / fill <ref> <text> against last snap refs", async () => {
    const cwd = tmp("browser-click-");
    const bin = path.join(cwd, "bin");
    writeFake(bin, "lightpanda");
    expect((await run(cwd, ["nav", "https://example.com/"], bin)).code).toBe(0);
    expect((await run(cwd, ["snap"], bin)).code).toBe(0);
    const click = await run(cwd, ["click", "1"], bin);
    expect(click.code).toBe(0);
    const fill = await run(cwd, ["fill", "2", "hello"], bin);
    expect(fill.code).toBe(0);
    const hover = await run(cwd, ["hover", "1"], bin);
    expect(hover.code).toBe(0);
    expect(hover.stdout).toMatch(/hover: 1/);
    const sel = await run(cwd, ["select", "2", "opt"], bin);
    expect(sel.code).toBe(0);
    const scrolled = await run(cwd, ["scroll", "down"], bin);
    expect(scrolled.code).toBe(0);
    const waited = await run(cwd, ["wait", "0"], bin);
    expect(waited.code).toBe(0);
    expect(waited.stdout).toMatch(/wait: 0/);
  });

  it("missing/stale ref fails clearly", async () => {
    const cwd = tmp("browser-stale-");
    const bin = path.join(cwd, "bin");
    writeFake(bin, "lightpanda");
    expect((await run(cwd, ["nav", "https://example.com/"], bin)).code).toBe(0);
    expect((await run(cwd, ["snap"], bin)).code).toBe(0);
    const missing = await run(cwd, ["click", "99"], bin);
    expect(missing.code).not.toBe(0);
    expect(missing.stderr).toMatch(/ref|stale|missing/i);
    const s = readSession(cwd);
    s.lastRefs["1"]!.backendNodeId = 99999;
    fs.writeFileSync(sessionPath(cwd), JSON.stringify(s));
    const stale = await run(cwd, ["click", "1"], bin);
    expect(stale.code).not.toBe(0);
    expect(stale.stderr).toMatch(/stale|missing/i);
  });

  it("click/fill with no session / no prior snap fails; no implicit Chromium", async () => {
    const cwd = tmp("browser-nosess-");
    const bin = path.join(cwd, "bin");
    writeFake(bin, "chromium");
    const click = await run(cwd, ["click", "1"], bin);
    expect(click.code).not.toBe(0);
    expect(click.stderr).toMatch(/session|snap|nav/i);
    expect(fs.existsSync(sessionPath(cwd))).toBe(false);
    writeFake(bin, "lightpanda");
    expect((await run(cwd, ["nav", "https://example.com/"], bin)).code).toBe(0);
    const fill = await run(cwd, ["fill", "1", "x"], bin);
    expect(fill.code).not.toBe(0);
    expect(fill.stderr).toMatch(/snap|ref/i);
    expect(readSession(cwd).engine).toBe("lightpanda");
  });
});

describe("shot / pdf", () => {
  it("shot with Lightpanda session → swap to Chromium replay; one swap cap", async () => {
    const cwd = tmp("browser-shot-");
    const bin = path.join(cwd, "bin");
    writeFake(bin, "lightpanda");
    writeFake(bin, "chromium");
    expect((await run(cwd, ["nav", "https://example.com/"], bin)).code).toBe(0);
    expect(readSession(cwd).engine).toBe("lightpanda");
    const shot = await run(cwd, ["shot"], bin);
    expect(shot.code).toBe(0);
    const s = readSession(cwd);
    expect(s.engine).toBe("chromium");
    expect(s.swapCount).toBe(1);
    expect(s.lastURL).toMatch(/example\.com/);
    const art = path.join(cwd, ".tmp/repo/browser/shot.png");
    expect(fs.existsSync(art)).toBe(true);
    const shot2 = await run(cwd, ["shot"], bin);
    expect(shot2.code).toBe(0);
    expect(readSession(cwd).swapCount).toBe(1);
  });
});

describe("doctor / ensure", () => {
  it("missing engines linux/darwin/win32 → unified doctor exit 1 OS install strings; no playwright install; lightpanda-io/browser", async () => {
    const cwd = tmp("browser-doc-");
    const bin = path.join(cwd, "bin");
    fs.mkdirSync(bin, { recursive: true });
    const linux = await run(cwd, ["doctor"], bin, { platform: "linux" });
    const darwin = await run(cwd, ["doctor"], bin, { platform: "darwin" });
    const win = await run(cwd, ["doctor"], bin, { platform: "win32" });
    const ensure = await run(cwd, ["ensure"], bin, { platform: "linux" });
    for (const r of [linux, darwin, win, ensure]) {
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(/lightpanda-io\/browser/);
      expect(`${r.stdout}${r.stderr}`).not.toMatch(/playwright install/);
    }
    expect(linux.stdout).toMatch(/curl -fsSL https:\/\/pkg\.lightpanda\.io\/install\.sh \| bash/);
    expect(darwin.stdout).toMatch(/brew tap lightpanda-io\/browser|brew install lightpanda-io\/browser\/lightpanda/);
    expect(win.stdout).toMatch(/winget/);
    expect(win.stdout).toMatch(/WSL2/i);
    expect(ensure.stdout).toBe(linux.stdout);
    const help = await run(cwd, ["help"], bin);
    expect(help.stdout).toMatch(/doctor/);
    expect(help.stdout).toMatch(/ensure/);
  });

  it("win32: Chromium/winget/WSL2 notes; not native Lightpanda required", async () => {
    const cwd = tmp("browser-doc-win-");
    const bin = path.join(cwd, "bin");
    fs.mkdirSync(bin, { recursive: true });
    const r = await run(cwd, ["doctor"], bin, { platform: "win32" });
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/winget install Google\.Chrome|winget install Microsoft\.Edge/);
    expect(r.stdout).toMatch(/PATH|shim/i);
    expect(r.stdout).toMatch(/WSL2/i);
    expect(r.stdout).toMatch(/not required|no native/i);
  });

  it("bins present → reports paths via unified doctor", async () => {
    const cwd = tmp("browser-doc-ok-");
    const bin = path.join(cwd, "bin");
    const lp = writeFake(bin, "lightpanda");
    const cr = writeFake(bin, "chromium");
    const r = await run(cwd, ["doctor"], bin, { platform: "linux" });
    expect(r.stdout).toContain(lp);
    expect(r.stdout).toContain(cr);
  });

  it("win32 whichBin finds chrome.exe in mock PATH dir", () => {
    const dir = tmp("which-win-");
    const exe = path.join(dir, "chrome.exe");
    fs.writeFileSync(exe, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    expect(whichBin("chrome", dir, "win32")?.toLowerCase()).toBe(exe.toLowerCase());
  });

  it("playwright-only PATH is NOT treated as Chromium engine", async () => {
    const cwd = tmp("browser-pwonly-");
    const bin = path.join(cwd, "bin");
    writeFake(bin, "playwright");
    const looked = lookupBins(envFor(bin).PATH, "linux");
    expect(looked.chromium).toBeFalsy();
    expect(looked).not.toHaveProperty("playwright");
    const picked = pickEngine({
      platform: "linux",
      verb: "nav",
      url: "https://example.com/",
      bins: { playwright: path.join(bin, "playwright") },
    });
    expect(picked.engine).toBeNull();
    const r = await run(cwd, ["nav", "https://example.com/"], bin);
    expect(r.code).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/playwright install/);
  });
});

describe("shot / pdf continued", () => {
  it("pdf → Chromium path; never Lightpanda paint", async () => {
    const cwd = tmp("browser-pdf-");
    const bin = path.join(cwd, "bin");
    writeFake(bin, "lightpanda");
    writeFake(bin, "chromium");
    expect((await run(cwd, ["nav", "https://example.com/"], bin)).code).toBe(0);
    const pdf = await run(cwd, ["pdf"], bin);
    expect(pdf.code).toBe(0);
    expect(readSession(cwd).engine).toBe("chromium");
    expect(fs.existsSync(path.join(cwd, ".tmp/repo/browser/page.pdf"))).toBe(true);
  });

  it("shot/pdf with no session fails clearly", async () => {
    const cwd = tmp("browser-shot-none-");
    const bin = path.join(cwd, "bin");
    writeFake(bin, "chromium");
    const shot = await run(cwd, ["shot"], bin);
    expect(shot.code).not.toBe(0);
    expect(shot.stderr).toMatch(/session|nav/i);
    const pdf = await run(cwd, ["pdf"], bin);
    expect(pdf.code).not.toBe(0);
    expect(pdf.stderr).toMatch(/session|nav/i);
  });
});

describe("browser scratch dir", () => {
  it("keeps the session at the repo root's .tmp/repo/browser from packages/a", () => {
    const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "browser-sub-")));
    tmpDirs.push(r);
    spawnSync("git", ["init", "-q"], { cwd: r });
    const a = path.join(r, "packages", "a");
    fs.mkdirSync(a, { recursive: true });
    expect(sessionDir(a)).toBe(path.join(r, ".tmp/repo/browser"));
  });
});

// ---- planted sessions: an in-process fake engine plus a live stand-in pid -------------------------------------

const stopFns: (() => void)[] = [];

afterEach(() => {
  for (const f of stopFns.splice(0)) f();
});

type Calls = { method: string; params: Record<string, unknown> }[];

function nth<T>(items: readonly T[], i: number): T {
  const v = items[i];
  if (v === undefined) throw new Error(`no item ${i}`);
  return v;
}

function portOf(server: net.Server): number {
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("not listening");
  return a.port;
}

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  stopFns.push(() => server.close());
  return portOf(server);
}

/** A fake engine in this process; `calls` records every CDP request it gets. */
async function engine(state: Partial<FakeCdpState> = {}) {
  const calls: Calls = [];
  const s = await serveCdp({ calls, ...state });
  stopFns.push(() => s.close());
  return { port: s.port, calls, state: s.state };
}

/** A detached process that stays alive until the case ends or something reaps it. */
function holder(): number {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { detached: true, stdio: "ignore" });
  child.unref();
  const pid = child.pid ?? 0;
  stopFns.push(() => killPid(pid));
  return pid;
}

/** A pid that is certainly gone. */
function deadPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function expectGone(pid: number) {
  await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 3000, interval: 30 });
}

function plant(cwd: string, session: Record<string, unknown> | string) {
  fs.mkdirSync(path.dirname(sessionPath(cwd)), { recursive: true });
  fs.writeFileSync(sessionPath(cwd), typeof session === "string" ? session : JSON.stringify(session));
}

const REFS = {
  "1": { role: "link", name: "Home", backendNodeId: 10 },
  "2": { role: "textbox", name: "Search", backendNodeId: 11 },
};
const NO_SESSION = "no browser session; run nav\n";
const URL_X = "https://x.test/";

/** A session over a fresh fake engine, the stand-in pid, and the cwd/bin dir to run it in. */
async function live(over: Record<string, unknown> = {}, state: Partial<FakeCdpState> = {}) {
  const cwd = tmp("browser-live-");
  const bin = path.join(cwd, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const e = await engine(state);
  const base = { engine: "lightpanda", pid: holder(), port: e.port, lastURL: URL_X, lastRefs: REFS };
  plant(cwd, { ...base, escalated: false, swapCount: 0, ...over });
  return { cwd, bin, ...e };
}

const offline = () => childEnv({ PATH: "" });
const NEVER = { lightpanda: "", chromium: "/never/spawned" };

/** runBrowser in cwd with an empty PATH, so only planted state and passed bins can launch anything. */
function exec(cwd: string, argv: string[], extra: Parameters<typeof runBrowser>[1] = {}) {
  // Linux unless a case says otherwise: Windows has no Lightpanda, so a Windows host would pick Chromium for every case.
  return runBrowser(argv, { cwd, env: offline(), platform: "linux", ...extra });
}

const methods = (calls: Calls) => calls.map((c) => c.method);
const failure = (stderr: string) => ({ code: 1, stdout: "", stderr });

it("knows the paint hosts, their subdomains, and the google earth path", () => {
  const hosts = ["figma", "docs.google", "sheets.google", "slides.google", "mail.google", "earth.google"];
  const urls = hosts.flatMap((h) => [`https://${h}.com/`, `https://a.${h}.com/`]);
  urls.push(
    "https://google.com/earth/",
    "https://www.google.com/earth/web",
    "https://AMAZON.com/",
    "https://www.amazon.de/",
  );
  expect(urls.filter((u) => !isPaintHost(u))).toStrictEqual([]);
  const other = [
    "https://google.com/maps",
    "https://www.google.com/",
    "https://notfigma.com/",
    "https://x.test/amazon",
  ];
  expect([...other, "", "not a url", undefined, null].filter((u) => isPaintHost(u))).toStrictEqual([]);
});

it("calls a page blocked when it asks for javascript, or is empty with no refs", () => {
  expect(isBlockedSnap(null, null)).toBe(true);
  expect(isBlockedSnap(undefined, "not a list")).toBe(true);
  expect(isBlockedSnap("x".repeat(100), [])).toBe(false);
  expect(isBlockedSnap("# https://x/\n\nshort", ["[1] link a"])).toBe(false);
  expect(isBlockedSnap("Just a moment...", ["[1] link a"])).toBe(true);
});

it("looks up lightpanda and the first chromium name on the given PATH", () => {
  const dir = tmp("bins-");
  const put = (name: string) => {
    fs.writeFileSync(path.join(dir, name), "#!/bin/sh\n", { mode: 0o755 });
    return path.join(dir, name);
  };
  expect(lookupBins(dir, "linux")).toStrictEqual({ lightpanda: "", chromium: "" });
  const second = put("chromium-browser");
  expect(lookupBins(dir, "linux").chromium).toBe(second);
  const [first, lp] = [put("chromium"), put("lightpanda")];
  expect(lookupBins(dir, "linux")).toStrictEqual({ lightpanda: lp, chromium: first });
  expect(lookupBins(undefined, "linux")).toStrictEqual(lookupBins(readEnv().PATH));
});

it("hints per platform, defaulting to this one", () => {
  expect(doctorHints("win32").join("\n")).toMatch(/winget/);
  expect(doctorHints("darwin").join("\n")).toMatch(/brew/);
  expect(doctorHints()).toStrictEqual(doctorHints(process.platform));
  expect(installHint("linux")).toMatch(
    /^no browser engine; install lightpanda \(https:\/\/github\.com\/lightpanda-io\/browser\) or Chromium\n/,
  );
  expect(installHint()).toBe(installHint(process.platform));
});

it("picks lightpanda, then chromium, and names the missing engine", () => {
  const both = { lightpanda: "/x/lp", chromium: "/x/cr" };
  const pick = (o: Parameters<typeof pickEngine>[0] = {}) => pickEngine({ platform: "linux", ...o });
  expect(pick({ bins: both })).toStrictEqual({ engine: "lightpanda" });
  expect(pick({ bins: { lightpanda: "/x/lp" } })).toStrictEqual({ engine: "lightpanda" });
  expect(pick({ bins: { chromium: "/x/cr" } })).toStrictEqual({ engine: "chromium" });
  expect(pick({ bins: both, forceChromium: true })).toStrictEqual({ engine: "chromium" });
  expect(pick({ bins: both, url: "https://figma.com/x" })).toStrictEqual({ engine: "chromium" });
  expect(pick().engine).toBeNull();
  expect(pick().error).toMatch(/no browser engine/);
  expect(pick({ bins: { lightpanda: "/x/lp" }, verb: "shot" }).engine).toBeNull();
  expect(pick({ bins: { lightpanda: "/x/lp" }, platform: "win32" }).error).toMatch(/winget/);
});

it("lists the verbs for no verb, help, -h and --help, in any case", async () => {
  const help = {
    code: 0,
    stdout: "nav|snap|click|fill|scroll|wait|hover|select|shot|pdf|stop|doctor|ensure\n",
    stderr: "",
  };
  const argvs = [[], [""], ["help"], ["HELP"], ["-h"], ["--help"]];
  expect(await Promise.all(argvs.map((a) => runBrowser(a)))).toStrictEqual(argvs.map(() => help));
});

it("fails an unknown verb", async () => {
  expect(await exec(tmp("browser-unk-"), ["frobnicate"])).toStrictEqual(failure("unknown verb\n"));
});

it("keeps the session under the cwd's root, or the process cwd's when none is given", () => {
  const cwd = tmp("browser-dir-");
  expect(sessionDir(cwd)).toBe(path.join(fs.realpathSync(cwd), ".tmp/repo/browser"));
  expect(sessionDir()).toBe(sessionDir(process.cwd()));
});

it("reports an engine that answers without a websocket as a failure, not a stack", async () => {
  const cwd = tmp("browser-nows-");
  const port = await listen(http.createServer((_req, res) => res.end("{}")));
  plant(cwd, { engine: "lightpanda", pid: holder(), port, lastRefs: REFS });
  expect(await exec(cwd, ["snap"])).toStrictEqual(failure("engine not ready\n"));
});

it("treats a missing, unreadable or malformed session as no session", async () => {
  const pid = holder();
  const bad = [
    "{",
    "[]",
    "null",
    '"text"',
    JSON.stringify({ engine: "firefox", port: 1, pid }),
    JSON.stringify({ engine: "lightpanda", port: "abc", pid }),
    JSON.stringify({ engine: "lightpanda", port: 1, pid: String(pid) }),
    JSON.stringify({ engine: "lightpanda", port: 1 }),
  ];
  const stderrs = await Promise.all(
    bad.map((raw) => {
      const cwd = tmp("browser-bad-");
      plant(cwd, raw);
      return exec(cwd, ["snap"]).then((r) => r.stderr);
    }),
  );
  expect(stderrs).toStrictEqual(bad.map(() => NO_SESSION));
  expect((await exec(tmp("browser-bad-none-"), ["snap"])).stderr).toBe(NO_SESSION);
});

it("fills in defaults for missing fields and drops junk refs when it rewrites the session", async () => {
  const t = await live();
  const lastRefs = { "1": { backendNodeId: 10 }, "2": "junk", "3": null, "4": [1] };
  plant(t.cwd, { engine: "chromium", pid: holder(), port: t.port, lastRefs });
  expect((await exec(t.cwd, ["hover", "1"])).stdout).toBe("hover: 1\n");
  const s = readSession(t.cwd);
  expect(s).toMatchObject({ engine: "chromium", lastURL: "", escalated: false, swapCount: 0 });
  expect(s.lastRefs).toStrictEqual({ "1": { role: "", name: "", backendNodeId: 10 } });
});

it("keeps escalated and a numeric swapCount, and reads a numeric string as a number", async () => {
  const t = await live({ escalated: true, swapCount: "2", engine: "chromium" });
  await exec(t.cwd, ["hover", "1"]);
  expect(readSession(t.cwd)).toMatchObject({ escalated: true, swapCount: 2 });
  plant(t.cwd, {
    engine: "chromium",
    pid: holder(),
    port: t.port,
    lastRefs: REFS,
    escalated: "yes",
    swapCount: "many",
  });
  await exec(t.cwd, ["hover", "1"]);
  expect(readSession(t.cwd)).toMatchObject({ escalated: false, swapCount: 0 });
});

const HOME_AND_SEARCH = "[1] link Home\n[2] textbox Search\n";

it("snap fails without a session or with a dead pid", async () => {
  expect((await exec(tmp("browser-snap-none-"), ["snap"])).stderr).toBe(NO_SESSION);
  const t = await live({ pid: deadPid() });
  expect((await exec(t.cwd, ["snap"])).stderr).toBe(NO_SESSION);
});

it("snap numbers the ref-bearing nodes in either ax shape and remembers them", async () => {
  const axNodes = [
    { role: "button", name: "Go", backendNodeId: 5, nodeId: "a" },
    { role: { value: "LINK" }, name: { value: "" }, backendDOMNodeId: 6 },
    { role: { value: "heading" }, name: { value: "H" } },
    {},
    { role: "textbox" },
    { role: "link", name: {} },
    { role: {} },
  ];
  const t = await live({ lastRefs: {} }, { markdown: "# T\n\nsome page body text", axNodes });
  const r = await exec(t.cwd, ["snap"]);
  const lines = "[1] button Go\n[2] link\n[3] textbox\n[4] link\n";
  expect(r.stdout).toBe(`engine: lightpanda\nurl: ${URL_X}\n\n# T\n\nsome page body text\n\n${lines}`);
  expect(readSession(t.cwd).lastRefs).toStrictEqual({
    "1": { role: "button", name: "Go", backendNodeId: 5, nodeId: "a" },
    "2": { role: "link", name: "", backendNodeId: 6 },
    "3": { role: "textbox", name: "" },
    "4": { role: "link", name: "" },
  });
});

it("snap ends a ref-less page without doubling the newline", async () => {
  const body = "word ".repeat(30);
  const t = await live({}, { markdown: `# ${URL_X}\n\n${body}`, axNodes: [] });
  const r = await exec(t.cwd, ["snap"]);
  expect(r.stdout).toBe(`engine: lightpanda\nurl: ${URL_X}\n\n# ${URL_X}\n\n${body.trim()}\n`);
});

it("snap falls back to a bare url heading when the markdown call fails or answers oddly", async () => {
  const replies = ["boom", {}, { markdown: 5 }, { markdown: "" }];
  const outs = await Promise.all(
    replies.map(async (reply) => {
      const t = await live({}, { replies: { "LP.getMarkdown": reply } });
      return (await exec(t.cwd, ["snap"])).stdout;
    }),
  );
  expect(outs).toStrictEqual(
    replies.map(() => `engine: lightpanda\nurl: ${URL_X}\n\n# ${URL_X}\n\n${HOME_AND_SEARCH}`),
  );
  const bare = await live({ lastURL: undefined }, { replies: { "LP.getMarkdown": "boom" } });
  expect((await exec(bare.cwd, ["snap"])).stdout).toBe(`engine: lightpanda\nurl: \n\n#\n\n${HOME_AND_SEARCH}`);
});

it("snap takes the markdown from a result field when that is all the engine sends", async () => {
  const t = await live({}, { replies: { "LP.getMarkdown": { result: "# via result\n\ntext" } } });
  expect((await exec(t.cwd, ["snap"])).stdout).toContain("# via result");
});

it("snap asks chromium for no markdown", async () => {
  const t = await live({ engine: "chromium" });
  const r = await exec(t.cwd, ["snap"]);
  expect(r.stdout).toBe(`engine: chromium\nurl: ${URL_X}\n\n# ${URL_X}\n\n${HOME_AND_SEARCH}`);
  expect(methods(t.calls)).not.toContain("LP.getMarkdown");
});

it("snap goes on when accessibility cannot be enabled, and reads no refs from a non-list", async () => {
  const replies = { "Accessibility.enable": "nope", "Accessibility.getFullAXTree": { nodes: "x" } };
  const t = await live({}, { replies, markdown: `# T\n\n${"w ".repeat(60)}` });
  expect((await exec(t.cwd, ["snap"])).code).toBe(0);
  expect(readSession(t.cwd).lastRefs).toStrictEqual({});
});

it("snap stashes a long ref list and shows the headings and the first refs", async () => {
  const axNodes = Array.from({ length: 30 }, (_, i) => ({ role: "button", name: `B${i + 1}`, backendNodeId: i }));
  const t = await live({}, { markdown: "# One\n\nbody\n\n## Two\n", axNodes });
  const lines = (await exec(t.cwd, ["snap"])).stdout.split("\n");
  expect(lines[0]).toBe("engine: lightpanda");
  expect(lines[2]).toMatch(/^26 shown\. stash=/);
  expect(lines.slice(3, 5)).toStrictEqual(["# One", "## Two"]);
  expect(lines).toContain("[24] button B24");
  expect(lines).not.toContain("[25] button B25");
  const dir = path.join(t.cwd, ".tmp/repo/stash");
  const file = nth(fs.readdirSync(dir), 0);
  expect(fs.readFileSync(path.join(dir, file), "utf8")).toContain("[30] button B30");
  expect(nth(lines, 2)).toContain(file);
});

it("snap stashes a page over 32 KiB even with few refs", async () => {
  const t = await live({}, { markdown: `# Big\n\n${"x".repeat(40_000)}` });
  const r = await exec(t.cwd, ["snap"]);
  expect(r.stdout).toMatch(/^engine: lightpanda\nurl: https:\/\/x\.test\/\n3 shown\. stash=/);
  expect(r.stdout.length).toBeLessThan(2000);
});

async function snapped(over: Record<string, unknown>, state: Partial<FakeCdpState>, bins?: typeof NEVER) {
  const t = await live(over, state);
  return (await exec(t.cwd, ["snap"], bins ? { bins } : {})).stdout;
}

const BLOCKED = { markdown: "Enable JavaScript to continue", axNodes: [] };

it("snap keeps a blocked page on lightpanda when there is no chromium, or a swap was spent, or it is chromium", async () => {
  const none = await snapped({}, BLOCKED);
  expect(none).toContain("engine: lightpanda");
  expect(none).toContain("Enable JavaScript");
  expect(await snapped({ swapCount: 1 }, BLOCKED, NEVER)).toContain("engine: lightpanda");
  expect(await snapped({ engine: "chromium" }, BLOCKED, NEVER)).toContain("engine: chromium");
});

it("snap keeps a fine page on lightpanda even when chromium exists", async () => {
  expect(await snapped({}, { markdown: `# ok\n\n${"fine ".repeat(30)}` }, NEVER)).toContain("engine: lightpanda");
});

it("snap swaps a blocked page to chromium without navigating when there is no url to replay", async () => {
  const t = await live({ lastURL: "" }, BLOCKED);
  const chromium = writeFake(t.bin, "chromium");
  const r = await exec(t.cwd, ["snap"], { bins: { lightpanda: "", chromium } });
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/^engine: chromium\nurl: \n/);
  expect(readSession(t.cwd)).toMatchObject({ engine: "chromium", escalated: true, swapCount: 1, lastURL: "" });
});

it("wait needs a session", async () => {
  expect((await exec(tmp("browser-wait-none-"), ["wait", "0"])).stderr).toBe(NO_SESSION);
});

it("wait sleeps the given ms, reads junk and negatives as 0, and defaults to 1000", async () => {
  const t = await live();
  expect((await exec(t.cwd, ["wait", "15"])).stdout).toBe("wait: 15\n");
  expect((await exec(t.cwd, ["wait", "abc"])).stdout).toBe("wait: 0\n");
  expect((await exec(t.cwd, ["wait", "-5"])).stdout).toBe("wait: 0\n");
  const t0 = Date.now();
  expect((await exec(t.cwd, ["wait"])).stdout).toBe("wait: 1000\n");
  expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
});

const scrolls = (calls: Calls) => calls.filter((c) => c.method === "Runtime.evaluate").map((c) => c.params.expression);

it("scroll needs a session", async () => {
  expect((await exec(tmp("browser-scroll-none-"), ["scroll"])).stderr).toBe(NO_SESSION);
});

it("scroll goes 600 down, -600 up, a number of pixels, and 600 for anything else", async () => {
  const args: (string | undefined)[] = [undefined, "down", "up", "250", "-40", "sideways"];
  const done = await Promise.all(
    args.map(async (arg) => {
      const t = await live();
      const r = await exec(t.cwd, arg === undefined ? ["scroll"] : ["scroll", arg]);
      return [r.stdout, scrolls(t.calls)];
    }),
  );
  expect(done).toStrictEqual([
    ["scroll: down\n", ["window.scrollBy(0, 600)"]],
    ["scroll: down\n", ["window.scrollBy(0, 600)"]],
    ["scroll: up\n", ["window.scrollBy(0, -600)"]],
    ["scroll: 250\n", ["window.scrollBy(0, 250)"]],
    ["scroll: -40\n", ["window.scrollBy(0, -40)"]],
    ["scroll: sideways\n", ["window.scrollBy(0, 600)"]],
  ]);
});

it("scroll brings a remembered ref into view", async () => {
  const t = await live();
  expect((await exec(t.cwd, ["scroll", "2"])).stdout).toBe("scroll: 2\n");
  expect(methods(t.calls)).toStrictEqual(["DOM.resolveNode", "Runtime.callFunctionOn"]);
  expect(nth(t.calls, 0).params).toStrictEqual({ backendNodeId: 11 });
  expect(nth(t.calls, 1).params).toMatchObject({ objectId: "oid-11" });
  expect(String(nth(t.calls, 1).params.functionDeclaration)).toContain("scrollIntoView");
});

it("scroll calls a ref stale when it no longer resolves, however the engine says so", async () => {
  const gone = await live({ lastRefs: { "1": { backendNodeId: 99 } } });
  expect((await exec(gone.cwd, ["scroll", "1"])).stderr).toBe("stale ref: 1\n");
  const noObject = await live({}, { replies: { "DOM.resolveNode": {} } });
  expect((await exec(noObject.cwd, ["scroll", "1"])).stderr).toBe("stale ref: 1\n");
  const missing = await live({}, { replies: { "Runtime.evaluate": "node is missing" } });
  expect((await exec(missing.cwd, ["scroll", "up"])).stderr).toBe("stale ref: up\n");
});

it("scroll reports another engine error as it is, with one trailing newline", async () => {
  const t = await live({}, { replies: { "Runtime.evaluate": "Error: boom" } });
  expect(await exec(t.cwd, ["scroll"])).toStrictEqual(failure("boom\n"));
  const nl = await live({}, { replies: { "Runtime.evaluate": "two\nlines\n" } });
  expect(await exec(nl.cwd, ["scroll"])).toStrictEqual(failure("two\nlines\n"));
});

const callParams = (calls: Calls) => calls.filter((c) => c.method === "Runtime.callFunctionOn").map((c) => c.params);

it("click needs a session, then refs, then a known ref", async () => {
  expect((await exec(tmp("browser-act-none-"), ["click", "1"])).stderr).toBe(NO_SESSION);
  const norefs = await live({ lastRefs: {} });
  expect((await exec(norefs.cwd, ["click", "1"])).stderr).toBe("no snap refs; run snap\n");
  const t = await live();
  expect((await exec(t.cwd, ["click", "7"])).stderr).toBe("missing ref: 7\n");
  expect((await exec(t.cwd, ["click"])).stderr).toBe("missing ref: \n");
  expect(t.calls).toStrictEqual([]);
});

it("fill needs text and select needs a value", async () => {
  const t = await live();
  expect((await exec(t.cwd, ["fill", "2"])).stderr).toBe("fill <ref> <text>\n");
  expect((await exec(t.cwd, ["select", "2"])).stderr).toBe("select <ref> <value>\n");
  expect(t.calls).toStrictEqual([]);
});

it("click and hover act on the resolved node", async () => {
  const t = await live();
  expect((await exec(t.cwd, ["click", "1"])).stdout).toBe("click: 1\n");
  expect((await exec(t.cwd, ["hover", "2"])).stdout).toBe("hover: 2\n");
  const resolve = ["DOM.resolveNode", "Runtime.callFunctionOn"];
  expect(methods(t.calls)).toStrictEqual([...resolve, ...resolve]);
  expect(nth(callParams(t.calls), 0)).toStrictEqual({
    objectId: "oid-10",
    functionDeclaration: "function() { this.click(); }",
  });
  expect(nth(callParams(t.calls), 1)).toMatchObject({ objectId: "oid-11" });
  expect(String(nth(callParams(t.calls), 1).functionDeclaration)).toContain("mouseover");
});

it("fill focuses, clears, inserts the joined words, then fires input", async () => {
  const t = await live();
  const r = await exec(t.cwd, ["fill", "2", "hello", "big", "world"]);
  expect(r.stdout).toBe("fill: 2\n");
  expect(methods(t.calls)).toStrictEqual([
    "DOM.resolveNode",
    "Runtime.callFunctionOn",
    "Input.insertText",
    "Runtime.callFunctionOn",
  ]);
  expect(nth(t.calls, 2).params).toStrictEqual({ text: "hello big world" });
  expect(String(nth(callParams(t.calls), 0).functionDeclaration)).toContain("this.focus()");
  expect(String(nth(callParams(t.calls), 1).functionDeclaration)).toContain("'input'");
});

it("select sets the value and fires change", async () => {
  const t = await live();
  expect((await exec(t.cwd, ["select", "2", "opt", "a"])).stdout).toBe("select: 2\n");
  const call = nth(callParams(t.calls), 0);
  expect(call).toMatchObject({ objectId: "oid-11", arguments: [{ value: "opt a" }] });
  expect(String(call.functionDeclaration)).toContain("'change'");
});

it("click calls a ref stale when it does not resolve to an object", async () => {
  const gone = await live({ lastRefs: { "1": { backendNodeId: 99 } } });
  expect((await exec(gone.cwd, ["click", "1"])).stderr).toBe("stale ref: 1\n");
  const noObject = await live({}, { replies: { "DOM.resolveNode": {} } });
  expect((await exec(noObject.cwd, ["click", "1"])).stderr).toBe("stale ref: 1\n");
});

it("click reports another engine error as it is on chromium, with no chromium, or after a spent swap", async () => {
  const replies = { "Runtime.callFunctionOn": "boom" };
  const chrome = await live({ engine: "chromium" }, { replies });
  expect(await exec(chrome.cwd, ["click", "1"], { bins: NEVER })).toStrictEqual(failure("boom\n"));
  const noBin = await live({}, { replies });
  expect((await exec(noBin.cwd, ["click", "1"])).stderr).toBe("boom\n");
  const spent = await live({ swapCount: 1 }, { replies });
  expect((await exec(spent.cwd, ["click", "1"], { bins: NEVER })).stderr).toBe("boom\n");
  expect(readSession(spent.cwd).engine).toBe("lightpanda");
});

it("click replays once on chromium when lightpanda fails the action", async () => {
  const t = await live({}, { replies: { "Runtime.callFunctionOn": "boom" } });
  const chromium = writeFake(t.bin, "chromium");
  const r = await exec(t.cwd, ["click", "1"], { bins: { lightpanda: "", chromium } });
  expect(r).toStrictEqual({ code: 0, stdout: "click: 1\n", stderr: "" });
  const s = readSession(t.cwd);
  expect(s).toMatchObject({ engine: "chromium", escalated: true, swapCount: 1, lastURL: URL_X });
  expect(Object.keys(s.lastRefs)).toStrictEqual(["1", "2"]);
});

it("click reports a stale ref, or the engine's own error, when the chromium replay fails too", async () => {
  const first = { "Runtime.callFunctionOn": "boom" };
  const stale = await live({}, { replies: first });
  const staleBin = writeFake(stale.bin, "chromium", { state: { replies: { "DOM.resolveNode": "node is stale" } } });
  const a = await exec(stale.cwd, ["click", "1"], { bins: { lightpanda: "", chromium: staleBin } });
  expect(a).toStrictEqual(failure("stale ref: 1\n"));
  const other = await live({}, { replies: first });
  const otherBin = writeFake(other.bin, "chromium", { state: { replies: { "Runtime.callFunctionOn": "boom two" } } });
  const b = await exec(other.cwd, ["click", "1"], { bins: { lightpanda: "", chromium: otherBin } });
  expect(b).toStrictEqual(failure("boom two\n"));
});

it("shot and pdf need a session with a url", async () => {
  expect((await exec(tmp("browser-shot-nosess-"), ["shot"], { bins: NEVER })).stderr).toBe(NO_SESSION);
  const noUrl = await live({ lastURL: "" });
  expect((await exec(noUrl.cwd, ["pdf"], { bins: NEVER })).stderr).toBe(NO_SESSION);
});

it("shot names the install hint when no chromium exists", async () => {
  const t = await live();
  const r = await exec(t.cwd, ["shot"]);
  expect(r.code).toBe(1);
  expect(r.stderr).toMatch(/^no browser engine; install lightpanda/);
});

it("shot and pdf write the png and the pdf the engine paints, and say where", async () => {
  const t = await live({ engine: "chromium" });
  const shot = await exec(t.cwd, ["shot"], { bins: NEVER });
  expect(shot).toStrictEqual({
    code: 0,
    stdout: `engine: chromium\nfile: ${path.join(".tmp/repo/browser", "shot.png")}\n`,
    stderr: "",
  });
  const png = fs.readFileSync(path.join(t.cwd, ".tmp/repo/browser/shot.png"));
  expect(png.subarray(0, 4)).toStrictEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const pdf = await exec(t.cwd, ["pdf"], { bins: NEVER });
  expect(pdf.stdout).toBe(`engine: chromium\nfile: ${path.join(".tmp/repo/browser", "page.pdf")}\n`);
  expect(fs.readFileSync(path.join(t.cwd, ".tmp/repo/browser/page.pdf")).subarray(0, 5).toString()).toBe("%PDF-");
  expect(methods(t.calls)).toStrictEqual(["Page.captureScreenshot", "Page.printToPDF"]);
});

it("shot swaps a lightpanda session that recorded no pid to chromium before painting", async () => {
  const t = await live({ pid: undefined });
  const chromium = writeFake(t.bin, "chromium");
  expect((await exec(t.cwd, ["shot"], { bins: { lightpanda: "", chromium } })).code).toBe(0);
  expect(readSession(t.cwd)).toMatchObject({ engine: "chromium", swapCount: 1 });
  expect(fs.existsSync(path.join(t.cwd, ".tmp/repo/browser/shot.png"))).toBe(true);
});

it("shot fails a chromium session whose process is gone", async () => {
  const t = await live({ engine: "chromium", pid: deadPid() });
  expect((await exec(t.cwd, ["shot"], { bins: NEVER })).stderr).toBe(NO_SESSION);
  expect(fs.existsSync(path.join(t.cwd, ".tmp/repo/browser/shot.png"))).toBe(false);
});

it("nav needs a url", async () => {
  const cwd = tmp("browser-nav-nourl-");
  expect((await exec(cwd, ["nav"])).stderr).toBe("nav <url>\n");
  expect((await exec(cwd, ["nav", "   "])).stderr).toBe("nav <url>\n");
});

it("nav stops the engine of the session it replaces, with or without a recorded pid", async () => {
  const cwd = tmp("browser-nav-prev-");
  const lightpanda = writeFake(path.join(cwd, "bin"), "lightpanda");
  const bins = { lightpanda, chromium: "" };
  const old = holder();
  plant(cwd, { engine: "chromium", pid: old, port: 1, lastRefs: {} });
  expect((await exec(cwd, ["nav", "https://example.com/"], { bins })).code).toBe(0);
  await expectGone(old);
  const fresh = readSession(cwd).pid;
  stopFns.push(() => killPid(fresh));
  expect(alive(fresh)).toBe(true);
  plant(cwd, { engine: "chromium", port: 1, lastRefs: {} });
  expect((await exec(cwd, ["nav", "https://example.com/b"], { bins })).code).toBe(0);
});

/** A launcher that exits at once, so the engine never answers. */
function writeDud(dir: string, name: string) {
  return plantStub(dir, name, { sh: "exit 1\n", cmd: "exit /b 1" });
}

it("nav fails with the install hint when the engine never comes up", async () => {
  const cwd = tmp("browser-nav-dud-");
  const bins = { lightpanda: writeDud(path.join(cwd, "bin"), "lightpanda"), chromium: "" };
  const r = await exec(cwd, ["nav", "https://example.com/"], { bins, readyMs: 250 });
  expect(r.code).toBe(1);
  expect(r.stderr).toMatch(/^no browser engine; install lightpanda/);
  expect(fs.existsSync(sessionPath(cwd))).toBe(false);
});

it("nav reports a missing engine binary as a failure instead of an unhandled spawn error", async () => {
  const cwd = tmp("browser-nav-missing-");
  const bins = { lightpanda: path.join(cwd, "bin", "no-such-lightpanda"), chromium: "" };
  const r = await exec(cwd, ["nav", "https://example.com/"], { bins, readyMs: 2000 });
  expect(r.code).toBe(1);
  expect(r.stderr).toMatch(/^no browser engine; install lightpanda/);
  expect(r.stderr).not.toMatch(/ENOENT|Unhandled/);
});

it("nav fails with the install hint when chromium is forced and never comes up", async () => {
  const cwd = tmp("browser-nav-dudc-");
  const bins = { lightpanda: "", chromium: writeDud(path.join(cwd, "bin"), "chromium") };
  const r = await exec(cwd, ["nav", "https://example.com/"], { bins, platform: "win32", readyMs: 250 });
  expect(r.stderr).toMatch(/^no browser engine; install lightpanda/);
});

it("nav fails with the install hint when lightpanda fails its probe and there is no chromium", async () => {
  const cwd = tmp("browser-nav-probe-");
  const lightpanda = writeFake(path.join(cwd, "bin"), "lightpanda", { failProbe: true });
  const r = await exec(cwd, ["nav", "https://example.com/"], { bins: { lightpanda, chromium: "" } });
  expect(r.code).toBe(1);
  expect(r.stderr).toMatch(/^no browser engine; install lightpanda/);
  expect(fs.existsSync(sessionPath(cwd))).toBe(false);
});

it("nav reports 'engine not ready' when the chromium fallback never comes up either", async () => {
  const cwd = tmp("browser-nav-probe2-");
  const lightpanda = writeFake(path.join(cwd, "bin"), "lightpanda", { failProbe: true });
  const chromium = writeDud(path.join(cwd, "bin"), "chromium");
  const r = await exec(cwd, ["nav", "https://example.com/"], { bins: { lightpanda, chromium }, readyMs: 250 });
  expect(r).toStrictEqual(failure("engine not ready\n"));
});

it("nav fails when the engine refuses to navigate, but goes on when it only cannot enable pages", async () => {
  const cwd = tmp("browser-nav-refuse-");
  const bad = writeFake(path.join(cwd, "bin"), "lightpanda", { state: { replies: { "Page.navigate": "nav broke" } } });
  const r = await exec(cwd, ["nav", "https://example.com/"], { bins: { lightpanda: bad, chromium: "" } });
  expect(r).toStrictEqual(failure("nav broke\n"));
  const ok = writeFake(path.join(cwd, "bin2"), "lightpanda", { state: { replies: { "Page.enable": "no" } } });
  const r2 = await exec(cwd, ["nav", "https://example.com/"], { bins: { lightpanda: ok, chromium: "" } });
  expect(r2.stdout).toBe("engine: lightpanda\nurl: https://example.com/\n");
});

it("nav launches a windows .cmd shim through its sibling .mjs, or through a shell without one", async () => {
  const cwd = tmp("browser-nav-cmd-");
  const bin = path.join(cwd, "bin");
  const withMjs = writeLauncher(path.join(bin, "chromium.cmd"), writeMjs(path.join(bin, "chromium.mjs"), {}));
  const a = await exec(cwd, ["nav", "https://example.com/"], {
    platform: "win32",
    bins: { lightpanda: "", chromium: withMjs },
  });
  expect(a.stdout).toBe("engine: chromium\nurl: https://example.com/\n");
  const lone = writeLauncher(path.join(bin, "edge.BAT"), writeMjs(path.join(bin, "engine.mjs"), {}));
  const b = await exec(cwd, ["nav", "https://example.com/b"], {
    platform: "win32",
    bins: { lightpanda: "", chromium: lone },
  });
  expect(b.stdout).toBe("engine: chromium\nurl: https://example.com/b\n");
});

it("stop clears a session that has no pid or a dead one", async () => {
  const cwd = tmp("browser-stop-nopid-");
  plant(cwd, { engine: "lightpanda", port: 1, lastRefs: {} });
  expect(await exec(cwd, ["stop"])).toStrictEqual({ code: 0, stdout: "stopped\n", stderr: "" });
  expect(fs.existsSync(sessionPath(cwd))).toBe(false);
  plant(cwd, { engine: "lightpanda", port: 1, pid: deadPid(), lastRefs: {} });
  expect((await exec(cwd, ["stop"])).code).toBe(0);
  expect(fs.existsSync(sessionPath(cwd))).toBe(false);
});

it("stop ends a stubborn process on windows by force, and shrugs off a dead one", async () => {
  const cwd = tmp("browser-stop-win-");
  const src = "process.on('SIGTERM', () => {}); console.log('up'); setTimeout(() => {}, 60000)";
  const stubborn = spawn(process.execPath, ["-e", src], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  const pid = stubborn.pid ?? 0;
  stopFns.push(() => killPid(pid));
  await new Promise<void>((r) => stubborn.stdout.once("data", () => r()));
  plant(cwd, { engine: "chromium", port: 1, pid, lastRefs: {} });
  expect((await exec(cwd, ["stop"], { platform: "win32" })).code).toBe(0);
  expect(fs.existsSync(sessionPath(cwd))).toBe(false);
  plant(cwd, { engine: "chromium", port: 1, pid: deadPid(), lastRefs: {} });
  expect((await exec(cwd, ["stop"], { platform: "win32" })).code).toBe(0);
});

// ---- the fake CDP server's websocket framing, driven by a raw socket ----------------------------------------

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const acceptKey = (key: string) =>
  crypto
    .createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");

function lengthField(len: number): [number, number] {
  if (len < 126) return [0, len];
  if (len < 65536) return [2, 126];
  return [8, 127];
}

/** A client frame as a browser sends it: masked unless told otherwise. */
function clientFrame(opcode: number, payload: Buffer, mask = true): Buffer {
  const len = payload.length;
  const [ext, marker] = lengthField(len);
  const head = Buffer.alloc(2 + ext);
  head.writeUInt8(0x80 | opcode, 0);
  head.writeUInt8((mask ? 0x80 : 0) | marker, 1);
  if (ext === 2) head.writeUInt16BE(len, 2);
  if (ext === 8) head.writeBigUInt64BE(BigInt(len), 2);
  if (!mask) return Buffer.concat([head, payload]);
  const key = Buffer.from([1, 2, 3, 4]);
  return Buffer.concat([head, key, Buffer.from(payload.map((b, i) => b ^ key.readUInt8(i % 4)))]);
}

const request = (id: number, extra: object = {}) =>
  clientFrame(0x1, Buffer.from(JSON.stringify({ id, method: "Runtime.evaluate", ...extra })));

/** The text of each (short or 16-bit length) unmasked server frame in buf. */
function serverTexts(buf: Buffer): { texts: string[]; rest: Buffer } {
  const texts: string[] = [];
  let at = 0;
  while (buf.length - at >= 2) {
    const wide = (buf.readUInt8(at + 1) & 0x7f) === 126;
    const len = wide ? buf.readUInt16BE(at + 2) : buf.readUInt8(at + 1);
    const start = at + (wide ? 4 : 2);
    if (buf.length < start + len) break;
    texts.push(buf.subarray(start, start + len).toString("utf8"));
    at = start + len;
  }
  return { texts, rest: buf.subarray(at) };
}

/** Opens a socket, upgrades it, and collects what the server frames back. */
async function rawClient(port: number) {
  const sock = net.connect(port, "127.0.0.1");
  stopFns.push(() => sock.destroy());
  const state: { buf: Buffer; closed: boolean; got: string[] } = { buf: Buffer.alloc(0), closed: false, got: [] };
  sock.on("data", (d: Buffer) => (state.buf = Buffer.concat([state.buf, d])));
  sock.on("close", () => (state.closed = true));
  const key = crypto.randomBytes(16).toString("base64");
  const lines = [
    "GET /x HTTP/1.1",
    "Host: x",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
  ];
  sock.write(`${lines.join("\r\n")}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  await vi.waitFor(() => expect(state.buf.includes("\r\n\r\n")).toBe(true));
  const end = state.buf.indexOf("\r\n\r\n") + 4;
  const head = state.buf.subarray(0, end).toString();
  state.buf = state.buf.subarray(end);
  const texts = async (n: number) => {
    await vi.waitFor(() => {
      const { texts: t, rest } = serverTexts(state.buf);
      state.buf = rest;
      state.got.push(...t);
      expect(state.got.length).toBeGreaterThanOrEqual(n);
    });
    return state.got.splice(0);
  };
  return { head, key, write: (b: Buffer) => sock.write(b), closed: () => state.closed, texts };
}

it("the fake handshakes with the accept key for the client's key", async () => {
  const c = await rawClient((await engine()).port);
  expect(c.head).toContain("101 Switching Protocols");
  expect(c.head).toContain(`Sec-WebSocket-Accept: ${acceptKey(c.key)}`);
});

it("the fake drops an upgrade that carries no key", async () => {
  const { port } = await engine();
  const sock = net.connect(port, "127.0.0.1");
  stopFns.push(() => sock.destroy());
  let closed = false;
  sock.on("close", () => (closed = true));
  sock.on("error", () => {});
  sock.write("GET /x HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
  await vi.waitFor(() => expect(closed).toBe(true));
});

it("the fake carries short, mid-size and 70000 byte payloads in both directions", async () => {
  const e = await engine({ markdown: "s".repeat(10) });
  const cdp = await connectCdp(e.port);
  stopFns.push(() => cdp.close());
  const value = async (expression: string) => (await cdp.send("Runtime.evaluate", { expression })).result;
  expect(await value("x".repeat(200))).toStrictEqual({ type: "string", value: "s".repeat(10) });
  e.state.markdown = "m".repeat(300);
  expect(await value("y".repeat(70_000))).toStrictEqual({ type: "string", value: "m".repeat(300) });
  e.state.markdown = "b".repeat(70_000);
  expect(await value("")).toStrictEqual({ type: "string", value: "b".repeat(70_000) });
});

/** Writes one request in three pieces and expects its reply. */
async function trickle(c: Awaited<ReturnType<typeof rawClient>>, id: number, size: number) {
  const frame = request(id, { params: { p: "z".repeat(size) } });
  c.write(frame.subarray(0, 3));
  await wait(60);
  c.write(frame.subarray(3, 12));
  await wait(60);
  c.write(frame.subarray(12));
  expect(await c.texts(1)).toStrictEqual([expect.stringContaining(`"id":${id},`)]);
}

it("the fake reads unmasked frames, and frames whose header or body arrives in pieces", async () => {
  const c = await rawClient((await engine({ markdown: "ok" })).port);
  c.write(clientFrame(0x1, Buffer.from(JSON.stringify({ id: 1, method: "Runtime.evaluate" })), false));
  expect(await c.texts(1)).toStrictEqual([
    JSON.stringify({ id: 1, result: { result: { type: "string", value: "ok" } } }),
  ]);
  await trickle(c, 2, 200);
  await trickle(c, 3, 70_000);
});

it("the fake answers two frames that arrive in one chunk", async () => {
  const c = await rawClient((await engine()).port);
  c.write(Buffer.concat([request(1), request(2)]));
  expect((await c.texts(2)).map((t) => t.slice(0, 8)).sort()).toStrictEqual(['{"id":1,', '{"id":2,']);
});

it("the fake takes binary frames, skips pings and bad json, and ends the socket on close", async () => {
  const c = await rawClient((await engine()).port);
  c.write(clientFrame(0x9, Buffer.from("ping")));
  c.write(clientFrame(0x1, Buffer.from("not json")));
  c.write(clientFrame(0x2, Buffer.from(JSON.stringify({ id: 5, method: "Page.enable" }))));
  expect(await c.texts(1)).toStrictEqual([JSON.stringify({ id: 5, result: {} })]);
  c.write(clientFrame(0x8, Buffer.alloc(0)));
  await vi.waitFor(() => expect(c.closed()).toBe(true));
});

it("the fake answers a request with no params and no method name", async () => {
  const c = await rawClient((await engine()).port);
  c.write(clientFrame(0x1, Buffer.from(JSON.stringify({ id: 9 }))));
  expect(await c.texts(1)).toStrictEqual([JSON.stringify({ id: 9, result: {} })]);
});

// ---- connectCdp against a server that scripts its replies ----------------------------------------------------

function serverFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

/** A cdp server that completes the handshake and answers each request id with the frames the script lists. */
function scripted(reply: (id: number) => string[]): Promise<number> {
  const server = http.createServer((_req, res) => {
    res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${portOf(server)}/x` }));
  });
  server.on("upgrade", (req, socket) => {
    const head = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n";
    socket.write(`${head}Sec-WebSocket-Accept: ${acceptKey(String(req.headers["sec-websocket-key"]))}\r\n\r\n`);
    socket.on("data", (chunk: Buffer) => {
      if ((chunk.readUInt8(0) & 0x0f) !== 0x1) return;
      const key = chunk.subarray(2, 6);
      const body = chunk.subarray(6, 6 + (chunk.readUInt8(1) & 0x7f)).map((b, i) => b ^ key.readUInt8(i % 4));
      const id = Number(/"id":(\d+)/.exec(Buffer.from(body).toString())?.[1]);
      for (const text of reply(id)) socket.write(serverFrame(text));
    });
  });
  return listen(server);
}

it("connectCdp matches replies to requests by id and ignores everything else", async () => {
  const port = await scripted((id) => {
    if (id === 2) return [JSON.stringify({ id: 2, error: { message: "bad" } })];
    if (id === 3) return [JSON.stringify({ id: 3 })];
    return [
      "not json",
      JSON.stringify({ method: "Page.loadEventFired" }),
      '{"id":999,"result":{}}',
      '{"id":1,"error":{}}',
    ];
  });
  const cdp = await connectCdp(port);
  stopFns.push(() => cdp.close());
  await expect(cdp.send("A")).rejects.toThrow("cdp");
  await expect(cdp.send("B")).rejects.toThrow("bad");
  expect(await cdp.send("C")).toStrictEqual({});
});

it("connectCdp close() twice is harmless", async () => {
  const cdp = await connectCdp((await engine()).port);
  expect(() => {
    cdp.close();
    cdp.close();
  }).not.toThrow();
});
