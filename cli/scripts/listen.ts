#!/usr/bin/env bun
/** Speech-to-text (input only). Mic/file → OpenAI Whisper. */
import { spawn, spawnSync, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRoots } from "./workspace-root.ts";
import { loadOptionalConsumerEnv, whichBin } from "./doctor.ts";
import { isRecord } from "./hook-input.ts";
import { readEnv } from "../env.ts";
import type { Env } from "../env.ts";

export interface ListenCfg {
  filePath: string;
  apiKey: string;
  model: string;
  device: string;
  seconds: number;
  ffmpegFormat: string;
  whisperModel: string;
  stt: string;
}

export type Stt = { kind: "local"; bin: string; model: string } | { kind: "openai"; model: string };

export type WhichFn = (name: string, pathEnv?: string, platform?: NodeJS.Platform) => string;

/** The slice of a fetch Response this script reads. */
export interface FetchResult {
  ok?: boolean;
  status?: number;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
  arrayBuffer?: () => Promise<ArrayBuffer | Uint8Array>;
}

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: FormData;
  redirect?: "follow" | "manual" | "error";
}

export type FetchFn = (url: string, init: FetchInit) => Promise<FetchResult>;

export interface SpawnSyncResult {
  status: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
}

export interface SpawnSyncOpts {
  encoding?: "utf8";
  input?: string;
  shell?: boolean;
  timeout?: number;
}

export type SpawnSyncFn = (bin: string, args: string[], opts: SpawnSyncOpts) => SpawnSyncResult;

/** The slice of a ChildProcess this script uses; tests pass partial fakes. */
export interface ChildLike {
  pid?: number | undefined;
  stdin?: { write(chunk: string): unknown; end(): unknown } | null;
  kill?(signal?: NodeJS.Signals): unknown;
  on?(event: string, cb: (arg: unknown, signal?: unknown) => void): unknown;
  unref?(): void;
}

export interface SpawnOpts {
  detached?: boolean;
  stdio?: unknown[];
  cwd?: string | undefined;
  env?: Env;
  windowsHide?: boolean;
}

export type SpawnFn = (bin: string, args: string[], opts: SpawnOpts) => ChildLike;

function nodeSpawn(bin: string, args: string[], opts: SpawnOpts): ChildLike {
  return spawn(bin, args, opts as SpawnOptions);
}

export type KillFn = (pid: number, signal: string | number) => unknown;

export interface ListenLog {
  log(msg: string): void;
  error(msg: string): void;
}

export interface ParsedArgv {
  _: string[];
  flags: Record<string, string>;
}

export interface SttOpts {
  cfg: ListenCfg;
  whichFn: WhichFn;
  pathEnv: string | undefined;
  platform: NodeJS.Platform;
  home: string;
  cwd: string;
  fetchFn?: FetchFn | undefined;
  log?: ListenLog | undefined;
}

export interface AudioDevice {
  id: string;
  name: string;
}

export interface CaptureResult {
  status: number | null;
  signal: string | null;
  stderr: string;
  error: unknown;
}

export interface ListenMainOpts {
  env?: Env;
  home?: string | undefined;
  cwd?: string | undefined;
  platform?: NodeJS.Platform;
  fetchFn?: FetchFn | undefined;
  spawnFn?: SpawnFn;
  spawnSyncFn?: SpawnSyncFn;
  killFn?: KillFn;
  whichFn?: WhichFn;
  log?: ListenLog | undefined;
  pathEnv?: string;
  nodeBin?: string;
  waitPid?: (pid: number, killFn: KillFn) => void;
}

function errMessage(e: unknown): string {
  const m = isRecord(e) ? e.message : undefined;
  return String(m || e);
}

