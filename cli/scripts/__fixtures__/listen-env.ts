import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { main } from "../listen.ts";
import { loadCfg } from "../listen-argv.ts";
import { sessionPath } from "../listen-session.ts";
import type {
  ChildLike,
  ErrorListener,
  ExitListener,
  FetchFn,
  FetchResult,
  ListenCfg,
  ListenMainOpts,
  SpawnOpts,
  SpawnSyncResult,
  SttOpts,
} from "../listen.types.ts";
import { z } from "zod";
import { isRecord, type Json, type JsonObject, readJson } from "../../json.ts";
import { fetchResult } from "./fetch-result.ts";
import { removeTemps } from "../../__fixtures__/remove-temps.ts";

/** The listeners a fake child was handed, by event. */
export type Handlers = { error?: ErrorListener; exit?: ExitListener };

/** A fake child's `on`: it records each listener under its event in `handlers`. */
export function recordOn(handlers: Handlers): NonNullable<ChildLike["on"]> {
  function on(event: "error", cb: ErrorListener): void;
  function on(event: "exit", cb: ExitListener): void;
  function on(event: keyof Handlers, cb: ErrorListener | ExitListener): void {
    Object.assign(handlers, { [event]: cb });
  }

  return on;
}

const tmpDirs: string[] = [];

/** Path of bin/repo.ts, which `start` hands to the detached recorder. */
export function repoBin(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "bin", "repo.ts");
}

/** Call from `afterEach`: restores timers and spies and removes every temp dir `tmp` made. */
export function cleanupTmp() {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // A planted Windows program stays locked for a moment after its detached process exits, so the remove retries.
  removeTemps(tmpDirs.splice(0));
}

export function tmp(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(dir);
  return dir;
}

export const FFMPEG = "/usr/bin/ffmpeg";
export const which =
  (map: Record<string, string> = { ffmpeg: FFMPEG }) =>
  (name: string) =>
    map[name] || "";
export const AV =
  "[AVFoundation indev @ 0x] AVFoundation audio devices:\n[AVFoundation indev @ 0x] [0] MacBook Pro Microphone\n";
export const textFetch =
  (text: string): FetchFn =>
  () =>
    Promise.resolve(fetchResult({ ok: true, status: 200, json: () => Promise.resolve({ text }) }));
export const failFetch: FetchFn = () => Promise.resolve(fetchResult({ ok: false, status: 500 }));
export const quiet = { log() {}, error() {} };

export interface Ran {
  code: number;
  logs: string[];
  errs: string[];
  cwd: string;
  home: string;
}

export async function run(argv: string[], over: ListenMainOpts = {}): Promise<Ran> {
  const logs: string[] = [];
  const errs: string[] = [];
  const cwd = over.cwd ?? tmp("listen-main-c-");
  const home = over.home ?? tmp("listen-main-h-");
  const log = { log: (s: string) => logs.push(s), error: (s: string) => errs.push(s) };
  const base = { env: { OPENAI_API_KEY: "sk_oa" }, whichFn: which(), platform: "darwin" as const };
  const code = await main(argv, { ...base, ...over, home, cwd, log });
  return { code, logs, errs, cwd, home };
}

export function plantSession(cwd: string, session: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(sessionPath(cwd)), { recursive: true });
  fs.writeFileSync(sessionPath(cwd), JSON.stringify(session));
}

export function readSession(cwd: string): JsonObject {
  const parsed = readJson(z.json(), fs.readFileSync(sessionPath(cwd), "utf8"));
  return isRecord(parsed) ? parsed : {};
}

export function plantWav(dir: string, name = "clip.wav"): string {
  const wav = path.join(dir, name);
  fs.writeFileSync(wav, "RIFF");
  return wav;
}

export function plantSpeakJson(home: string, body: unknown) {
  fs.mkdirSync(path.join(home, ".workerstack"), { recursive: true });
  fs.writeFileSync(path.join(home, ".workerstack", "speak.json"), JSON.stringify(body));
}

/** A killFn where the listed pids answer signal 0 until a SIGINT arrives. */
export function killTable(alive: number[]) {
  const live = new Set(alive);
  const sent: Array<[number, string | number]> = [];
  const killFn = (pid: number, sig: string | number): unknown => {
    sent.push([pid, sig]);
    if (!live.has(pid)) throw new Error("ESRCH");
    if (sig === "SIGINT") live.delete(pid);
    return true;
  };
  return { sent, killFn };
}

/** A spawnSyncFn standing in for the clipboard; `inputs` collects what was piped to it. */
export function clipboard(status = 0) {
  const inputs: string[] = [];
  const spawnSyncFn = (_cmd: string, _args: string[], o: { input?: string }): SpawnSyncResult => {
    inputs.push(String(o.input));
    return { status };
  };
  return { inputs, spawnSyncFn };
}

export function recorder(pid: number | undefined = 5150, unref = true) {
  const spawned: Array<{ bin: string; args: string[]; opts: SpawnOpts }> = [];
  let unrefs = 0;
  const spawnFn = (bin: string, args: string[], opts: SpawnOpts): ChildLike => {
    spawned.push({ bin, args, opts });
    return unref ? { pid, unref: () => void (unrefs += 1) } : { pid };
  };
  return { spawned, unrefs: () => unrefs, spawnFn };
}

export function recording(opts: { wav?: string | null; pid?: number } = {}) {
  const cwd = tmp("listen-stop-");
  const wav = opts.wav === null ? undefined : (opts.wav ?? plantWav(cwd, "rec.wav"));
  plantSession(cwd, { pid: opts.pid ?? 3000, ...(wav ? { wav } : {}) });
  return { cwd, wav };
}

export type FfmpegCtx = { out: string; errFd: number; on: Handlers };
export type Seen = { args: string[] };

/** A spawnFn for a fake ffmpeg: its script can write the wav and the log fd, then exit or fail. */
export function ffmpeg(script: (ctx: FfmpegCtx) => void, seen: Seen[] = []) {
  return (_bin: string, args: string[], opts: SpawnOpts): ChildLike => {
    const on: Handlers = {};
    seen.push({ args });
    queueMicrotask(() => script({ out: args.at(-1) ?? "", errFd: Number(opts.stdio?.[2]), on }));
    return { on: recordOn(on), pid: 777 };
  };
}

export const wavThen = (code: number) => (ctx: FfmpegCtx) => {
  fs.writeFileSync(ctx.out, "RIFF");
  ctx.on.exit?.(code, null);
};

export function cfgFor(home: string, env: Record<string, string> = {}): ListenCfg {
  return loadCfg({ env, home });
}

/** Engine-probe options for `home` with nothing on PATH, on linux. */
export function sttFor(home: string, over: Partial<SttOpts> = {}): SttOpts {
  return { cfg: cfgFor(home), whichFn: which({}), pathEnv: undefined, platform: "linux", home, cwd: home, ...over };
}

export function plantModel(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "ggml");
}

export function reply(res: Partial<FetchResult>): FetchFn {
  return () => Promise.resolve(fetchResult(res));
}

export function jsonReply(body: Json): FetchFn {
  return reply({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

export function bytesReply(bytes: number[]): FetchFn {
  return reply({ ok: true, arrayBuffer: () => Promise.resolve(new Uint8Array(bytes)) });
}
