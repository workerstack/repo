import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  isBlockedSnap,
  isPaintHost,
  lookupBins,
  pickEngine,
  runBrowser,
  whichBin,
} from "./browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const script = path.join(here, "browser.mjs");

const tmpDirs: string[] = [];

function killPid(pid: number) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      timeout: 5000,
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    /* ignore */
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* ignore */
  }
}

function pause(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function rmRetry(dir: string) {
  let last: unknown;
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      last = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" && code !== "ENOTEMPTY" && code !== "EPERM") throw err;
      pause(40 * (i + 1));
    }
  }
  throw last;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      const s = JSON.parse(
        fs.readFileSync(path.join(d, ".tmp/grunt/browser/session.json"), "utf8"),
      );
      if (s.pid) killPid(s.pid);
    } catch {
      /* ignore */
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
  const names = BROWSER_NAMES.flatMap((n) =>
    process.platform === "win32" ? [n, `${n}.exe`, `${n}.cmd`] : [n],
  );
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
  const rest = (process.env.PATH || "")
    .split(path.delimiter)
    .filter((dir) => dir && dir !== binDir && !dirHasBrowser(dir));
  return [binDir, ...rest].join(path.delimiter);
}

function writeFake(
  binDir: string,
  name: string,
  opts: { failProbe?: boolean; thinSnap?: boolean } = {},
) {
  const fail = opts.failProbe ? "true" : "false";
  const thin = opts.thinSnap ? "true" : "false";
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
const { close } = await serveCdp({ failProbe: ${fail}, thinSnap: ${thin}, pid: process.pid }, { port });
process.on("SIGTERM", () => { close(); process.exit(0); });
process.on("SIGINT", () => { close(); process.exit(0); });
`;
  fs.mkdirSync(binDir, { recursive: true });
  const mjs = path.join(binDir, `${name}.mjs`);
  fs.writeFileSync(mjs, body);
  if (process.platform === "win32") {
    const dest = path.join(binDir, `${name}.cmd`);
    fs.writeFileSync(
      dest,
      `@echo off\r\n${JSON.stringify(process.execPath)} ${JSON.stringify(mjs)} %*\r\n`,
    );
    return dest;
  }
  const dest = path.join(binDir, name);
  fs.writeFileSync(
    dest,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(mjs)} "$@"\n`,
    { mode: 0o755 },
  );
  return dest;
}

function sessionPath(cwd: string) {
  return path.join(cwd, ".tmp/grunt/browser/session.json");
}

function readSession(cwd: string) {
  return JSON.parse(fs.readFileSync(sessionPath(cwd), "utf8"));
}

function envFor(binDir: string) {
  const env = { ...process.env, PATH: mockPath(binDir) };
  delete env.GRUNT_BROWSER;
  delete env.GRUNT_BROWSER_ENGINE;
  delete env.LIGHTPANDA_CDP_URL;
  return env;
}

async function run(cwd: string, args: string[], binDir: string, extra: { platform?: string } = {}) {
  return runBrowser(args, {
    cwd,
    env: envFor(binDir),
    platform: extra.platform ?? "linux",
  });
}

function runCli(cwd: string, args: string[], binDir: string) {
  return spawnSync(process.execPath, [script, ...args], {
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
    expect(isBlockedSnap("Sorry, we just need to make sure you're not a robot", [])).toBe(
      true,
    );
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
});

describe("nav / snap / stop", () => {
  it("lightpanda on PATH → nav uses Lightpanda; session under .tmp/grunt/browser/; no env", async () => {
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
    expect(path.normalize(sessionPath(cwd))).toContain(path.join(".tmp", "grunt", "browser"));
    expect(process.env.GRUNT_BROWSER).toBeUndefined();
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
    await new Promise((r) => setTimeout(r, 50));
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
    s.lastRefs["1"].backendNodeId = 99999;
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
    const art = path.join(cwd, ".tmp/grunt/browser/shot.png");
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
  }, 20_000);

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
    expect(fs.existsSync(path.join(cwd, ".tmp/grunt/browser/page.pdf"))).toBe(true);
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