export const DEFAULT_MODEL = "whisper-1";
export const DEFAULT_GGML = "ggml-base.en.bin";
export const WHISPER_BINS: string[] = ["whisper-cli", "whisper-cpp"];
export const DEFAULT_SECONDS = 8;
export const MAX_SECONDS = 120;
export const USAGE =
  "usage: listen whoami | devices | rec [--seconds N] [--device D] [--clip] | start [--device D] | stop [--clip] | toggle [--clip] | status | file --path P [--clip] | latest";
export const SETUP = "bun repo setup listen";
export const LISTEN_DIR = ".tmp/repo/listen";
export const NEED_STT =
  "missing whisper-cli (mac: brew install whisper-cpp) or OPENAI_API_KEY / ~/.workerstack/speak.json openai.apiKey. setup: bun repo setup listen";
export const NEED_FFMPEG =
  "missing ffmpeg. mac: brew install ffmpeg · linux: sudo apt install ffmpeg · win: winget install Gyan.FFmpeg. setup: bun repo setup listen";
export const NEED_OPENAI =
  "missing OPENAI_API_KEY (or ~/.workerstack/speak.json openai.apiKey). setup: bun repo setup listen";
export const NEED_GGML =
  "whisper-cli found but no ggml model (auto-download failed). set WHISPER_MODEL or retry. setup: bun repo setup listen";

export function formatHttpError(status: unknown, body: unknown): string {
  const n = Number(status);
  const raw = String(body || "");
  const auth = n === 401 || n === 403 || /unauthorized|invalid.?api.?key|authentication|missing_permissions/i.test(raw);
  if (auth) {
    return `openai key missing or rejected (${n || status}). setup: ${SETUP}`;
  }
  return `${status} ${raw.slice(0, 200)}`.trim();
}
export const GGML_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";

export function parseArgv(argv: unknown): ParsedArgv {
  const out: ParsedArgv = { _: [], flags: {} };
  const args: string[] = Array.isArray(argv) ? argv.filter((a): a is string => typeof a === "string") : [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!; // i < args.length
    if (a === "--") {
      out._.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const nxt = args[i + 1];
      if (nxt && !nxt.startsWith("--")) {
        out.flags[key] = nxt;
        i += 1;
      } else out.flags[key] = "1";
    } else out._.push(a);
  }
  return out;
}

function readJson(p: string): Record<string, unknown> {
  try {
    const j: unknown = JSON.parse(fs.readFileSync(p, "utf8"));
    if (isRecord(j)) return j;
  } catch {
    /* none */
  }
  return {};
}

function str(v: unknown, fallback = ""): string {
  const s = String(v ?? "").trim();
  return s || fallback;
}

export function clampSeconds(v: unknown, fallback: number = DEFAULT_SECONDS): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_SECONDS, Math.max(1, Math.round(n)));
}

export function loadCfg({ env, home }: { env: Env; home: string }): ListenCfg {
  const filePath = path.join(home, ".workerstack", "speak.json");
  const file = readJson(filePath);
  const openai = isRecord(file.openai) ? file.openai : {};
  const listen = isRecord(file.listen) ? file.listen : {};
  return {
    filePath,
    apiKey: str(env.OPENAI_API_KEY || openai.apiKey),
    model: str(env.LISTEN_MODEL || listen.model, DEFAULT_MODEL),
    device: str(env.LISTEN_DEVICE || listen.device),
    seconds: clampSeconds(env.LISTEN_SECONDS || listen.seconds, DEFAULT_SECONDS),
    ffmpegFormat: str(env.LISTEN_FFMPEG_FORMAT || listen.format).toLowerCase(),
    whisperModel: str(env.WHISPER_MODEL || env.LISTEN_WHISPER_MODEL || listen.whisperModel),
    stt: str(env.LISTEN_STT || listen.stt, "auto").toLowerCase(),
  };
}

