#!/usr/bin/env bun
/** Text-to-speech (output only). Providers: elevenlabs, openai. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveRoots } from "./workspace-root.ts";
import { loadOptionalConsumerEnv } from "./doctor.ts";
import { isRecord } from "./hook-input.ts";

export type Provider = "elevenlabs" | "openai";

export interface SpeakCfg {
  filePath: string;
  providerPref: string;
  elevenlabs: { apiKey: string; voiceId: string; modelId: string };
  openai: { apiKey: string; voice: string; model: string };
}

/** The slice of a fetch Response this script reads. */
export interface FetchResult {
  ok?: boolean;
  status?: number;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
  arrayBuffer?: () => Promise<ArrayBuffer | Uint8Array>;
  body?: unknown;
}

export interface FetchInit {
  method?: string | undefined;
  headers?: Record<string, string> | undefined;
  body?: string | undefined;
}

export type FetchFn = (url: string, init: FetchInit) => Promise<FetchResult>;

export interface ParsedArgv {
  _: string[];
  flags: Record<string, string>;
}

export interface SpeakLog {
  log(msg: string): void;
  error(msg: string): void;
}

export interface SpeakMainOpts {
  env?: NodeJS.ProcessEnv | undefined;
  home?: string | undefined;
  cwd?: string | undefined;
  fetchFn?: FetchFn | undefined;
  log?: SpeakLog | undefined;
}

interface ProviderOpts {
  provider?: string | undefined;
  cfg: SpeakCfg;
  fetchFn?: FetchFn | undefined;
}

export interface SayOpts extends ProviderOpts {
  text?: string | undefined;
  voice?: string | undefined;
  out?: string | undefined;
  play?: boolean | string | undefined;
  cwd?: string | undefined;
}

export const DEFAULT_ELEVEN_VOICE = "JBFqnCBsd6RMkjVDRZzb";
export const DEFAULT_ELEVEN_MODEL = "eleven_multilingual_v2";
export const DEFAULT_OPENAI_VOICE = "coral";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini-tts";
export const OPENAI_VOICES: string[] = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
];
export const USAGE =
  "usage: speak whoami | voices | say --text T [--provider elevenlabs|openai] [--voice ID] [--out path] [--play]";
const ELEVEN_API = "https://api.elevenlabs.io/v1";
const OPENAI_API = "https://api.openai.com/v1";
export const SETUP = "bun repo setup speak";
export const SPEAK_DIR = ".tmp/repo/speak";
export const NEED_KEY =
  "missing ELEVENLABS_API_KEY or OPENAI_API_KEY (or ~/.workerstack/speak.json). setup: bun repo setup speak";
export const NEED_ELEVEN =
  "missing ELEVENLABS_API_KEY (or ~/.workerstack/speak.json elevenlabs.apiKey). setup: bun repo setup speak";
export const NEED_OPENAI =
  "missing OPENAI_API_KEY (or ~/.workerstack/speak.json openai.apiKey). setup: bun repo setup speak";

export function formatHttpError(status: unknown, body: unknown, provider: string): string {
  const n = Number(status);
  const raw = String(body || "");
  if (/missing_permissions/i.test(raw)) {
    return `${provider} key present but missing permission (${n || status}). setup: ${SETUP}`;
  }
  const auth = n === 401 || n === 403 || /unauthorized|invalid.?api.?key|authentication/i.test(raw);
  if (auth) {
    return `${provider} key missing or rejected (${n || status}). setup: ${SETUP}`;
  }
  return `${status} ${raw.slice(0, 200)}`.trim();
}

