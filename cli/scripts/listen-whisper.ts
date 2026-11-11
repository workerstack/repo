/** Picks the speech-to-text engine (local whisper.cpp or the OpenAI API), fetches its model, and transcribes. */
import fs from "node:fs";
import path from "node:path";

import { isRecord } from "./hook-input.ts";
import {
  AUTH_RE,
  DEFAULT_GGML,
  FORBIDDEN,
  GGML_DIR_MODE,
  GGML_URL,
  HTTP_BODY_CHARS,
  NEED_AUDIO,
  NEED_GGML,
  NEED_OPENAI,
  NEED_STT,
  SETUP,
  STT_LOCAL,
  STT_OPENAI,
  TRANSCRIBE_URL,
  UNAUTHORIZED,
  USER_AGENT,
  WHISPER_BINS,
} from "./listen.constants.ts";
import type { FetchFn, FetchResult, ListenCfg, SpawnSyncFn, Stt, SttOpts, WhichFn } from "./listen.types.ts";
import { streamText } from "./stream-text.ts";
import { str } from "./voice-args.ts";

export function formatHttpError(status: number | string, body: string | undefined): string {
  const n = Number(status);
  const raw = body ?? "";
  if (n === UNAUTHORIZED || n === FORBIDDEN || AUTH_RE.test(raw)) {
    const shown = n === 0 || Number.isNaN(n) ? status : n;
    return `openai key missing or rejected (${shown}). setup: ${SETUP}`;
  }

  return `${status} ${raw.slice(0, HTTP_BODY_CHARS)}`.trim();
}

function statusOf(res: FetchResult): number | string {
  return res.status ?? "err";
}

