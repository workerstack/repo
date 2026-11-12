/** Each setup target's ok or missing status, and the print-only install hint for a missing binary. */
import os from "node:os";

import { repoEnv, type Env } from "../repo-env.ts";
import { jevDoctorStatus, speakDoctorStatus, workspaceDoctorStatus } from "./doctor-status.ts";
import { installHints, whichBin } from "./doctor-which.ts";
import { CHROMIUM_BINS } from "./doctor.constants.ts";
import { firstNonEmpty } from "./first-non-empty.ts";
import type { WhichFn } from "./listen.types.ts";
import { logLine } from "./setup-io.ts";
import { ALWAYS_ON, TARGETS } from "./setup.constants.ts";
import type { SetupIo, Status, TargetStatuses } from "./setup.types.ts";
import { WIN32 } from "./win32.constants.ts";

type StatusOpts = {
  home?: string | undefined;
  env?: Env | undefined;
  whichFn?: WhichFn | undefined;
  pathEnv?: string | undefined;
  platform?: NodeJS.Platform | undefined;
  targets?: string[] | undefined;
};

/** Where binaries are looked up. */
type Probe = { whichFn: WhichFn; pathEnv: string | undefined; platform: NodeJS.Platform };

type Hint = {
  id: string;
  found?: string | undefined;
  probe?: (() => string) | undefined;
  platform?: NodeJS.Platform | undefined;
  io?: SetupIo | null | undefined;
  interactive?: boolean | undefined;
};

export function lookupChromium(
  whichFn: WhichFn = whichBin,
  pathEnv: string | undefined = repoEnv.process.PATH,
  platform: NodeJS.Platform = process.platform,
): string {
  for (const n of CHROMIUM_BINS) {
    const hit = whichFn(n, pathEnv, platform);
    if (hit !== "") return hit;
  }
  return "";
}

export function browserEngineStatus(lp: string, cr: string, platform: NodeJS.Platform = process.platform): Status {
  const hasLp = lp !== "";
  const hasCr = cr !== "";
  const have: string[] = [];
  if (hasLp) have.push("lightpanda");
  if (hasCr) have.push("chromium");
  if (hasLp && hasCr) return { extra: have.join(","), ok: true };
  if (platform === WIN32 && hasCr) return { extra: have.concat(["need lightpanda in WSL"]).join(","), ok: true };

  const need: string[] = [];
  if (!hasLp) need.push("need lightpanda");
  if (!hasCr) need.push("need chromium");
  return { extra: have.concat(need).join(","), ok: false };
}

export function setupTargets(packs: string[] = []): string[] {
  const on = new Set(packs);
  return TARGETS.filter((target) => ALWAYS_ON.includes(target) || on.has(target));
}

function statusProbe(opts: StatusOpts): { env: Env; home: string; probe: Probe } {
  const home = opts.home ?? os.homedir();
  const env = opts.env ?? repoEnv.process;
  const pathEnv = firstNonEmpty(opts.pathEnv, env.PATH, repoEnv.process.PATH);
  return {
    env,
    home,
    probe: { pathEnv, platform: opts.platform ?? process.platform, whichFn: opts.whichFn ?? whichBin },
  };
}

async function listenStatus(env: Env, home: string, { whichFn, pathEnv, platform }: Probe): Promise<Status> {
  const { loadCfg } = await import("./listen-argv.ts");
  const { probeStt, findWhisperBin } = await import("./listen-whisper.ts");
  const cfg = loadCfg({ env, home });
  const stt = probeStt({ cfg, cwd: "", home, pathEnv, platform, whichFn });
  const ffmpeg = whichFn("ffmpeg", pathEnv, platform);
  const whisper = findWhisperBin(whichFn, pathEnv, platform);
  const listenBits: string[] = [];
  if (stt !== null) listenBits.push(stt.kind);
  if (ffmpeg !== "") listenBits.push("ffmpeg");
  if (whisper !== "") listenBits.push("whisper");
  return { extra: listenBits.join(","), ok: stt !== null };
}

export async function targetStatuses(opts: StatusOpts = {}): Promise<TargetStatuses> {
  const { env, home, probe } = statusProbe(opts);
  const { pathEnv, platform, whichFn } = probe;
  const speak = speakDoctorStatus({ env, home });
  const jev = jevDoctorStatus({ env, home });
  const ws = workspaceDoctorStatus({ home });
  const lp = whichFn("lightpanda", pathEnv, platform);
  const cr = lookupChromium(whichFn, pathEnv, platform);
  const listen = (opts.targets ?? TARGETS).includes("listen")
    ? await listenStatus(env, home, probe)
    : { extra: "", ok: false };
  return {
    browser: browserEngineStatus(lp, cr, platform),
    "google-workspace": { extra: ws.extra, ok: ws.ok },
    jev: { extra: jev.extra, ok: jev.ok },
    listen,
    speak: { extra: speak.extra, ok: speak.ok },
  };
}

/** After an install confirm, looks again and reports what it found. */
async function recheck({ id, io, probe }: Hint): Promise<string> {
  if (typeof io?.confirm !== "function") return "";
  const again = await io.confirm({
    initialValue: false,
    message: `Installed ${id}? Re-check PATH`,
  });
  if (!again) return "";
  const hit = typeof probe === "function" ? probe() : "";
  logLine(io, hit === "" ? `${id} still missing` : `${id} ok  ${hit}`);
  return hit;
}

export async function reprobeHint(hint: Hint): Promise<string> {
  const { id, io, platform = process.platform } = hint;
  const hit = hint.found ?? "";
  if (hit !== "") {
    logLine(io, `${id} ok  ${hit}`);
    return hit;
  }
  logLine(io, `${id} missing. print-only; not installed:`);
  for (const h of installHints(id, platform)) logLine(io, h);
  return hint.interactive === true ? await recheck(hint) : hit;
}
