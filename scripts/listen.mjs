#!/usr/bin/env node
/** Speech-to-text (input only). Mic/file → OpenAI Whisper. */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { whichBin } from "./doctor.mjs";

export const DEFAULT_MODEL = "whisper-1";
export const DEFAULT_GGML = "ggml-base.en.bin";
export const WHISPER_BINS = ["whisper-cli", "whisper-cpp"];
export const DEFAULT_SECONDS = 8;
export const MAX_SECONDS = 120;
export const USAGE =
  "usage: listen whoami | devices | rec [--seconds N] [--device D] [--clip] | start [--device D] | stop [--clip] | toggle [--clip] | status | file --path P [--clip] | latest";
export const SETUP = ".rulesync/reference/listen.md";
export const NEED_STT =
  "missing whisper-cli (mac: brew install whisper-cpp) or OPENAI_API_KEY / ~/.grunt/speak.json openai.apiKey. setup: .rulesync/reference/listen.md";
export const NEED_FFMPEG =
  "missing ffmpeg. mac: brew install ffmpeg · linux: sudo apt install ffmpeg · win: winget install Gyan.FFmpeg. setup: .rulesync/reference/listen.md";
export const NEED_OPENAI =
  "missing OPENAI_API_KEY (or ~/.grunt/speak.json openai.apiKey). setup: .rulesync/reference/listen.md";
export const NEED_GGML =
  "whisper-cli found but no ggml model (auto-download failed). set WHISPER_MODEL or retry. setup: .rulesync/reference/listen.md";

export function formatHttpError(status, body, provider = "openai") {
  const n = Number(status);
  const raw = String(body || "");
  const auth =
    n === 401 ||
    n === 403 ||
    /unauthorized|invalid.?api.?key|authentication|missing_permissions/i.test(raw);
  if (auth) {
    return `${provider} key missing or rejected (${n || status}). setup: ${SETUP}`;
  }
  return `${status} ${raw.slice(0, 200)}`.trim();
}
export const GGML_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";

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

export function clampSeconds(v, fallback = DEFAULT_SECONDS) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_SECONDS, Math.max(1, Math.round(n)));
}