export function findWhisperBin(whichFn: WhichFn, pathEnv: string | undefined, platform: NodeJS.Platform): string {
  for (const n of WHISPER_BINS) {
    const hit = whichFn(n, pathEnv, platform);
    if (hit !== "") return hit;
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

export function defaultGgmlPath(home: string): string {
  return path.join(home, ".workerstack", "whisper", DEFAULT_GGML);
}

/** The first ggml model that exists: the configured one, then home, then home/models, then cwd/models. */
export function findWhisperModel({ cfg, home, cwd }: { cfg: ListenCfg; home: string; cwd: string }): string {
  const names = [
    cfg.whisperModel,
    defaultGgmlPath(home),
    path.join(home, "models", DEFAULT_GGML),
    cwd === "" ? "" : path.join(cwd, "models", DEFAULT_GGML),
  ];
  const hit = names.map((p) => str(p)).find(isFile);
  return hit === undefined ? "" : path.resolve(hit);
}

/** The engine `cfg.stt` forces, or local before openai; null when the one it needs is missing. */
export function probeStt({ cfg, whichFn, pathEnv, platform, home, cwd }: SttOpts): Stt | null {
  const bin = findWhisperBin(whichFn, pathEnv, platform);
  const modelPath = findWhisperModel({ cfg, cwd, home });
  const local: Stt | null = bin !== "" && modelPath !== "" ? { bin, kind: "local", model: modelPath } : null;
  const openai: Stt | null = cfg.apiKey === "" ? null : { kind: "openai", model: cfg.model };
  if (cfg.stt === STT_LOCAL) return local;
  if (cfg.stt === STT_OPENAI) return openai;
  return local ?? openai;
}

/** `probeStt`, or an error naming what is missing. */
export function resolveStt(opts: SttOpts): Stt {
  const force = opts.cfg.stt;
  const hit = probeStt(opts);
  if (hit !== null) return hit;
  const bin = findWhisperBin(opts.whichFn, opts.pathEnv, opts.platform);
  if (force === STT_LOCAL || (bin !== "" && force !== STT_OPENAI)) throw new Error(NEED_GGML);
  if (force === STT_OPENAI) throw new Error(NEED_OPENAI);
  throw new Error(NEED_STT);
}

type GgmlOpts = {
  home: string;
  fetchFn?: FetchFn | undefined;
  log?: { error(msg: string): void } | undefined;
};

async function bodyBytes(res: FetchResult): Promise<Buffer> {
  if (typeof res.arrayBuffer !== "function") return Buffer.alloc(0);
  return Buffer.from(new Uint8Array(await res.arrayBuffer()));
}

/** Downloads the default ggml model once, through a `.part` file, and returns its path. */
export async function downloadGgml({ home, fetchFn = globalThis.fetch, log }: GgmlOpts): Promise<string> {
  const dest = defaultGgmlPath(home);
  if (isFile(dest)) return dest;
  fs.mkdirSync(path.dirname(dest), { mode: GGML_DIR_MODE, recursive: true });
  const part = `${dest}.part`;
  log?.error(`downloading ${DEFAULT_GGML} (~142MB) to ${dest}`);
  const res = await fetchFn(GGML_URL, { headers: { "User-Agent": USER_AGENT }, redirect: "follow" });
  if (res.ok !== true) throw new Error(`could not download ggml model (${statusOf(res)}). setup: ${SETUP}`);
  const buf = await bodyBytes(res);
  if (buf.length === 0) throw new Error("ggml download empty");
  fs.writeFileSync(part, buf);
  fs.renameSync(part, dest);
  return dest;
}

/** `resolveStt`, downloading the model first when whisper.cpp is there without one. */
export async function ensureStt(opts: SttOpts): Promise<Stt> {
  const bin = findWhisperBin(opts.whichFn, opts.pathEnv, opts.platform);
  let modelPath = findWhisperModel({ cfg: opts.cfg, cwd: opts.cwd, home: opts.home });
  if (opts.cfg.stt !== STT_OPENAI && bin !== "" && modelPath === "") {
    try {
      modelPath = await downloadGgml({ fetchFn: opts.fetchFn, home: opts.home, log: opts.log });
    } catch (e) {
      if (opts.cfg.stt === STT_LOCAL || opts.cfg.apiKey === "") throw e;
      return { kind: "openai", model: opts.cfg.model };
    }
  }
  const cfg = modelPath === "" ? opts.cfg : { ...opts.cfg, whisperModel: modelPath };
  return resolveStt({ ...opts, cfg });
}

/** The transcript whisper.cpp wrote next to `prefix`, removed once read; "" when it wrote none. */
function takeTxt(txt: string): string {
  if (!isFile(txt)) return "";
  const text = fs.readFileSync(txt, "utf8").trim();
  fs.rmSync(txt, { force: true });
  return text;
}

type LocalOpts = { file: string; bin: string; model: string; spawnSyncFn: SpawnSyncFn };

export function transcribeLocal({ file, bin, model, spawnSyncFn }: LocalOpts): string {
  if (!isFile(file)) throw new Error(NEED_AUDIO);
  const prefix = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.whisper`);
  const r = spawnSyncFn(bin, ["-m", model, "-f", file, "-otxt", "-of", prefix, "-np", "-nt"], { encoding: "utf8" });
  const written = takeTxt(`${prefix}.txt`);
  const text = written === "" ? str(streamText(r.stdout)) : written;
  if (text !== "") return text;
  throw new Error(str(streamText(r.stderr), "whisper-cli failed"));
}

async function bodyText(res: FetchResult): Promise<string> {
  try {
    return typeof res.text === "function" ? await res.text() : "";
  } catch {
    return "";
  }
}

async function transcribeOpenai(file: string, cfg: ListenCfg, fetchFn: FetchFn): Promise<string> {
  const fd = new FormData();
  fd.append("file", new Blob([fs.readFileSync(file)], { type: "audio/wav" }), path.basename(file));
  fd.append("model", cfg.model);
  const res = await fetchFn(TRANSCRIBE_URL, {
    body: fd,
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    method: "POST",
  });
  if (res.ok !== true) throw new Error(formatHttpError(statusOf(res), await bodyText(res)));
  const j: unknown = typeof res.json === "function" ? await res.json() : {};
  return str(isRecord(j) ? j.text : undefined, typeof j === "string" ? j : "");
}

type TranscribeOpts = { file: string; cfg: ListenCfg; stt: Stt; fetchFn: FetchFn; spawnSyncFn: SpawnSyncFn };

export async function transcribe({ file, cfg, stt, fetchFn, spawnSyncFn }: TranscribeOpts): Promise<string> {
  if (!fs.existsSync(file)) throw new Error(NEED_AUDIO);
  if (stt.kind === "local") return transcribeLocal({ bin: stt.bin, file, model: stt.model, spawnSyncFn });
  if (cfg.apiKey === "") throw new Error(NEED_STT);
  return await transcribeOpenai(file, cfg, fetchFn);
}
