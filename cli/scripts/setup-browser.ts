import { REPO, STATE } from "../repo-dirs.ts";
/** `repo setup browser`: prints install hints for Lightpanda and a chromium-family browser; no secrets. */
import { repoEnv } from "../repo-env.ts";
import { whichBin } from "./doctor-which.ts";
import { logLine } from "./setup-io.ts";
import { browserEngineStatus, lookupChromium, reprobeHint } from "./setup-status.ts";
import type { SetupCtx } from "./setup.types.ts";
import { WIN32 } from "./win32.constants.ts";

/** What to install next, given the engines found; "" when there is nothing to say. */
function browserAdvice(lp: string, chromium: string, platform: NodeJS.Platform): string {
  const hasLp = lp !== "";
  const hasChromium = chromium !== "";

  if (hasLp && hasChromium) return "browser ok  lightpanda (default) + chromium (fallback)";

  if (!hasLp && hasChromium && platform !== WIN32)
    return "Chromium is the fallback only. Install Lightpanda as well (default engine).";

  if (hasLp && !hasChromium) return "Lightpanda ok. Install a chromium-family browser as well (shot/pdf/fallback).";

  return "";
}

export async function setupBrowser(ctx: SetupCtx = {}): Promise<{ ok: boolean; lightpanda: string; chromium: string }> {
  const {
    io,
    platform = process.platform,
    pathEnv = repoEnv.process.PATH,
    whichFn = whichBin,
    interactive = false,
  } = ctx;

  function findLp(): string {
    return whichFn("lightpanda", pathEnv, platform);
  }

  function findCr(): string {
    return lookupChromium(whichFn, pathEnv, platform);
  }

  const lp = await reprobeHint({ found: findLp(), id: "lightpanda", interactive, io, platform, probe: findLp });
  const chromium = await reprobeHint({ found: findCr(), id: "chromium", interactive, io, platform, probe: findCr });
  const st = browserEngineStatus(lp, chromium, platform);
  logLine(io, `session: ${REPO}/${STATE}/browser/`);
  const advice = browserAdvice(lp, chromium, platform);

  if (advice !== "") logLine(io, advice);

  return { chromium, lightpanda: lp, ok: st.ok };
}