export function parseArgv(argv: unknown): ParsedArgv {
  const out: ParsedArgv = { _: [], flags: {} };
  const args: string[] = Array.isArray(argv) ? argv.filter((a): a is string => typeof a === "string") : [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!; // i < args.length
    if (a === "--") {
      out._.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--") && a.length > 2) {
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

export function loadCfg({
  env = process.env,
  home = os.homedir(),
}: { env?: NodeJS.ProcessEnv; home?: string } = {}): SpeakCfg {
  const filePath = path.join(home, ".workerstack", "speak.json");
  const file = readJson(filePath);
  const eleven = isRecord(file.elevenlabs) ? file.elevenlabs : {};
  const openai = isRecord(file.openai) ? file.openai : {};
  return {
    filePath,
    providerPref: str(env.SPEAK_PROVIDER || file.provider).toLowerCase(),
    elevenlabs: {
      apiKey: str(env.ELEVENLABS_API_KEY || eleven.apiKey || file.apiKey),
      voiceId: str(env.ELEVENLABS_VOICE_ID || eleven.voiceId || file.voiceId, DEFAULT_ELEVEN_VOICE),
      modelId: str(env.ELEVENLABS_MODEL_ID || eleven.modelId || file.modelId, DEFAULT_ELEVEN_MODEL),
    },
    openai: {
      apiKey: str(env.OPENAI_API_KEY || openai.apiKey),
      voice: str(env.OPENAI_TTS_VOICE || openai.voice, DEFAULT_OPENAI_VOICE),
      model: str(env.OPENAI_TTS_MODEL || openai.model, DEFAULT_OPENAI_MODEL),
    },
  };
}

export function resolveProvider(cfg: SpeakCfg | null | undefined, flagProvider?: string): Provider {
  const want = str(flagProvider || (cfg && cfg.providerPref)).toLowerCase();
  if (want && want !== "elevenlabs" && want !== "openai") {
    throw new Error("provider must be elevenlabs or openai");
  }
  if (want === "elevenlabs") {
    if (!cfg?.elevenlabs?.apiKey) throw new Error(NEED_ELEVEN);
    return "elevenlabs";
  }
  if (want === "openai") {
    if (!cfg?.openai?.apiKey) throw new Error(NEED_OPENAI);
    return "openai";
  }
  if (cfg?.elevenlabs?.apiKey) return "elevenlabs";
  if (cfg?.openai?.apiKey) return "openai";
  throw new Error(NEED_KEY);
}

interface ApiOpts {
  method?: string | undefined;
  headers?: Record<string, string> | undefined;
  body?: Record<string, unknown> | undefined;
  raw?: boolean | undefined;
  fetchFn?: FetchFn | undefined;
}

async function apiFetch(url: string, opts: ApiOpts & { raw: true }): Promise<Buffer>;
async function apiFetch(url: string, opts?: ApiOpts): Promise<unknown>;
async function apiFetch(url: string, { method = "GET", headers, body, raw, fetchFn }: ApiOpts = {}): Promise<unknown> {
  // The global fetch returns a full Response, which carries every FetchResult field.
  const fn: FetchFn | undefined = fetchFn || (globalThis.fetch as FetchFn | undefined);
  if (typeof fn !== "function") throw new Error("fetch is not available");
  const res = await fn(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res || !res.ok) {
    const status = res && res.status != null ? res.status : "err";
    let t = "";
    try {
      t = res && typeof res.text === "function" ? await res.text() : "";
    } catch {
      /* none */
    }
    const provider = String(url || "").includes("elevenlabs") ? "elevenlabs" : "openai";
    throw new Error(formatHttpError(status, t, provider));
  }
  if (raw) {
    if (typeof res.arrayBuffer === "function") {
      const ab = await res.arrayBuffer();
      return ab instanceof Uint8Array ? Buffer.from(ab) : Buffer.from(ab);
    }
    if (Buffer.isBuffer(res.body)) return res.body;
    return Buffer.from(Array.isArray(res.body) ? (res.body as number[]) : []);
  }
  if (typeof res.json === "function") return res.json();
  return {};
}

export async function whoami({ provider, cfg, fetchFn }: ProviderOpts): Promise<string> {
  const p = resolveProvider(cfg, provider);
  if (p === "elevenlabs") {
    try {
      const u = await apiFetch(`${ELEVEN_API}/user`, {
        headers: { "xi-api-key": cfg.elevenlabs.apiKey },
        fetchFn,
      });
      const user = isRecord(u) ? u : {};
      const email = user.email ? String(user.email) : "ok";
      const tier = isRecord(user.subscription) && user.subscription.tier ? String(user.subscription.tier) : "-";
      return `elevenlabs  ${email}  tier=${tier}`;
    } catch (e) {
      const msg = errMessage(e);
      if (/missing permission/i.test(msg)) {
        return "elevenlabs  ok (scoped key; whoami needs user_read). voices/say still work";
      }
      throw e;
    }
  }
  await apiFetch(`${OPENAI_API}/models`, {
    headers: { Authorization: `Bearer ${cfg.openai.apiKey}` },
    fetchFn,
  });
  return "openai ok";
}

export async function voices({ provider, cfg, fetchFn }: ProviderOpts): Promise<string> {
  const p = resolveProvider(cfg, provider);
  if (p === "openai") return OPENAI_VOICES.join("\n");
  const j = await apiFetch(`${ELEVEN_API}/voices`, {
    headers: { "xi-api-key": cfg.elevenlabs.apiKey },
    fetchFn,
  });
  const list: unknown[] = isRecord(j) && Array.isArray(j.voices) ? j.voices : [];
  return list.map((v) => (isRecord(v) ? `${v.voice_id}  ${v.name}` : "undefined  undefined")).join("\n");
}

function errMessage(e: unknown): string {
  const m = isRecord(e) ? e.message : undefined;
  return String(m || e);
}

function playPath(dest: string): void {
  const bin = process.platform === "darwin" ? "afplay" : "ffplay";
  const args = process.platform === "darwin" ? [dest] : ["-nodisp", "-autoexit", dest];
  spawnSync(bin, args, { stdio: "ignore" });
}

export async function say({
  text,
  voice,
  out,
  play,
  provider,
  cfg,
  cwd = process.cwd(),
  fetchFn,
}: SayOpts): Promise<string> {
  if (!str(text)) throw new Error("say needs --text");
  const p = resolveProvider(cfg, provider);
  let buf: Buffer;
  if (p === "elevenlabs") {
    const id = str(voice, cfg.elevenlabs.voiceId);
    buf = await apiFetch(`${ELEVEN_API}/text-to-speech/${encodeURIComponent(id)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: {
        "xi-api-key": cfg.elevenlabs.apiKey,
        "Content-Type": "application/json",
      },
      body: { text: str(text), model_id: cfg.elevenlabs.modelId },
      raw: true,
      fetchFn,
    });
  } else {
    const v = str(voice, cfg.openai.voice);
    buf = await apiFetch(`${OPENAI_API}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.openai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: { model: cfg.openai.model, input: str(text), voice: v },
      raw: true,
      fetchFn,
    });
  }
  const dest = str(out) || path.join(resolveRoots({}, { cwd }).root, SPEAK_DIR, `say-${Date.now()}.mp3`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  if (play === true || play === "true" || play === "1") playPath(dest);
  return dest;
}

export async function main(argv: string[], opts: SpeakMainOpts = {}): Promise<number> {
  const { _, flags } = parseArgv(argv);
  if (!opts.env) await loadOptionalConsumerEnv();
  const env = opts.env || process.env;
  const home = opts.home || os.homedir();
  const cwd = opts.cwd || process.cwd();
  const fetchFn = opts.fetchFn || (globalThis.fetch as FetchFn | undefined);
  const log: SpeakLog = opts.log || console;
  const cfg = loadCfg({ env, home });
  const verb = String(_[0] || "").toLowerCase();
  try {
    if (verb === "whoami") {
      log.log(await whoami({ provider: flags.provider, cfg, fetchFn }));
      return 0;
    }
    if (verb === "voices") {
      log.log(await voices({ provider: flags.provider, cfg, fetchFn }));
      return 0;
    }
    if (verb === "say") {
      const dest = await say({
        text: flags.text,
        voice: flags.voice,
        out: flags.out,
        play: flags.play,
        provider: flags.provider,
        cfg,
        cwd,
        fetchFn,
      });
      log.log(dest);
      return 0;
    }
    log.error(USAGE);
    return 1;
  } catch (e) {
    log.error(errMessage(e));
    return 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
