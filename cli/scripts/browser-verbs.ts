/** One handler per `repo browser` verb. */
import fs from "node:fs";
import path from "node:path";

import { childEnv } from "../env.ts";
import { clickAct, fillAct, hoverAct, refVerb, scroll, selectAct } from "./browser-act.ts";
import { withCdp } from "./browser-cdp.ts";
import {
  canSwap,
  killPid,
  lookupBins,
  navigate,
  NO_ENGINE,
  openSession,
  pickEngine,
  swapToChromium,
} from "./browser-engine.ts";
import {
  alive,
  clearSession,
  fail,
  liveSession,
  ok,
  readSession,
  sessionDir,
  writeSession,
} from "./browser-session.ts";
import { isBlockedSnap, snapText, snapshot } from "./browser-snap.ts";
import { sleep } from "./browser-wait.ts";
import {
  NAV,
  NAV_USAGE,
  NO_SESSION,
  PDF,
  READY_MS,
  SESSION_REL,
  SHOT,
  STOPPED,
  STOP_SETTLE_MS,
  WAIT_DEFAULT,
  WAIT_MAX_MS,
} from "./browser.constants.ts";
import type { BrowserResult, Capture, Ctx, RunOpts, Session, Verb } from "./browser.types.ts";
import { globalsRow, runDoctor } from "./doctor.ts";

async function stop(_argv: string[], ctx: Ctx): Promise<BrowserResult> {
  killPid(readSession(ctx.cwd)?.pid, ctx.platform);
  clearSession(ctx.cwd);
  await sleep(STOP_SETTLE_MS);
  return ok(STOPPED);
}

async function doctor(_argv: string[], { cwd, env, platform }: Ctx): Promise<BrowserResult> {
  return runDoctor({
    cwd,
    globals: await globalsRow(cwd, env.HOME),
    pathEnv: env.PATH,
    platform,
  });
}

async function nav(argv: string[], ctx: Ctx): Promise<BrowserResult> {
  const url = String(argv[1] || "").trim();
  if (!url) return fail(NAV_USAGE);
  const picked = pickEngine({
    bins: ctx.bins,
    platform: ctx.platform,
    url,
    verb: NAV,
  });
  if (!picked.engine) return fail(picked.error);
  killPid(readSession(ctx.cwd)?.pid, ctx.platform);
  const session = await openSession(picked.engine, ctx);
  if (!session) return fail(NO_ENGINE);
  try {
    await navigate(session, url);
  } catch (err) {
    killPid(session.pid, ctx.platform); // no session is written, so nothing else would ever stop this engine
    throw err;
  }
  writeSession(ctx.cwd, session);
  return ok(`engine: ${session.engine}\nurl: ${session.lastURL}`);
}

async function snap(_argv: string[], ctx: Ctx): Promise<BrowserResult> {
  let session = liveSession(ctx.cwd);
  if (!session) return fail(NO_SESSION);
  let read = await snapshot(session);
  if (canSwap(session, ctx.bins) && isBlockedSnap(read.markdown, read.lines)) {
    session = await swapToChromium(session, ctx);
    read = await snapshot(session);
  }
  writeSession(ctx.cwd, session);
  return ok(snapText(session, read, ctx.cwd));
}

async function wait(argv: string[], ctx: Ctx): Promise<BrowserResult> {
  if (!liveSession(ctx.cwd)) return fail(NO_SESSION);
  const ms = Math.min(WAIT_MAX_MS, Math.max(0, Number(String(argv[1] || WAIT_DEFAULT)) || 0));
  await sleep(ms);
  return ok(`wait: ${ms}`);
}

/** `session` on a running Chromium: moved there from Lightpanda, or null when its Chromium is gone. */
async function onChromium(session: Session, ctx: Ctx): Promise<Session | null> {
  if (session.engine === "chromium") return alive(session.pid) ? session : null;
  return await swapToChromium(session, ctx);
}

function capture(spec: Capture): Verb {
  return async (_argv, ctx) => {
    const found = readSession(ctx.cwd);
    if (!found || !found.lastURL) return fail(NO_SESSION);
    const picked = pickEngine({
      bins: ctx.bins,
      forceChromium: true,
      platform: ctx.platform,
      url: found.lastURL,
      verb: spec.verb,
    });
    if (!picked.engine) return fail(picked.error);
    const session = await onChromium(found, ctx);
    if (!session) return fail(NO_SESSION);
    const dir = sessionDir(ctx.cwd);
    fs.mkdirSync(dir, { recursive: true });
    await withCdp(session, async (cdp) => {
      const r = await cdp.send(spec.method, spec.params);
      fs.writeFileSync(path.join(dir, spec.file), Buffer.from(String(r.data), "base64"));
    });
    writeSession(ctx.cwd, session);
    return ok(`engine: ${session.engine}\nfile: ${path.join(SESSION_REL, spec.file)}`);
  };
}

/** Every verb but help, by name. */
export const VERBS: ReadonlyMap<string, Verb> = /* @__PURE__ */ new Map<string, Verb>([
  ["doctor", doctor],
  ["ensure", doctor],
  ["stop", stop],
  ["nav", nav],
  ["snap", snap],
  ["wait", wait],
  ["scroll", scroll],
  ["click", /* @__PURE__ */ refVerb("click", clickAct)],
  ["hover", /* @__PURE__ */ refVerb("hover", hoverAct)],
  ["select", /* @__PURE__ */ refVerb("select", selectAct)],
  ["fill", /* @__PURE__ */ refVerb("fill", fillAct)],
  ["shot", /* @__PURE__ */ capture(SHOT)],
  ["pdf", /* @__PURE__ */ capture(PDF)],
]);

/** What a verb runs in: `opts`, with the process cwd, env and platform and the engines on PATH for what it lacks. */
export function contextOf(opts: RunOpts): Ctx {
  const env = opts.env ?? childEnv();
  const platform = opts.platform ?? process.platform;
  const bins = opts.bins ?? lookupBins(env.PATH, platform);
  return {
    bins,
    cwd: opts.cwd || process.cwd(),
    env,
    platform,
    readyMs: opts.readyMs ?? READY_MS,
  };
}
