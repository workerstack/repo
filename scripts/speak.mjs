#!/usr/bin/env node
/** Text-to-speech (output only). Providers: elevenlabs, openai. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_ELEVEN_VOICE = "JBFqnCBsd6RMkjVDRZzb";
export const DEFAULT_ELEVEN_MODEL = "eleven_multilingual_v2";
export const DEFAULT_OPENAI_VOICE = "coral";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini-tts";
export const OPENAI_VOICES = [
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
export const SETUP = "node scripts/setup.mjs speak";
export const NEED_KEY =
  "missing ELEVENLABS_API_KEY or OPENAI_API_KEY (or ~/.grunt/speak.json). setup: node scripts/setup.mjs speak";
export const NEED_ELEVEN =
  "missing ELEVENLABS_API_KEY (or ~/.grunt/speak.json elevenlabs.apiKey). setup: node scripts/setup.mjs speak";
export const NEED_OPENAI =
  "missing OPENAI_API_KEY (or ~/.grunt/speak.json openai.apiKey). setup: node scripts/setup.mjs speak";

export function formatHttpError(status, body, provider) {
  const n = Number(status);
  const raw = String(body || "");
  if (/missing_permissions/i.test(raw)) {
    return `${provider} key present but missing permission (${n || status}). setup: ${SETUP}`;
  }
  const auth =
    n === 401 ||
    n === 403 ||
    /unauthorized|invalid.?api.?key|authentication/i.test(raw);
  if (auth) {
    return `${provider} key missing or rejected (${n || status}). setup: ${SETUP}`;
  }
  return `${status} ${raw.slice(0, 200)}`.trim();
}

export function parseArgv(argv) {
  const out = { _: [], flags: {} };
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
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

function readJson(p) {
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    if (j && typeof j === "object" && !Array.isArray(j)) return j;
  } catch {
    /* none */
  }
  return {};
}

function str(v, fallback = "") {
  const s = String(v ?? "").trim();
  return s || fallback;
}

export function loadCfg({ env = process.env, home = os.homedir() } = {}) {
  const filePath = path.join(home, ".grunt", "speak.json");
  const file = readJson(filePath);
  const eleven = file.elevenlabs && typeof file.elevenlabs === "object" ? file.elevenlabs : {};
  const openai = file.openai && typeof file.openai === "object" ? file.openai : {};
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

export function resolveProvider(cfg, flagProvider) {
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

async function apiFetch(url, { method = "GET", headers, body, raw, fetchFn } = {}) {
  const fn = fetchFn || globalThis.fetch;
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
    if (typeof res.arrayBuffer === "function") return Buffer.from(await res.arrayBuffer());
    if (Buffer.isBuffer(res.body)) return res.body;
    return Buffer.from(res.body || []);
  }
  if (typeof res.json === "function") return res.json();
  return {};
}

export async function whoami({ provider, cfg, fetchFn } = {}) {
  const p = resolveProvider(cfg, provider);
  if (p === "elevenlabs") {
    try {
      const u = await apiFetch(`${ELEVEN_API}/user`, {
        headers: { "xi-api-key": cfg.elevenlabs.apiKey },
        fetchFn,
      });
      const email = u && u.email ? u.email : "ok";
      const tier = u && u.subscription && u.subscription.tier ? u.subscription.tier : "-";
      return `elevenlabs  ${email}  tier=${tier}`;
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
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

export async function voices({ provider, cfg, fetchFn } = {}) {
  const p = resolveProvider(cfg, provider);
  if (p === "openai") return OPENAI_VOICES.join("\n");
  const j = await apiFetch(`${ELEVEN_API}/voices`, {
    headers: { "xi-api-key": cfg.elevenlabs.apiKey },
    fetchFn,
  });
  const list = Array.isArray(j?.voices) ? j.voices : [];
  return list.map((v) => `${v.voice_id}  ${v.name}`).join("\n");
}

function playPath(dest) {
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
} = {}) {
  if (!str(text)) throw new Error("say needs --text");
  const p = resolveProvider(cfg, provider);
  let buf;
  if (p === "elevenlabs") {
    const id = str(voice, cfg.elevenlabs.voiceId);
    buf = await apiFetch(
      `${ELEVEN_API}/text-to-speech/${encodeURIComponent(id)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": cfg.elevenlabs.apiKey,
          "Content-Type": "application/json",
        },
        body: { text: str(text), model_id: cfg.elevenlabs.modelId },
        raw: true,
        fetchFn,
      },
    );
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
  const dest = str(out) || path.join(cwd, ".tmp/grunt/speak", `say-${Date.now()}.mp3`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  if (play === true || play === "true" || play === "1") playPath(dest);
  return dest;
}

export async function main(argv = process.argv.slice(2), opts = {}) {
  const { _, flags } = parseArgv(argv);
  const env = opts.env || process.env;
  const home = opts.home || os.homedir();
  const cwd = opts.cwd || process.cwd();
  const fetchFn = opts.fetchFn || globalThis.fetch;
  const log = opts.log || console;
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
    log.error(String(e && e.message ? e.message : e));
    return 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  main().then((code) => process.exit(code));
}