export function findWhisperBin(whichFn: WhichFn, pathEnv: string | undefined, platform: NodeJS.Platform): string {
  for (const n of WHISPER_BINS) {
    const hit = whichFn(n, pathEnv, platform);
    if (hit) return hit;
  }
  return "";
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function findWhisperModel({ cfg, home, cwd }: { cfg: ListenCfg; home: string; cwd: string }): string {
  const names = [
    cfg.whisperModel,
    path.join(home, ".workerstack", "whisper", DEFAULT_GGML),
    path.join(home, "models", DEFAULT_GGML),
    cwd ? path.join(cwd, "models", DEFAULT_GGML) : "",
  ];
  for (const p of names) {
    const s = str(p);
    if (isFile(s)) return path.resolve(s);
  }
  return "";
}

export function probeStt({ cfg, whichFn, pathEnv, platform, home, cwd }: SttOpts): Stt | null {
  const force = cfg.stt;
  const bin = findWhisperBin(whichFn, pathEnv, platform);
  const modelPath = findWhisperModel({ cfg, home, cwd });
  const local: Stt | null = bin && modelPath ? { kind: "local", bin, model: modelPath } : null;
  const openai: Stt | null = cfg.apiKey ? { kind: "openai", model: cfg.model } : null;
  if (force === "local") return local;
  if (force === "openai") return openai;
  return local || openai;
}

export function resolveStt(opts: SttOpts): Stt {
  const force = opts.cfg.stt;
  const hit = probeStt(opts);
  if (hit) return hit;
  const bin = findWhisperBin(opts.whichFn, opts.pathEnv, opts.platform);
  if (force === "local" || (bin && force !== "openai")) {
    throw new Error(NEED_GGML);
  }
  if (force === "openai") throw new Error(NEED_OPENAI);
  throw new Error(NEED_STT);
}

export function defaultGgmlPath(home: string): string {
  return path.join(home, ".workerstack", "whisper", DEFAULT_GGML);
}

type GgmlOpts = {
  home: string;
  fetchFn?: FetchFn | undefined;
  log?: { error(msg: string): void } | undefined;
};

export async function downloadGgml({ home, fetchFn = globalThis.fetch, log }: GgmlOpts): Promise<string> {
  const dest = defaultGgmlPath(home);
  if (isFile(dest)) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  const part = `${dest}.part`;
  log?.error(`downloading ${DEFAULT_GGML} (~142MB) to ${dest}`);
  const res = await fetchFn(GGML_URL, {
    headers: { "User-Agent": "repo-listen" },
    redirect: "follow",
  });
  if (!res.ok) {
    const status = res.status != null ? res.status : "err";
    throw new Error(`could not download ggml model (${status}). setup: ${SETUP}`);
  }
  const buf =
    typeof res.arrayBuffer === "function" ? Buffer.from(new Uint8Array(await res.arrayBuffer())) : Buffer.alloc(0);
  if (!buf.length) throw new Error("ggml download empty");
  fs.writeFileSync(part, buf);
  fs.renameSync(part, dest);
  return dest;
}

export async function ensureStt(opts: SttOpts): Promise<Stt> {
  const force = opts.cfg.stt;
  const bin = findWhisperBin(opts.whichFn, opts.pathEnv, opts.platform);
  let modelPath = findWhisperModel({
    cfg: opts.cfg,
    home: opts.home,
    cwd: opts.cwd,
  });
  if (force !== "openai" && bin && !modelPath) {
    try {
      modelPath = await downloadGgml({
        home: opts.home,
        fetchFn: opts.fetchFn,
        log: opts.log,
      });
    } catch (e) {
      if (force === "local" || !opts.cfg.apiKey) throw e;
      return { kind: "openai", model: opts.cfg.model };
    }
  }
  const cfg = modelPath ? { ...opts.cfg, whisperModel: modelPath } : opts.cfg;
  return resolveStt({ ...opts, cfg });
}

export function listenDir(cwd: string): string {
  const d = path.join(resolveRoots({}, { cwd }).root, LISTEN_DIR);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function sessionPath(cwd: string): string {
  return path.join(listenDir(cwd), "session.json");
}

export function latestPath(cwd: string): string {
  return path.join(listenDir(cwd), "latest.txt");
}

export function defaultDevice(platform: NodeJS.Platform): string {
  if (platform === "darwin") return ":0";
  if (platform === "win32") return "";
  return "default";
}

export function darwinAudioSpec(device: unknown): string {
  const d = str(device, ":0");
  if (/^none:/i.test(d)) return `:${d.slice(5)}`;
  if (d.startsWith(":")) return d;
  if (/^\d+$/.test(d)) return `:${d}`;
  return d.includes(":") ? d : `:${d}`;
}

export function ffmpegInputArgs(platform: NodeJS.Platform, device: unknown, ffmpegFormat: string): string[] {
  const d = str(device, defaultDevice(platform));
  if (platform === "darwin") {
    return ["-f", "avfoundation", "-i", darwinAudioSpec(d)];
  }
  if (platform === "win32") {
    if (!d) {
      throw new Error("missing --device or LISTEN_DEVICE. run: bun repo listen devices. setup: bun repo setup listen");
    }
    const spec = d.startsWith("audio=") ? d : `audio=${d}`;
    return ["-f", "dshow", "-i", spec];
  }
  const fmt = ffmpegFormat || (d.startsWith("hw:") ? "alsa" : "pulse");
  return ["-f", fmt, "-i", d];
}

export function ffmpegRecordArgs({
  platform,
  device,
  out,
  seconds,
  ffmpegFormat,
}: {
  platform: NodeJS.Platform;
  device: unknown;
  out: string;
  seconds: number | undefined;
  ffmpegFormat: string;
}): string[] {
  const t = seconds ? ["-t", String(clampSeconds(seconds))] : [];
  const noIn = seconds ? ["-nostdin"] : [];
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    ...noIn,
    ...ffmpegInputArgs(platform, device, ffmpegFormat),
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    ...t,
    "-y",
    out,
  ];
}

export function recCaptureOpts(errFd?: number | null): {
  detached: true;
  stdio: (string | number)[];
  windowsHide: true;
} {
  return {
    detached: true,
    stdio: ["ignore", "ignore", errFd == null ? "ignore" : errFd],
    windowsHide: true,
  };
}

export function recCapture({
  bin,
  args,
  seconds,
  spawnFn,
  killFn,
  errFd,
}: {
  bin: string;
  args: string[];
  seconds: unknown;
  spawnFn: SpawnFn;
  killFn: KillFn;
  errFd: number | null;
}): Promise<CaptureResult> {
  const s = clampSeconds(seconds);
  return new Promise<CaptureResult>((resolve) => {
    const child = spawnFn(bin, args, recCaptureOpts(errFd));
    let done = false;
    const finish = (status: number | null, signal: string | null, error: unknown): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ status, signal, stderr: "", error });
    };
    const timer = setTimeout(
      () => {
        try {
          if (child.pid) killFn(-child.pid, "SIGKILL");
        } catch {
          try {
            child.kill?.("SIGKILL");
          } catch {
            /* none */
          }
        }
        finish(null, "SIGKILL", { code: "ETIMEDOUT" });
      },
      (s + 2) * 1000,
    );
    if (typeof child.on === "function") {
      child.on("error", (error: unknown) => finish(null, null, error));
      child.on("exit", (code: unknown, signal: unknown) =>
        finish(typeof code === "number" ? code : null, typeof signal === "string" ? signal : null, null),
      );
    } else {
      finish(0, null, null);
    }
  });
}

