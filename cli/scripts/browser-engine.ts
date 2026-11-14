/** Choosing, starting, stopping and swapping the engine a session runs on. */
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { connectCdp } from "./browser-cdp.ts";
import { filled, newSession, sessionDir } from "./browser-session.ts";
import { isPaintHost } from "./browser-snap.ts";
import { freePort, waitVersion } from "./browser-wait.ts";
import { CHROMIUM_VERBS, engineExitedText, HOST, PROFILE_DIR, TASKKILL_MS } from "./browser.constants.ts";
import type { Bins, Ctx, Engine, PickOpts, Picked, Session } from "./browser.types.ts";
import { installHints, whichBin } from "./doctor-which.ts";
import { CHROMIUM_BINS, LIGHTPANDA_REPO } from "./doctor.constants.ts";

/** What a verb prints when no engine can run. */
export const NO_ENGINE: string = `no browser engine; install lightpanda (${LIGHTPANDA_REPO}) or Chromium`;

/** A Windows shell shim's extension, which `spawnEngine` runs through its `.mjs` or a shell. */
const SHIM_EXT = /\.(cmd|bat)$/i;

function firstChromium(pathEnv: string | undefined, platform: NodeJS.Platform): string {
  for (const name of CHROMIUM_BINS) {
    const bin = whichBin(name, pathEnv, platform);

    if (bin !== "") return bin;
  }

  return "";
}

export function lookupBins(pathEnv: string | undefined, platform: NodeJS.Platform = process.platform): Bins {
  return {
    chromium: firstChromium(pathEnv, platform),
    lightpanda: whichBin("lightpanda", pathEnv, platform),
  };
}

export function doctorHints(platform: NodeJS.Platform = process.platform): string[] {
  return [...installHints("lightpanda", platform), ...installHints("chromium", platform)];
}

export function installHint(platform: NodeJS.Platform = process.platform): string {
  return [NO_ENGINE, ...doctorHints(platform)].join("\n");
}

function wantsChromium(opts: PickOpts, platform: NodeJS.Platform): boolean {
  if (opts.forceChromium === true || platform === "win32") return true;

  return CHROMIUM_VERBS.has(opts.verb ?? "") || isPaintHost(opts.url ?? "");
}

export function pickEngine(opts: PickOpts = {}): Picked {
  const platform = opts.platform ?? process.platform;
  const bins = opts.bins ?? {};

  if (filled(bins.lightpanda) !== undefined && !wantsChromium(opts, platform)) return { engine: "lightpanda" };

  if (filled(bins.chromium) !== undefined) return { engine: "chromium" };

  return { engine: null, error: installHint(platform) };
}

/**
 * Whether a spawn or kill here goes through Windows: the platform asked for, or the host, whose process model
 * decides.
 */
function onWindows(platform: NodeJS.Platform): boolean {
  return platform === "win32" || process.platform === "win32";
}

function tryKill(pid: number, signal?: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // already gone
  }
}

/** Stops the engine `pid` and, off Windows, its process group. */
export function killPid(pid: number | undefined, platform: NodeJS.Platform): void {
  if (pid === undefined || pid === 0) return;

  if (onWindows(platform)) {
    // The tree first: a shell shim's child outlives the shell once that is killed, and holds the profile dir open.
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      timeout: TASKKILL_MS,
      windowsHide: true,
    });
    tryKill(pid);

    return;
  }

  tryKill(-pid, "SIGTERM");
  tryKill(pid, "SIGTERM");
}

function spawnEngine(bin: string, args: string[], ctx: Ctx): ChildProcess {
  const opts: SpawnOptions = {
    cwd: ctx.cwd,
    detached: true,
    env: ctx.env,
    stdio: ["ignore", "pipe", "pipe"],
  };

  if (!onWindows(ctx.platform) || !SHIM_EXT.test(bin)) return spawn(bin, args, opts);
  const mjs = `${bin.replace(SHIM_EXT, "")}.mjs`;

  try {
    fs.accessSync(mjs, fs.constants.F_OK);

    return spawn(process.execPath, [mjs, ...args], opts);
  } catch {
    return spawn(bin, args, { ...opts, shell: true });
  }
}

function spawnArgs(engine: Engine, port: number, profile: string): string[] {
  if (engine === "lightpanda") return ["serve", "--host", HOST, "--port", String(port)];

  return [
    "--headless=new",
    "--disable-gpu",
    "--remote-debugging-port",
    String(port),
    "--user-data-dir",
    profile,
    "about:blank",
  ];
}

async function launchEngine(engine: Engine, ctx: Ctx): Promise<Session> {
  const bin = engine === "lightpanda" ? ctx.bins.lightpanda : ctx.bins.chromium;
  const profile = path.join(sessionDir(ctx.cwd), PROFILE_DIR);
  fs.mkdirSync(profile, { recursive: true });
  const port = await freePort();
  const child = spawnEngine(bin, spawnArgs(engine, port, profile), ctx);
  child.unref();
  // An engine that cannot start (missing, not executable) reports through 'error'; unhandled it would crash the
  // process. One that exits before it answers ends the wait at once; the first failure seen is the one reported.
  let spawnError: Error | undefined;
  child.once("error", (err) => {
    spawnError ??= new Error(`engine failed to start: ${err.message}`);
  });
  child.once("exit", (code, signal) => {
    spawnError ??= new Error(engineExitedText(code, signal));
  });

  try {
    await waitVersion(port, ctx.readyMs, () => spawnError);
  } catch (err) {
    killPid(child.pid, ctx.platform);
    throw err;
  }

  return newSession(engine, child.pid, port);
}

async function probe(session: Session): Promise<void> {
  const cdp = await connectCdp(session.port);

  try {
    await cdp.send("Browser.getVersion");
  } finally {
    cdp.close();
  }
}

/** A session on `engine`, or on Chromium when Lightpanda starts but fails its probe; null when none starts. */
export async function openSession(engine: Engine, ctx: Ctx): Promise<Session | null> {
  const session = await launchEngine(engine, ctx).catch(() => null);

  if (session === null || engine !== "lightpanda") return session;

  const probed = await probe(session).then(
    () => true,
    () => false,
  );

  if (probed) return session;
  killPid(session.pid, ctx.platform);

  if (ctx.bins.chromium === "") return null;
  const next = await launchEngine("chromium", ctx);

  return { ...next, escalated: true, swapCount: 1 };
}

/** Opens `url` in `session`'s engine. */
export async function navigate(session: Session, url: string): Promise<void> {
  const cdp = await connectCdp(session.port);

  try {
    await cdp.send("Page.enable").catch(() => {});
    await cdp.send("Page.navigate", { url });
    session.lastURL = url;
  } finally {
    cdp.close();
  }
}

/** Whether a Lightpanda session that failed may still move to Chromium once. */
export function canSwap(session: Session, bins: Bins): boolean {
  return session.engine === "lightpanda" && session.swapCount < 1 && Boolean(bins.chromium);
}

/** `session` moved to a fresh Chromium on the same page and refs. */
export async function swapToChromium(session: Session, ctx: Ctx): Promise<Session> {
  const url = session.lastURL;
  killPid(session.pid, ctx.platform);
  const next = await launchEngine("chromium", ctx);
  next.lastURL = url;
  next.lastRefs = session.lastRefs;
  next.escalated = true;
  next.swapCount = session.swapCount + 1;

  if (url !== "") await navigate(next, url);

  return next;
}