export function loadCfg({ env = process.env, home = os.homedir() } = {}) {
  const filePath = path.join(home, ".grunt", "speak.json");
  const file = readJson(filePath);
  const openai = file.openai && typeof file.openai === "object" ? file.openai : {};
  const listen = file.listen && typeof file.listen === "object" ? file.listen : {};
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

export function findWhisperBin(whichFn, pathEnv, platform) {
  const fn = whichFn || whichBin;
  for (const n of WHISPER_BINS) {
    const hit = fn(n, pathEnv, platform);
    if (hit) return hit;
  }
  return "";
}

function isFile(p) {
  try {
    return Boolean(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function findWhisperModel({ cfg, home = os.homedir(), cwd = "" } = {}) {
  const names = [
    cfg && cfg.whisperModel,
    path.join(home, ".grunt", "whisper", DEFAULT_GGML),
    path.join(home, "models", DEFAULT_GGML),
    cwd ? path.join(cwd, "models", DEFAULT_GGML) : "",
  ];
  for (const p of names) {
    const s = str(p);
    if (isFile(s)) return path.resolve(s);
  }
  return "";
}

export function probeStt({
  cfg,
  whichFn,
  pathEnv,
  platform,
  home = os.homedir(),
  cwd = "",
} = {}) {
  const force = str(cfg && cfg.stt, "auto").toLowerCase();
  const bin = findWhisperBin(whichFn, pathEnv, platform);
  const modelPath = findWhisperModel({ cfg, home, cwd });
  const local = bin && modelPath ? { kind: "local", bin, model: modelPath } : null;
  const openai = cfg && cfg.apiKey ? { kind: "openai", model: cfg.model || DEFAULT_MODEL } : null;
  if (force === "local") return local;
  if (force === "openai") return openai;
  return local || openai;
}

export function resolveStt(opts) {
  const force = str(opts && opts.cfg && opts.cfg.stt, "auto").toLowerCase();
  const hit = probeStt(opts);
  if (hit) return hit;
  const bin = findWhisperBin(opts.whichFn, opts.pathEnv, opts.platform);
  if (force === "local" || (bin && force !== "openai")) {
    throw new Error(NEED_GGML);
  }
  if (force === "openai") throw new Error(NEED_OPENAI);
  throw new Error(NEED_STT);
}

export function defaultGgmlPath(home) {
  return path.join(home || os.homedir(), ".grunt", "whisper", DEFAULT_GGML);
}

export async function downloadGgml({
  home = os.homedir(),
  fetchFn = globalThis.fetch,
  log,
} = {}) {
  const dest = defaultGgmlPath(home);
  if (isFile(dest)) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  const part = `${dest}.part`;
  if (log && typeof log.error === "function") {
    log.error(`downloading ${DEFAULT_GGML} (~142MB) to ${dest}`);
  }
  const fn = fetchFn || globalThis.fetch;
  if (typeof fn !== "function") throw new Error("fetch is not available");
  const res = await fn(GGML_URL, {
    headers: { "User-Agent": "grunt-listen" },
    redirect: "follow",
  });
  if (!res || !res.ok) {
    const status = res && res.status != null ? res.status : "err";
    throw new Error(`could not download ggml model (${status}). setup: ${SETUP}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("ggml download empty");
  fs.writeFileSync(part, buf);
  fs.renameSync(part, dest);
  return dest;
}

export async function ensureStt(opts) {
  const force = str(opts && opts.cfg && opts.cfg.stt, "auto").toLowerCase();
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
      if (force === "local" || !(opts.cfg && opts.cfg.apiKey)) throw e;
      return { kind: "openai", model: opts.cfg.model || DEFAULT_MODEL };
    }
  }
  const cfg =
    opts.cfg && modelPath ? { ...opts.cfg, whisperModel: modelPath } : opts.cfg;
  return resolveStt({ ...opts, cfg });
}

export function listenDir(cwd) {
  const d = path.join(cwd || process.cwd(), ".tmp/grunt/listen");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function sessionPath(cwd) {
  return path.join(listenDir(cwd), "session.json");
}

export function latestPath(cwd) {
  return path.join(listenDir(cwd), "latest.txt");
}

export function defaultDevice(platform = process.platform) {
  if (platform === "darwin") return ":0";
  if (platform === "win32") return "";
  return "default";
}

export function darwinAudioSpec(device) {
  const d = str(device, ":0");
  if (/^none:/i.test(d)) return `:${d.slice(5)}` || ":0";
  if (d.startsWith(":")) return d;
  if (/^\d+$/.test(d)) return `:${d}`;
  return d.includes(":") ? d : `:${d}`;
}

export function ffmpegInputArgs(platform, device, ffmpegFormat = "") {
  const d = str(device, defaultDevice(platform));
  if (platform === "darwin") {
    return ["-f", "avfoundation", "-i", darwinAudioSpec(d)];
  }
  if (platform === "win32") {
    if (!d) {
      throw new Error(
        "missing --device or LISTEN_DEVICE. run: node scripts/listen.mjs devices. setup: .rulesync/reference/listen.md",
      );
    }
    const spec = d.startsWith("audio=") ? d : `audio=${d}`;
    return ["-f", "dshow", "-i", spec];
  }
  const fmt = ffmpegFormat || (d.startsWith("hw:") ? "alsa" : "pulse");
  return ["-f", fmt, "-i", d];
}

export function ffmpegRecordArgs({ platform, device, out, seconds, ffmpegFormat } = {}) {
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

export function recSpawnOpts(seconds) {
  const s = clampSeconds(seconds);
  return {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
    timeout: (s + 2) * 1000,
    killSignal: "SIGKILL",
  };
}

export function recCaptureOpts(errFd) {
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
  spawnFn = spawn,
  killFn = process.kill,
  errFd,
} = {}) {
  const s = clampSeconds(seconds);
  return new Promise((resolve) => {
    const child = spawnFn(bin, args, recCaptureOpts(errFd));
    let done = false;
    const finish = (status, signal, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ status, signal, stderr: "", error });
    };
    const timer = setTimeout(() => {
      const pid = child && child.pid;
      try {
        if (pid) killFn(-pid, "SIGKILL");
      } catch {
        try {
          if (child && typeof child.kill === "function") child.kill("SIGKILL");
        } catch {
          /* none */
        }
      }
      finish(null, "SIGKILL", { code: "ETIMEDOUT" });
    }, (s + 2) * 1000);
    if (child && typeof child.on === "function") {
      child.on("error", (error) => finish(null, null, error));
      child.on("exit", (code, signal) => finish(code, signal, null));
    } else {
      finish(0, null, null);
    }
  });
}

export function parseDevices(text, platform = process.platform) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
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
      if (m) out.push({ id: `:${m[1]}`, name: m[2].trim() });
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
      if (m) out.push({ id: m[1], name: m[1] });
    }
    return out;
  }
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\s+(\S+)/);
    if (m) out.push({ id: m[2], name: m[2] });
  }
  if (!out.length) out.push({ id: "default", name: "pulse default" });
  return out;
}

function readSession(cwd) {
  return readJson(sessionPath(cwd));
}

function writeSession(cwd, obj) {
  fs.writeFileSync(sessionPath(cwd), JSON.stringify(obj, null, 2) + "\n");
}

function clearSession(cwd) {
  try {
    fs.unlinkSync(sessionPath(cwd));
  } catch {
    /* none */
  }
}

export function pidAlive(pid, killFn = process.kill) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    killFn(n, 0);
    return true;
  } catch {
    return false;
  }
}

function needFfmpeg(bin) {
  if (!bin) {
    throw new Error(NEED_FFMPEG);
  }
  return bin;
}

export function transcribeLocal({
  file,
  bin,
  model,
  spawnSyncFn = spawnSync,
} = {}) {
  const p = str(file);
  if (!p || !isFile(p)) throw new Error("transcribe needs an audio file");
  const prefix = path.join(path.dirname(p), `${path.basename(p, path.extname(p))}.whisper`);
  const txt = `${prefix}.txt`;
  const r = spawnSyncFn(
    bin,
    ["-m", model, "-f", p, "-otxt", "-of", prefix, "-np", "-nt"],
    { encoding: "utf8" },
  );
  let text = "";
  if (isFile(txt)) {
    text = fs.readFileSync(txt, "utf8").trim();
    try {
      fs.unlinkSync(txt);
    } catch {
      /* none */
    }
  }
  if (!text) text = str(r && r.stdout).trim();
  if (text) return text;
  throw new Error(str(r && r.stderr, "whisper-cli failed"));
}

export async function transcribe({
  file,
  cfg,
  stt,
  fetchFn = globalThis.fetch,
  spawnSyncFn = spawnSync,
} = {}) {
  const p = str(file);
  if (!p || !fs.existsSync(p)) throw new Error("transcribe needs an audio file");
  const engine = stt || { kind: "openai" };
  if (engine.kind === "local") {
    return transcribeLocal({ file: p, bin: engine.bin, model: engine.model, spawnSyncFn });
  }
  if (!cfg?.apiKey) throw new Error(NEED_STT);
  const buf = fs.readFileSync(p);
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "audio/wav" }), path.basename(p) || "audio.wav");
  fd.append("model", cfg.model || DEFAULT_MODEL);
  const res = await fetchFn(TRANSCRIBE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: fd,
  });
  if (!res || !res.ok) {
    let t = "";
    try {
      t = res && typeof res.text === "function" ? await res.text() : "";
    } catch {
      /* none */
    }
    const status = res && res.status != null ? res.status : "err";
    throw new Error(formatHttpError(status, t, "openai"));
  }
  const j = typeof res.json === "function" ? await res.json() : {};
  return str(j && j.text, typeof j === "string" ? j : "");
}

export function copyClip(text, { platform = process.platform, spawnSyncFn = spawnSync } = {}) {
  const body = String(text ?? "");
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
  for (const [bin, args] of [
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard"]],
    ["xsel", ["--clipboard", "--input"]],
  ]) {
    const r = spawnSyncFn(bin, args, { input: body, encoding: "utf8" });
    if (r && r.status === 0) return;
  }
  throw new Error("no wl-copy, xclip, or xsel on PATH");
}

function saveLatest(cwd, text) {
  const p = latestPath(cwd);
  fs.writeFileSync(p, String(text ?? "") + (String(text ?? "").endsWith("\n") ? "" : "\n"));
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
}) {
  const text = await transcribe({ file: wav, cfg, stt, fetchFn, spawnSyncFn });
  const latest = saveLatest(cwd, text);
  if (clip) copyClip(text, { platform, spawnSyncFn });
  if (log) {
    log.log(text);
    const rel = path.relative(cwd, latest).replace(/\\/g, "/");
    log.log(`transcript=${rel || latest}`);
  }
  return text;
}

export function listDevicesText({
  platform = process.platform,
  ffmpegBin,
  spawnSyncFn = spawnSync,
} = {}) {
  needFfmpeg(ffmpegBin);
  if (platform === "darwin") {
    const r = spawnSyncFn(ffmpegBin, ["-f", "avfoundation", "-list_devices", "true", "-i", ""], {
      encoding: "utf8",
    });
    return parseDevices(`${r.stderr || ""}\n${r.stdout || ""}`, "darwin");
  }
  if (platform === "win32") {
    const r = spawnSyncFn(
      ffmpegBin,
      ["-list_devices", "true", "-f", "dshow", "-i", "dummy"],
      { encoding: "utf8" },
    );
    return parseDevices(`${r.stderr || ""}\n${r.stdout || ""}`, "win32");
  }
  const pactl = spawnSyncFn("pactl", ["list", "short", "sources"], { encoding: "utf8" });
  if (pactl.status === 0 && str(pactl.stdout)) {
    return parseDevices(pactl.stdout, "linux");
  }
  return parseDevices("", "linux");
}

function waitPidExit(pid, killFn, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!pidAlive(pid, killFn)) return;
    spawnSync(process.execPath, ["-e", ""], { timeout: 50 });
  }
}

export async function main(argv = process.argv.slice(2), opts = {}) {
  const { _, flags } = parseArgv(argv);
  const env = opts.env || process.env;
  const home = opts.home || str(env.HOME || env.USERPROFILE, os.homedir());
  const cwd = str(flags.cwd || opts.cwd, process.cwd());
  const platform = opts.platform || process.platform;
  const fetchFn = opts.fetchFn || globalThis.fetch;
  const spawnFn = opts.spawnFn || spawn;
  const spawnSyncFn = opts.spawnSyncFn || spawnSync;
  const killFn = opts.killFn || process.kill;
  const whichFn = opts.whichFn || whichBin;
  const log = opts.log || console;
  const pathEnv = opts.pathEnv || env.PATH || process.env.PATH;
  const ffmpegBin = whichFn("ffmpeg", pathEnv, platform);
  const scriptPath = opts.scriptPath || fileURLToPath(import.meta.url);
  const nodeBin = opts.nodeBin || process.execPath;
  const cfg = loadCfg({ env, home });
  const device = str(flags.device, cfg.device);
  const clip = flags.clip === "1" || flags.clip === true || flags.clip === "true";
  const verb = String(_[0] || "").toLowerCase();
  const sttOpts = { cfg, whichFn, pathEnv, platform, home, cwd, fetchFn, log };

  try {
    if (verb === "whoami") {
      const ff = ffmpegBin || "missing";
      let stt;
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
      log.log(`${alive ? "recording" : "stale"}  pid=${s.pid}  wav=${s.wav || "-"}`);
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
      needFfmpeg(ffmpegBin);
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
      const child = spawnFn(ffmpegBin, args, { stdio: ["pipe", "ignore", "pipe"] });
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
      const code = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", (c) => resolve(c == null ? 0 : c));
      });
      return code && code !== 0 && code !== 255 ? 1 : 0;
    }
    if (verb === "start") {
      needFfmpeg(ffmpegBin);
      const cur = readSession(cwd);
      if (cur.pid && pidAlive(cur.pid, killFn)) {
        log.error(`already recording pid=${cur.pid}`);
        return 1;
      }
      const wav = path.join(listenDir(cwd), `rec-${Date.now()}.wav`);
      const child = spawnFn(
        nodeBin,
        [
          scriptPath,
          "_record",
          "--out",
          wav,
          ...(device ? ["--device", device] : []),
          ...(flags.cwd || opts.cwd ? ["--cwd", cwd] : []),
        ],
        {
          detached: true,
          stdio: "ignore",
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
      if (pidAlive(s.pid, killFn)) {
        try {
          killFn(s.pid, "SIGINT");
        } catch {
          /* none */
        }
        if (typeof opts.waitPid === "function") opts.waitPid(s.pid, killFn);
        else waitPidExit(s.pid, killFn);
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
      needFfmpeg(ffmpegBin);
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
      log.error(`recording ${seconds}s on ${args[args.indexOf("-i") + 1] || "mic"}…`);
      const ffLog = path.join(listenDir(cwd), "ffmpeg.log");
      const errFd = fs.openSync(ffLog, "w");
      let r;
      try {
        r = await recCapture({
          bin: ffmpegBin,
          args,
          seconds,
          spawnFn,
          killFn,
          errFd,
        });
      } finally {
        try {
          fs.closeSync(errFd);
        } catch {
          /* none */
        }
      }
      const ffErr = isFile(ffLog) ? str(fs.readFileSync(ffLog, "utf8")).slice(0, 400) : "";
      if (r.error && (r.error.code === "ETIMEDOUT" || r.signal === "SIGKILL")) {
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
    log.error(String(e && e.message ? e.message : e));
    return 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  main().then((code) => process.exit(code));
}