export function parseDevices(text: unknown, platform: NodeJS.Platform): AudioDevice[] {
  const lines = String(text || "").split(/\r?\n/);
  const out: AudioDevice[] = [];
  if (platform === "darwin") {
    let audio = false;
    for (const line of lines) {
      if (/AVFoundation audio devices/i.test(line) || /audio devices:\s*$/i.test(line)) {
        audio = true;
        continue;
      }
      if (/video devices/i.test(line)) {
        audio = false;
        continue;
      }
      if (!audio) continue;
      const m = line.match(/\[(\d+)\]\s+(.+)$/);
      if (m) out.push({ id: `:${m[1]}`, name: m[2]!.trim() }); // both regex groups are mandatory
    }
    return out;
  }
  if (platform === "win32") {
    let audio = false;
    for (const line of lines) {
      if (/DirectShow audio devices/i.test(line)) {
        audio = true;
        continue;
      }
      if (/DirectShow video devices/i.test(line)) {
        audio = false;
        continue;
      }
      if (!audio) continue;
      const m = line.match(/"([^"]+)"/);
      if (m) out.push({ id: m[1]!, name: m[1]! }); // the group is mandatory
    }
    return out;
  }
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\s+(\S+)/);
    if (m) out.push({ id: m[2]!, name: m[2]! }); // both groups are mandatory
  }
  if (!out.length) out.push({ id: "default", name: "pulse default" });
  return out;
}

