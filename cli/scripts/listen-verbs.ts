/** The verb table of `repo listen`, the context each verb runs in, and the verbs that do not record. */
import { spawn, spawnSync, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

import { repoEnv, type Env } from "../repo-env.ts";
import { whichBin } from "./doctor-which.ts";
import { firstNonEmpty } from "./first-non-empty.ts";
import { loadCfg } from "./listen-argv.ts";
import { finishTranscript } from "./listen-clip.ts";
import { listDevicesText } from "./listen-devices.ts";
import { record, rec, start, stop } from "./listen-rec.ts";
import { clearSession, latestPath, pidAlive, readSession } from "./listen-session.ts";
import { ensureStt, probeStt } from "./listen-whisper.ts";
import { FLAG_TRUE, NEED_STT } from "./listen.constants.ts";
import type {
  ChildLike,
  ListenCtx,
  ListenLog,
  ListenMainOpts,
  ListenVerb,
  SpawnOpts,
  SttOpts,
} from "./listen.types.ts";
import { parsedFetch } from "./parsed-fetch.ts";
import { FLAG_ON } from "./voice-args.constants.ts";
import { parseArgv, str } from "./voice-args.ts";

function nodeSpawn(bin: string, args: string[], opts: SpawnOpts): ChildLike {
  return spawn(bin, args, opts /* SpawnOpts is a subset of SpawnOptions with the same field types */ as SpawnOptions);
}

/** The process seams, from `opts` or the real ones. */
function seams(opts: ListenMainOpts) {
  const log: ListenLog = opts.log ?? console;

  return {
    fetchFn: opts.fetchFn ?? parsedFetch,
    killFn: opts.killFn ?? process.kill.bind(process),
    log,
    nodeBin: firstNonEmpty(opts.nodeBin) ?? process.execPath,
    spawnFn: opts.spawnFn ?? nodeSpawn,
    spawnSyncFn: opts.spawnSyncFn ?? spawnSync,
    whichFn: opts.whichFn ?? whichBin,
  };
}

type PlaceIn = { flags: Record<string, string>; opts: ListenMainOpts; env: Env };

/** The home, cwd, platform and PATH a verb runs with. */
function places({ flags, opts, env }: PlaceIn) {
  return {
    cwd: str(firstNonEmpty(flags.cwd, opts.cwd), process.cwd()),
    home: firstNonEmpty(opts.home) ?? str(firstNonEmpty(env.HOME, env.USERPROFILE), os.homedir()),
    pathEnv: firstNonEmpty(opts.pathEnv, env.PATH) ?? repoEnv.process.PATH,
    platform: opts.platform ?? process.platform,
  };
}

/**
 * Resolves argv, env, seams and config once; `again` reruns `main` with the same `opts`. It stays synchronous so a
 * verb starts in the same tick as `main` when the env is given.
 */
export function contextOf(argv: string[], opts: ListenMainOpts, again: (argv: string[]) => Promise<number>): ListenCtx {
  const { _: rest, flags } = parseArgv(argv);
  const env = opts.env ?? repoEnv.process;
  const { home, cwd, platform, pathEnv } = places({ env, flags, opts });
  const { whichFn, ...io } = seams(opts);
  const ffmpegBin = whichFn("ffmpeg", pathEnv, platform);
  const cfg = loadCfg({ env, home });
  const sttOpts: SttOpts = { cfg, cwd, fetchFn: io.fetchFn, home, log: io.log, pathEnv, platform, whichFn };
  const clip = flags.clip === FLAG_ON || flags.clip === FLAG_TRUE;
  const device = str(flags.device, cfg.device);

  return {
    ...io,
    again,
    cfg,
    clip,
    cwd,
    device,
    env,
    ffmpegBin,
    flags,
    home,
    platform,
    rest,
    sttOpts,
    waitPid: opts.waitPid,
  };
}

async function sttOrProbe(opts: SttOpts) {
  try {
    return await ensureStt(opts);
  } catch {
    return probeStt(opts);
  }
}

async function whoami({ ffmpegBin, log, sttOpts }: ListenCtx): Promise<number> {
  const ff = ffmpegBin === "" ? "missing" : ffmpegBin;
  const stt = await sttOrProbe(sttOpts);

  if (stt === null) {
    log.log(`stt=none  ffmpeg=${ff}`);
    log.error(NEED_STT);

    return 1;
  }

  if (stt.kind === "local") log.log(`stt=local  bin=${stt.bin}  model=${stt.model}  ffmpeg=${ff}`);
  else log.log(`stt=openai  model=${stt.model}  ffmpeg=${ff}`);

  return 0;
}

function devices({ platform, ffmpegBin, spawnSyncFn, log }: ListenCtx): number {
  const list = listDevicesText({ ffmpegBin, platform, spawnSyncFn });

  if (list.length === 0) log.log("no audio devices");

  for (const d of list) log.log(`${d.id}  ${d.name}`);

  return 0;
}

function latest({ cwd, log }: ListenCtx): number {
  const p = latestPath(cwd);

  if (!fs.existsSync(p)) {
    log.error("no transcript");

    return 1;
  }

  log.log(fs.readFileSync(p, "utf8").trimEnd());

  return 0;
}

function status({ cwd, killFn, log }: ListenCtx): number {
  const s = readSession(cwd);
  const hasPid = Boolean(s.pid);

  if (!hasPid) {
    log.log("idle");

    return 0;
  }

  const alive = pidAlive(s.pid, killFn);
  log.log(`${alive ? "recording" : "stale"}  pid=${str(s.pid)}  wav=${str(s.wav, "-")}`);

  if (!alive) clearSession(cwd);

  return 0;
}

async function file(ctx: ListenCtx): Promise<number> {
  const { flags, rest } = ctx;
  const wav = str(firstNonEmpty(flags.path, flags.file, flags.out, rest[1]));

  if (wav === "") throw new Error("file needs --path");
  await finishTranscript(ctx, wav, await ensureStt(ctx.sttOpts));

  return 0;
}

/** `toggle`: `stop` when a recorder runs, else `start`, each through `main` again. */
function toggle({ cwd, flags, clip, device, killFn, again }: ListenCtx): Promise<number> {
  const s = readSession(cwd);
  const at = firstNonEmpty(flags.cwd) === undefined ? [] : ["--cwd", cwd];

  if (pidAlive(s.pid, killFn)) return again(["stop", ...(clip ? ["--clip"] : []), ...at]);

  return again(["start", ...(device === "" ? [] : ["--device", device]), ...at]);
}

export const VERBS: ReadonlyMap<string, ListenVerb> = /* @__PURE__ */ new Map<string, ListenVerb>([
  ["whoami", whoami],
  ["devices", devices],
  ["latest", latest],
  ["status", status],
  ["file", file],
  ["_record", record],
  ["start", start],
  ["stop", stop],
  ["toggle", toggle],
  ["rec", rec],
]);