function readSession(cwd: string): Record<string, unknown> {
  return readJson(sessionPath(cwd));
}

function writeSession(cwd: string, obj: Record<string, unknown>): void {
  fs.writeFileSync(sessionPath(cwd), JSON.stringify(obj, null, 2) + "\n");
}

function clearSession(cwd: string): void {
  fs.rmSync(sessionPath(cwd), { force: true });
}

export function pidAlive(pid: unknown, killFn: KillFn): boolean {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    killFn(n, 0);
    return true;
  } catch {
    return false;
  }
}

function needFfmpeg(bin: string | undefined): string {
  if (!bin) {
    throw new Error(NEED_FFMPEG);
  }
  return bin;
}

export function transcribeLocal({
  file,
  bin,
  model,
  spawnSyncFn,
}: {
  file: string;
  bin: string;
  model: string;
  spawnSyncFn: SpawnSyncFn;
}): string {
  if (!isFile(file)) throw new Error("transcribe needs an audio file");
  const prefix = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.whisper`);
  const txt = `${prefix}.txt`;
  const r = spawnSyncFn(bin, ["-m", model, "-f", file, "-otxt", "-of", prefix, "-np", "-nt"], { encoding: "utf8" });
  let text = "";
  if (isFile(txt)) {
    text = fs.readFileSync(txt, "utf8").trim();
    fs.rmSync(txt, { force: true });
  }
  if (!text) text = str(r.stdout);
  if (text) return text;
  throw new Error(str(r.stderr, "whisper-cli failed"));
}

export async function transcribe({
  file,
  cfg,
  stt,
  fetchFn,
  spawnSyncFn,
}: {
  file: string;
  cfg: ListenCfg;
  stt: Stt;
  fetchFn: FetchFn;
  spawnSyncFn: SpawnSyncFn;
}): Promise<string> {
  if (!fs.existsSync(file)) throw new Error("transcribe needs an audio file");
  if (stt.kind === "local") {
    return transcribeLocal({ file, bin: stt.bin, model: stt.model, spawnSyncFn });
  }
  if (!cfg.apiKey) throw new Error(NEED_STT);
  const buf = fs.readFileSync(file);
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "audio/wav" }), path.basename(file));
  fd.append("model", cfg.model);
  const res = await fetchFn(TRANSCRIBE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: fd,
  });
  if (!res.ok) {
    let t = "";
    try {
      t = typeof res.text === "function" ? await res.text() : "";
    } catch {
      /* none */
    }
    const status = res.status != null ? res.status : "err";
    throw new Error(formatHttpError(status, t));
  }
  const j: unknown = typeof res.json === "function" ? await res.json() : {};
  return str(isRecord(j) ? j.text : undefined, typeof j === "string" ? j : "");
}

export function copyClip(
  body: string,
  { platform, spawnSyncFn }: { platform: NodeJS.Platform; spawnSyncFn: SpawnSyncFn },
): void {
  if (platform === "darwin") {
    const r = spawnSyncFn("pbcopy", [], { input: body, encoding: "utf8" });
    if (r.status !== 0) throw new Error("pbcopy failed");
    return;
  }
  if (platform === "win32") {
    const r = spawnSyncFn("clip", [], { input: body, encoding: "utf8", shell: true });
    if (r.status !== 0) throw new Error("clip failed");
    return;
  }
  const sinks: [string, string[]][] = [
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard"]],
    ["xsel", ["--clipboard", "--input"]],
  ];
  for (const [bin, args] of sinks) {
    const r = spawnSyncFn(bin, args, { input: body, encoding: "utf8" });
    if (r.status === 0) return;
  }
  throw new Error("no wl-copy, xclip, or xsel on PATH");
}

function saveLatest(cwd: string, text: string): string {
  const p = latestPath(cwd);
  fs.writeFileSync(p, `${text}\n`); // a transcript is trimmed, so it never ends in a newline
  return p;
}

async function finishTranscript({
  wav,
  cfg,
  cwd,
  clip,
  fetchFn,
  platform,
  spawnSyncFn,
  stt,
  log,
}: {
  wav: string;
  cfg: ListenCfg;
  cwd: string;
  clip: boolean;
  fetchFn: FetchFn;
  platform: NodeJS.Platform;
  spawnSyncFn: SpawnSyncFn;
  stt: Stt;
  log: ListenLog;
}): Promise<string> {
  const text = await transcribe({ file: wav, cfg, stt, fetchFn, spawnSyncFn });
  const latest = saveLatest(cwd, text);
  if (clip) copyClip(text, { platform, spawnSyncFn });
  log.log(text);
  const rel = path.relative(cwd, latest).replace(/\\/g, "/");
  log.log(`transcript=${rel.startsWith("..") ? latest : rel}`);
  return text;
}

export function listDevicesText({
  platform,
  ffmpegBin,
  spawnSyncFn,
}: {
  platform: NodeJS.Platform;
  ffmpegBin: string | undefined;
  spawnSyncFn: SpawnSyncFn;
}): AudioDevice[] {
  const ffmpeg = needFfmpeg(ffmpegBin);
  if (platform === "darwin") {
    const r = spawnSyncFn(ffmpeg, ["-f", "avfoundation", "-list_devices", "true", "-i", ""], {
      encoding: "utf8",
    });
    return parseDevices(`${r.stderr || ""}\n${r.stdout || ""}`, "darwin");
  }
  if (platform === "win32") {
    const r = spawnSyncFn(ffmpeg, ["-list_devices", "true", "-f", "dshow", "-i", "dummy"], { encoding: "utf8" });
    return parseDevices(`${r.stderr || ""}\n${r.stdout || ""}`, "win32");
  }
  const pactl = spawnSyncFn("pactl", ["list", "short", "sources"], { encoding: "utf8" });
  if (pactl.status === 0 && str(pactl.stdout)) {
    return parseDevices(pactl.stdout, "linux");
  }
  return parseDevices("", "linux");
}

function waitPidExit(pid: number, killFn: KillFn): void {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (!pidAlive(pid, killFn)) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); // sleep 50ms
  }
}

export async function main(argv: string[], opts: ListenMainOpts = {}): Promise<number> {
  const { _, flags } = parseArgv(argv);
  if (!opts.env) await loadOptionalConsumerEnv();
  const env = opts.env || readEnv();
  const home = opts.home || str(env.HOME || env.USERPROFILE, os.homedir());
  const cwd = str(flags.cwd || opts.cwd, process.cwd());
  const platform = opts.platform || process.platform;
  const fetchFn: FetchFn = opts.fetchFn || globalThis.fetch;
  const spawnFn: SpawnFn = opts.spawnFn || nodeSpawn;
  const spawnSyncFn: SpawnSyncFn = opts.spawnSyncFn || spawnSync;
  const killFn: KillFn = opts.killFn || process.kill;
  const whichFn: WhichFn = opts.whichFn || whichBin;
  const log: ListenLog = opts.log || console;
  const pathEnv = opts.pathEnv || env.PATH || readEnv().PATH;
  const ffmpegBin = whichFn("ffmpeg", pathEnv, platform);
  const nodeBin = opts.nodeBin || process.execPath;
  const cfg = loadCfg({ env, home });
  const device = str(flags.device, cfg.device);
  const clip = flags.clip === "1" || flags.clip === "true";
  const verb = String(_[0] || "").toLowerCase();
  const sttOpts: SttOpts = { cfg, whichFn, pathEnv, platform, home, cwd, fetchFn, log };

  try {
    if (verb === "whoami") {
      const ff = ffmpegBin || "missing";
      let stt: Stt | null;
      try {
        stt = await ensureStt(sttOpts);
      } catch {
        stt = probeStt(sttOpts);
      }
      if (!stt) {
        log.log(`stt=none  ffmpeg=${ff}`);
        log.error(NEED_STT);
        return 1;
      }
      if (stt.kind === "local") {
        log.log(`stt=local  bin=${stt.bin}  model=${stt.model}  ffmpeg=${ff}`);
        return 0;
      }
      log.log(`stt=openai  model=${stt.model}  ffmpeg=${ff}`);
      return 0;
    }
    if (verb === "devices") {
      const list = listDevicesText({ platform, ffmpegBin, spawnSyncFn });
      if (!list.length) log.log("no audio devices");
      else for (const d of list) log.log(`${d.id}  ${d.name}`);
      return 0;
    }
    if (verb === "latest") {
      const p = latestPath(cwd);
      if (!fs.existsSync(p)) {
        log.error("no transcript");
        return 1;
      }
      log.log(fs.readFileSync(p, "utf8").trimEnd());
      return 0;
    }
    if (verb === "status") {
      const s = readSession(cwd);
      if (!s.pid) {
        log.log("idle");
        return 0;
      }
      const alive = pidAlive(s.pid, killFn);
      log.log(`${alive ? "recording" : "stale"}  pid=${String(s.pid)}  wav=${String(s.wav || "-")}`);
      if (!alive) clearSession(cwd);
      return 0;
    }
    if (verb === "file") {
      const file = str(flags.path || flags.file || flags.out || _[1]);
      if (!file) throw new Error("file needs --path");
      await finishTranscript({
        wav: file,
        cfg,
        cwd,
        clip,
        fetchFn,
        platform,
        spawnSyncFn,
        stt: await ensureStt(sttOpts),
        log,
      });
      return 0;
    }
    if (verb === "_record") {
      const out = str(flags.out);
      if (!out) throw new Error("_record needs --out");
      const ffmpeg = needFfmpeg(ffmpegBin);
      const seconds = flags.seconds ? clampSeconds(flags.seconds) : 0;
      const args = ffmpegRecordArgs({
        platform,
        device,
        out,
        seconds: seconds || undefined,
        ffmpegFormat: cfg.ffmpegFormat,
      });
      fs.mkdirSync(path.dirname(out), { recursive: true });
      writeSession(cwd, { pid: process.pid, wav: out, started: Date.now() });
      const child = spawnFn(ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"] });
      const stop = () => {
        try {
          if (child.stdin) child.stdin.write("q\n");
        } catch {
          /* none */
        }
        try {
          if (child.stdin) child.stdin.end();
        } catch {
          /* none */
        }
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      const code = await new Promise<number>((resolve, reject) => {
        child.on?.("error", reject);
        child.on?.("exit", (c: unknown) => resolve(typeof c === "number" ? c : 0));
      });
      return code && code !== 255 ? 1 : 0;
    }
    if (verb === "start") {
      needFfmpeg(ffmpegBin);
      const cur = readSession(cwd);
      if (cur.pid && pidAlive(cur.pid, killFn)) {
        log.error(`already recording pid=${String(cur.pid)}`);
        return 1;
      }
      const wav = path.join(listenDir(cwd), `rec-${Date.now()}.wav`);
      const child = spawnFn(
        nodeBin,
        [
          fileURLToPath(new URL("../../bin/repo.ts", import.meta.url)),
          "listen",
          "_record",
          "--out",
          wav,
          ...(device ? ["--device", device] : []),
          "--cwd",
          cwd,
        ],
        {
          detached: true,
          stdio: ["ignore", "ignore", "ignore"], // same as "ignore"
          cwd,
          env,
          windowsHide: true,
        },
      );
      if (typeof child.unref === "function") child.unref();
      writeSession(cwd, { pid: child.pid, wav, started: Date.now() });
      log.log(`recording pid=${child.pid}\n${wav}`);
      return 0;
    }
    if (verb === "stop") {
      const s = readSession(cwd);
      if (!s.pid) throw new Error("not recording");
      const sessionPid = Number(s.pid);
      if (pidAlive(sessionPid, killFn)) {
        try {
          killFn(sessionPid, "SIGINT");
        } catch {
          /* none */
        }
        if (typeof opts.waitPid === "function") opts.waitPid(sessionPid, killFn);
        else waitPidExit(sessionPid, killFn);
      }
      clearSession(cwd);
      const wav = str(s.wav);
      if (!wav || !fs.existsSync(wav)) throw new Error("no wav from session");
      await finishTranscript({
        wav,
        cfg,
        cwd,
        clip,
        fetchFn,
        platform,
        spawnSyncFn,
        stt: await ensureStt(sttOpts),
        log,
      });
      return 0;
    }
    if (verb === "toggle") {
      const s = readSession(cwd);
      if (s.pid && pidAlive(s.pid, killFn)) {
        return main(["stop", ...(clip ? ["--clip"] : []), ...(flags.cwd ? ["--cwd", cwd] : [])], opts);
      }
      return main(["start", ...(device ? ["--device", device] : []), ...(flags.cwd ? ["--cwd", cwd] : [])], opts);
    }
    if (verb === "rec") {
      const ffmpeg = needFfmpeg(ffmpegBin);
      const stt = await ensureStt(sttOpts);
      const seconds = clampSeconds(flags.seconds || cfg.seconds);
      const wav = str(flags.out) || path.join(listenDir(cwd), `rec-${Date.now()}.wav`);
      const args = ffmpegRecordArgs({
        platform,
        device,
        out: wav,
        seconds,
        ffmpegFormat: cfg.ffmpegFormat,
      });
      log.error(`recording ${seconds}s on ${args[args.indexOf("-i") + 1]}…`);
      const ffLog = path.join(listenDir(cwd), "ffmpeg.log");
      const errFd = fs.openSync(ffLog, "w");
      let r: CaptureResult;
      try {
        r = await recCapture({
          bin: ffmpeg,
          args,
          seconds,
          spawnFn,
          killFn,
          errFd,
        });
      } finally {
        fs.closeSync(errFd);
      }
      const ffErr = str(fs.readFileSync(ffLog, "utf8")).slice(0, 400);
      if (isRecord(r.error) && r.error.code === "ETIMEDOUT") {
        throw new Error(str(ffErr, "ffmpeg rec timed out"));
      }
      if (r.status !== 0 && !fs.existsSync(wav)) {
        throw new Error(str(ffErr, "ffmpeg rec failed"));
      }
      if (!fs.existsSync(wav)) throw new Error("ffmpeg wrote no wav");
      log.error("transcribing…");
      await finishTranscript({
        wav,
        cfg,
        cwd,
        clip,
        fetchFn,
        platform,
        spawnSyncFn,
        stt,
        log,
      });
      return 0;
    }
    log.error(USAGE);
    return 1;
  } catch (e) {
    log.error(errMessage(e));
    return 1;
  }
}
