#!/usr/bin/env bun
/** Handheld machine setup for optional repo integrations. Secrets stay in ~/.workerstack/. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { enabledSkills } from "../config.ts";
import { readEnv } from "../env.ts";
import type { Env } from "../env.ts";
import {
  CHROMIUM_BINS,
  installHints,
  jevDoctorStatus,
  speakDoctorStatus,
  whichBin,
  workspaceDoctorStatus,
} from "./doctor.ts";
import type { SpawnSyncOpts } from "./google-workspace.ts";
import { isRecord } from "./hook-input.ts";
import { isInteractive as ttyInteractive } from "./interactive.ts";
import type { WhichFn } from "./listen.types.ts";
import type { FetchResult } from "./speak.types.ts";

export type Flags = Record<string, string>;

export type Status = {
  ok: boolean;
  extra: string;
};

export type Statuses = Record<string, Status>;

export type TargetStatuses = Record<"speak" | "jev" | "listen" | "google-workspace" | "browser", Status>;

/**
 * Prompt and log hooks. A plain log-only io (tests, non-TTY) leaves the prompts unset;
 * select and password are set on every interactive io, so callers use `!` on them.
 */
export type SetupIo = {
  log?(s: string): unknown;
  error?(s: string): unknown;
  confirm?(opts: { message: string; initialValue?: boolean }): Promise<boolean>;
  select?(opts: {
    message: string;
    options: { value: string; label: string }[];
    initialValue: string;
  }): Promise<string>;
  text?(opts: { message: string; initialValue?: string; defaultValue?: string }): Promise<string>;
  password?(opts: { message: string }): Promise<string>;
};

export type SetupFetch = (
  url: string,
  init: {
    method?: string | undefined;
    headers?: Record<string, string> | undefined;
    body?: string | FormData | undefined;
    redirect?: "follow" | "manual" | "error" | undefined;
  },
) => Promise<FetchResult>;

export type SetupSpawnSync = (cmd: string, args: string[], opts: SpawnSyncOpts) => unknown;

export type SetupCtx = {
  flags?: Flags | undefined;
  env?: Env | undefined;
  home?: string | undefined;
  io?: SetupIo | null | undefined;
  fetchFn?: SetupFetch | undefined;
  openUrlFn?: ((url: string) => unknown) | undefined;
  platform?: NodeJS.Platform | undefined;
  spawnSyncFn?: SetupSpawnSync | undefined;
  whichFn?: WhichFn | undefined;
  pathEnv?: string | undefined;
  interactive?: boolean | undefined;
  loginFn?: ((dest: string, home: string) => Promise<unknown>) | undefined;
};

export type SetupMainOpts = {
  cwd?: string;
  stdin?: { isTTY?: boolean };
  stdout?: { isTTY?: boolean };
} & Omit<SetupCtx, "flags">;

export type SpeakPatch = {
  provider?: string;
  elevenlabs?: { apiKey: string };
  openai?: { apiKey: string };
  listen?: { device: string };
};

function rec(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

function errMessage(e: unknown): string {
  const m = isRecord(e) ? e.message : undefined;
  return String(m || e);
}

export const TARGETS: string[] = ["speak", "listen", "google-workspace", "browser", "jev"];
export const USAGE = `usage: setup [speak|listen|google-workspace|browser|jev]
  speak            --elevenlabs-key KEY | --openai-key KEY [--provider elevenlabs|openai] [--skip-verify]
  listen           [--openai-key KEY] [--device ID] [--skip-download]
  google-workspace [--creds PATH] [--account NAME] [--project ID]
  browser          (engine install hints; no secrets)
  jev              --api-key KEY
  --redo           redo a target that is already ok

TTY menu shows ok/missing. Missing bins: print OS command, then re-check PATH. Never installs.
Already ok: confirm redo (TTY) unless --redo. Ends with one status line per target (not a README).
Secrets: ~/.workerstack/ (not git). Env still wins over the file. Setup does not export keys.
`;

export const ELEVENLABS_KEY_URL = "https://elevenlabs.io/app/settings/api-keys";
export const OPENAI_KEY_URL = "https://platform.openai.com/api-keys";

export function parseArgv(argv: unknown): { _: string[]; flags: Flags } {
  const out: { _: string[]; flags: Flags } = { _: [], flags: {} };
  const args: unknown[] = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      out._.push(...args.slice(i + 1).map(String));
      break;
    }
    if (typeof a === "string" && a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 2) {
        out.flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const nxt = args[i + 1];
      if (nxt && !String(nxt).startsWith("--")) {
        out.flags[key] = String(nxt);
        i += 1;
      } else {
        out.flags[key] = "1";
      }
    } else {
      out._.push(String(a));
    }
  }
  return out;
}

export function normalizeTarget(raw: unknown): string {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return "";
  if (s === "gw" || s === "google" || s === "workspace" || s === "google-workspace") return "google-workspace";

  if (TARGETS.includes(s)) return s;
  return "";
}

function str(v: unknown, fallback = ""): string {
  const s = String(v ?? "").trim();
  return s || fallback;
}

export function stateHome(home: string = os.homedir()): string {
  const d = path.join(home, ".workerstack");
  fs.mkdirSync(d, { mode: 0o700, recursive: true });
  try {
    fs.chmodSync(d, 0o700);
  } catch {
    // win
  }
  return d;
}

export function writeSecretJson(p: string, obj: unknown): string {
  fs.mkdirSync(path.dirname(p), { mode: 0o700, recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    // win
  }
  return p;
}

function readJson(p: string): Record<string, unknown> {
  try {
    const j: unknown = JSON.parse(fs.readFileSync(p, "utf8"));
    return rec(j);
  } catch {
    return {};
  }
}

export function speakJsonPath(home: string): string {
  return path.join(home, ".workerstack", "speak.json");
}

export function mergeSpeakJson(home: string, patch: SpeakPatch): string {
  stateHome(home);
  const p = speakJsonPath(home);
  const cur = readJson(p);
  const next: Record<string, unknown> = { ...cur, ...patch };
  if (patch.elevenlabs) next.elevenlabs = { ...rec(cur.elevenlabs), ...patch.elevenlabs };

  if (patch.openai) next.openai = { ...rec(cur.openai), ...patch.openai };

  if (patch.listen) next.listen = { ...rec(cur.listen), ...patch.listen };

  writeSecretJson(p, next);
  return p;
}

export function parseDesktopOAuth(raw: unknown): Record<string, unknown> {
  const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  const j = rec(parsed);
  const inst = rec(j.installed || j.web);
  if (!inst.client_id) throw new Error("OAuth JSON needs installed.client_id (Desktop app download)");

  if (!j.installed) throw new Error("OAuth JSON must be a Desktop client (installed), not a Web client");

  return j;
}

export function loadOAuthInput(s: unknown): Record<string, unknown> {
  const t = String(s || "").trim();
  if (!t) throw new Error("OAuth JSON path or JSON body required");
  if (t.startsWith("{")) return parseDesktopOAuth(t);
  if (!fs.existsSync(t) || !fs.statSync(t).isFile()) throw new Error(`OAuth JSON not found: ${t}`);

  return parseDesktopOAuth(fs.readFileSync(t, "utf8"));
}

export function installOAuthJson({ src, dest }: { src: string; dest: string }): string {
  const j = loadOAuthInput(src);
  writeSecretJson(dest, j);
  return dest;
}

export function findDownloadedOAuthJson(home: string): string {
  const dirs = [path.join(home, "Downloads"), path.join(home, "downloads")];
  const hits: { p: string; m: number }[] = [];
  for (const dir of dirs) {
    let ents: string[];
    try {
      ents = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of ents) {
      if (!/client_secret.*\.json$/i.test(name) && name.toLowerCase() !== "google-oauth.json") continue;

      const p = path.join(dir, name);
      try {
        const st = fs.statSync(p);
        if (st.isFile()) hits.push({ m: st.mtimeMs, p });
      } catch {
        // skip
      }
    }
  }
  hits.sort((a, b) => b.m - a.m);
  return hits[0] ? hits[0].p : "";
}

export function workspaceConsoleUrls(
  projectId: unknown,
): Record<"projectCreate" | "branding" | "enableApis" | "clientCreate", string> {
  const p = str(projectId);
  const enc = encodeURIComponent(p);
  return {
    branding: p
      ? `https://console.cloud.google.com/auth/overview/create?project=${enc}`
      : "https://console.cloud.google.com/auth/overview/create",
    clientCreate: p
      ? `https://console.cloud.google.com/auth/clients/create?project=${enc}`
      : "https://console.cloud.google.com/auth/clients/create",
    enableApis: p
      ? `https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com,gmail.googleapis.com,sheets.googleapis.com,docs.googleapis.com,drive.googleapis.com&project=${enc}`
      : "https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com,gmail.googleapis.com,sheets.googleapis.com,docs.googleapis.com,drive.googleapis.com",
    projectCreate: "https://console.cloud.google.com/projectcreate",
  };
}

export async function openUrl(
  url: string,
  {
    platform = process.platform,
    spawnSyncFn,
    openUrlFn,
  }: {
    platform?: NodeJS.Platform | undefined;
    spawnSyncFn?: SetupSpawnSync | undefined;
    openUrlFn?: ((url: string) => unknown) | undefined;
  } = {},
): Promise<void> {
  if (typeof openUrlFn === "function") {
    openUrlFn(url);
    return;
  }
  const { openUrl: openWorkspaceUrl } = await import("./google-workspace.ts");
  openWorkspaceUrl(url, spawnSyncFn ? { platform, spawnSyncFn } : { platform });
}

function flagOn(flags: Flags | undefined, key: string): boolean {
  const v = flags && flags[key];
  return v === "1" || v === "true";
}

export function lookupChromium(
  whichFn: WhichFn = whichBin,
  pathEnv: string | undefined = readEnv().PATH,
  platform: NodeJS.Platform = process.platform,
): string {
  for (const n of CHROMIUM_BINS) {
    const hit = whichFn(n, pathEnv, platform);
    if (hit) return hit;
  }
  return "";
}

export function browserEngineStatus(lp: string, cr: string, platform: NodeJS.Platform = process.platform): Status {
  const have = [lp && "lightpanda", cr && "chromium"].filter((x): x is string => Boolean(x));
  if (lp && cr) return { extra: have.join(","), ok: true };
  if (platform === "win32" && cr) return { extra: have.concat(["need lightpanda in WSL"]).join(","), ok: true };

  const need: string[] = [];
  if (!lp) need.push("need lightpanda");
  if (!cr) need.push("need chromium");
  return { extra: have.concat(need).join(","), ok: false };
}

export function setupTargets(packs: string[] = []): string[] {
  const on = new Set(packs);
  return TARGETS.filter((target) => target === "browser" || target === "jev" || on.has(target));
}

export async function targetStatuses({
  home = os.homedir(),
  env = readEnv(),
  whichFn = whichBin,
  pathEnv,
  platform = process.platform,
  targets = TARGETS,
}: {
  home?: string | undefined;
  env?: Env | undefined;
  whichFn?: WhichFn | undefined;
  pathEnv?: string | undefined;
  platform?: NodeJS.Platform | undefined;
  targets?: string[] | undefined;
} = {}): Promise<TargetStatuses> {
  const pEnv = pathEnv || env.PATH || readEnv().PATH;
  const speak = speakDoctorStatus({ env, home });
  const jev = jevDoctorStatus({ env, home });
  const ws = workspaceDoctorStatus({ home });
  const lp = whichFn("lightpanda", pEnv, platform);
  const cr = lookupChromium(whichFn, pEnv, platform);
  let listen: Status = { extra: "", ok: false };
  if (targets.includes("listen")) {
    const { loadCfg } = await import("./listen-argv.ts");
    const { probeStt, findWhisperBin } = await import("./listen-whisper.ts");
    const cfg = loadCfg({ env, home });
    const stt = probeStt({ cfg, cwd: "", home, pathEnv: pEnv, platform, whichFn });
    const ffmpeg = whichFn("ffmpeg", pEnv, platform);
    const whisper = findWhisperBin(whichFn, pEnv, platform);
    const listenBits = [stt && stt.kind, ffmpeg && "ffmpeg", whisper && "whisper"].filter((x): x is string =>
      Boolean(x),
    );
    listen = { extra: listenBits.join(","), ok: Boolean(stt) };
  }
  return {
    browser: browserEngineStatus(lp, cr, platform),
    "google-workspace": { extra: ws.extra, ok: ws.ok },
    jev: { extra: jev.extra, ok: jev.ok },
    listen,
    speak: { extra: speak.extra, ok: speak.ok },
  };
}

export function formatStatus(statuses: Statuses | null | undefined, targets: string[] = TARGETS): string {
  return targets
    .map((t) => {
      const st = (statuses && statuses[t]) ?? { extra: "", ok: false };
      const b = st.ok ? "ok" : "missing";
      return st.extra ? `${t}  ${b}  ${st.extra}` : `${t}  ${b}`;
    })
    .join("\n");
}

export function menuOptions(
  statuses: Statuses | null | undefined,
  targets: string[] = TARGETS,
): { value: string; label: string }[] {
  const base = [
    { label: "speak (ElevenLabs / OpenAI TTS)", value: "speak" },
    { label: "listen (STT)", value: "listen" },
    { label: "google-workspace", value: "google-workspace" },
    { label: "browser (PATH engines)", value: "browser" },
    { label: "jev (TypeSafe research decision)", value: "jev" },
  ].filter((o) => targets.includes(o.value));
  return base.map((o) => {
    const st = (statuses && statuses[o.value]) ?? { extra: "", ok: false };
    const tag = st.ok ? (st.extra ? `ok ${st.extra}` : "ok") : st.extra ? `missing ${st.extra}` : "missing";
    return { label: `${o.label}  ${tag}`, value: o.value };
  });
}

export function firstMissing(statuses: Statuses | null | undefined, targets: string[] = TARGETS): string {
  for (const t of targets) if (!statuses || !statuses[t] || !statuses[t].ok) return t;

  return targets[0] || "browser";
}

export async function reprobeHint({
  id,
  found,
  probe,
  platform = process.platform,
  io,
  interactive = false,
}: {
  id: string;
  found?: string | undefined;
  probe?: (() => string) | undefined;
  platform?: NodeJS.Platform | undefined;
  io?: SetupIo | null | undefined;
  interactive?: boolean | undefined;
}): Promise<string> {
  let hit = found ?? "";
  if (hit) {
    logLine(io, `${id} ok  ${hit}`);
    return hit;
  }
  logLine(io, `${id} missing. print-only; not installed:`);
  for (const h of installHints(id, platform)) logLine(io, h);
  if (interactive && io && typeof io.confirm === "function") {
    const again = await io.confirm({
      initialValue: false,
      message: `Installed ${id}? Re-check PATH`,
    });
    if (again) {
      hit = typeof probe === "function" ? probe() : "";
      if (hit) logLine(io, `${id} ok  ${hit}`);
      else logLine(io, `${id} still missing`);
    }
  }
  return hit;
}

function logLine(io: SetupIo | null | undefined, s: string): void {
  if (io && typeof io.log === "function") io.log(s);
  else process.stdout.write(`${s}\n`);
}

function errLine(io: SetupIo | null | undefined, s: string): void {
  if (io && typeof io.error === "function") io.error(s);
  else process.stderr.write(`${s}\n`);
}

async function defaultIo(): Promise<SetupIo> {
  const { confirm, password, select, text } = await import("./prompt.ts");
  return {
    confirm,
    error: (s: string) => process.stderr.write(`${s}\n`),
    log: (s: string) => process.stdout.write(`${s}\n`),
    password,
    select,
    text,
  };
}

export function oauthWritePath(home: string, account: unknown): string {
  return path.join(home, ".workerstack", "workspace", str(account, "default"), "google-oauth.json");
}

export async function setupSpeak({
  flags = {},
  home = os.homedir(),
  io,
  fetchFn,
  openUrlFn,
  platform = process.platform,
  spawnSyncFn,
  interactive = false,
}: SetupCtx = {}): Promise<{ ok: true; dest: string; verified: boolean; who?: string }> {
  const { loadCfg: loadSpeakCfg } = await import("./speak-config.ts");
  const { whoami: speakWhoami } = await import("./speak-api.ts");
  let elevenKey = str(flags["elevenlabs-key"] || flags.elevenlabs);
  let openaiKey = str(flags["openai-key"] || flags.openai);
  let provider = str(flags.provider).toLowerCase();
  const skipVerify = flagOn(flags, "skip-verify");

  if (interactive && io && !elevenKey && !openaiKey) {
    provider = str(
      await io.select!({
        initialValue: provider === "openai" ? "openai" : "elevenlabs",
        message: "Speak provider",
        options: [
          { label: "ElevenLabs", value: "elevenlabs" },
          { label: "OpenAI", value: "openai" },
          { label: "both", value: "both" },
        ],
      }),
    );
  }

  const askEleven = provider === "elevenlabs" || provider === "both" || (!provider && !openaiKey);
  const askOpenAi = provider === "openai" || provider === "both";

  if (interactive && io) {
    if (askEleven && !elevenKey) {
      logLine(io, `Open: ${ELEVENLABS_KEY_URL}`);
      await openUrl(ELEVENLABS_KEY_URL, { openUrlFn, platform, spawnSyncFn });
      elevenKey = str(await io.password!({ message: "ElevenLabs API key" }));
    }
    if (askOpenAi && !openaiKey) {
      logLine(io, `Open: ${OPENAI_KEY_URL}`);
      await openUrl(OPENAI_KEY_URL, { openUrlFn, platform, spawnSyncFn });
      openaiKey = str(await io.password!({ message: "OpenAI API key" }));
    }
  }

  const patch: SpeakPatch = {};
  if (provider && provider !== "both") patch.provider = provider;
  if (elevenKey) patch.elevenlabs = { apiKey: elevenKey };
  if (openaiKey) patch.openai = { apiKey: openaiKey };

  if (!patch.elevenlabs && !patch.openai) {
    throw new Error(
      interactive
        ? "need an ElevenLabs or OpenAI key"
        : "need --elevenlabs-key or --openai-key (or TTY: bun repo setup speak)",
    );
  }

  const dest = mergeSpeakJson(home, patch);
  logLine(io, `wrote ${dest}`);

  if (skipVerify) return { dest, ok: true, verified: false };

  const cfg = loadSpeakCfg({ env: {}, home });
  const who = await speakWhoami({
    cfg,
    fetchFn,
    provider: provider === "both" || !provider ? undefined : provider,
  });
  logLine(io, who);
  return { dest, ok: true, verified: true, who };
}

export async function setupListen({
  flags = {},
  env = readEnv(),
  home = os.homedir(),
  io,
  fetchFn,
  openUrlFn,
  platform = process.platform,
  spawnSyncFn,
  whichFn = whichBin,
  pathEnv = readEnv().PATH,
  interactive = false,
}: SetupCtx = {}): Promise<{ ok: true; stt: Awaited<ReturnType<typeof import("./listen-whisper.ts").probeStt>> }> {
  const { loadCfg: loadListenCfg } = await import("./listen-argv.ts");
  const { downloadGgml, findWhisperBin, probeStt } = await import("./listen-whisper.ts");
  const ffmpegBin = await reprobeHint({
    found: whichFn("ffmpeg", pathEnv, platform),
    id: "ffmpeg",
    interactive,
    io,
    platform,
    probe: () => whichFn("ffmpeg", pathEnv, platform),
  });
  const whisperBin = await reprobeHint({
    found: findWhisperBin(whichFn, pathEnv, platform),
    id: "whisper-cli",
    interactive,
    io,
    platform,
    probe: () => findWhisperBin(whichFn, pathEnv, platform),
  });

  const skipDownload = flagOn(flags, "skip-download");
  if (whisperBin && !skipDownload) {
    let go = true;
    if (interactive && io && typeof io.confirm === "function") {
      go = await io.confirm({
        initialValue: true,
        message: "Download ggml-base.en.bin (~142MB) into ~/.workerstack/whisper/?",
      });
    }
    if (go) {
      const model = await downloadGgml({ fetchFn, home, log: { error: (s: string) => logLine(io, s) } });
      logLine(io, `model ${model}`);
    }
  }

  const openai = str(flags["openai-key"] || flags.openai);
  let openaiKey = openai;
  const cfgNow = loadListenCfg({ env, home });
  if (!whisperBin && !cfgNow.apiKey && !openaiKey) {
    if (interactive && io) {
      logLine(io, `Local STT is unavailable. OpenAI Whisper fallback: ${OPENAI_KEY_URL}`);
      await openUrl(OPENAI_KEY_URL, { openUrlFn, platform, spawnSyncFn });
      openaiKey = str(await io.password!({ message: "OpenAI API key (fallback STT)" }));
    } else {
      throw new Error("need whisper-cli or --openai-key (or TTY: bun repo setup listen)");
    }
  }

  const patch: SpeakPatch = {};
  if (openaiKey) patch.openai = { apiKey: openaiKey };
  const device = str(flags.device);
  if (device) patch.listen = { device };
  if (interactive && io && ffmpegBin && !device && typeof io.text === "function") {
    const d = str(
      await io.text({
        defaultValue: "",
        message: "Mic device id (blank = default; Windows needs an id from listen devices)",
      }),
    );
    if (d) patch.listen = { ...patch.listen, device: d };
  }
  if (Object.keys(patch).length) {
    const dest = mergeSpeakJson(home, patch);
    logLine(io, `wrote ${dest}`);
  }

  const cfg = loadListenCfg({ env: {}, home });
  const stt = probeStt({ cfg, cwd: "", home, pathEnv, platform, whichFn });
  if (stt && stt.kind === "local") logLine(io, `stt=local  bin=${stt.bin}  model=${stt.model}`);
  else if (stt && stt.kind === "openai") logLine(io, `stt=openai  model=${stt.model}`);
  else logLine(io, "stt=none");

  return { ok: true, stt };
}

export async function setupGoogleWorkspace({
  flags = {},
  home = os.homedir(),
  io,
  openUrlFn,
  platform = process.platform,
  spawnSyncFn,
  interactive = false,
  loginFn,
}: SetupCtx = {}): Promise<{ ok: true; dest: string; tokens: string }> {
  const { loginLoopback, setAccount, tokenStorePath } = await import("./google-workspace.ts");
  const account = str(flags.account, "default");
  setAccount(account);
  stateHome(home);
  const dest = oauthWritePath(home, account);
  const credsFlag = str(flags.creds || flags.json);
  let projectId = str(flags.project);

  if (!credsFlag && interactive && io) {
    const urls0 = workspaceConsoleUrls(projectId);
    logLine(io, "Each person uses their own GCP Desktop OAuth client. Do not share JSON or tokens.");
    logLine(io, `Open: ${urls0.projectCreate}`);
    await openUrl(urls0.projectCreate, { openUrlFn, platform, spawnSyncFn });
    if (typeof io.confirm === "function")
      await io.confirm({ initialValue: true, message: "GCP project created? Continue" });

    if (typeof io.text === "function") {
      projectId = str(
        await io.text({
          initialValue: projectId,
          message: "Project ID (from the console URL ?project=)",
        }),
        projectId,
      );
    }
    const urls = workspaceConsoleUrls(projectId);
    logLine(io, "Consent: Internal on paid Workspace, else Testing + add your email as a test user.");
    logLine(io, `Open: ${urls.branding}`);
    await openUrl(urls.branding, { openUrlFn, platform, spawnSyncFn });
    if (typeof io.confirm === "function")
      await io.confirm({ initialValue: true, message: "Branding / audience done? Continue" });

    logLine(io, `Open: ${urls.enableApis}`);
    await openUrl(urls.enableApis, { openUrlFn, platform, spawnSyncFn });
    if (typeof io.confirm === "function") await io.confirm({ initialValue: true, message: "APIs enabled? Continue" });

    logLine(io, "Create OAuth client: application type Desktop app → Download JSON.");
    logLine(io, `Open: ${urls.clientCreate}`);
    await openUrl(urls.clientCreate, { openUrlFn, platform, spawnSyncFn });
    if (typeof io.confirm === "function")
      await io.confirm({ initialValue: true, message: "JSON downloaded? Continue" });

    const found = findDownloadedOAuthJson(home);
    const src = str(
      typeof io.text === "function"
        ? await io.text({
            defaultValue: found,
            initialValue: found,
            message: "Path to Desktop OAuth JSON (or paste the JSON)",
          })
        : found,
    );
    if (!src) throw new Error("need path to Desktop OAuth JSON");
    installOAuthJson({ dest, src });
  } else if (credsFlag) {
    installOAuthJson({ dest, src: credsFlag });
  } else if (!fs.existsSync(dest)) {
    throw new Error(`need --creds PATH (or TTY: bun repo setup google-workspace)`);
  }

  logLine(io, `oauth ${dest}`);
  const login = loginFn ?? loginLoopback;
  await login(dest, home);
  const tokens = tokenStorePath(home);
  logLine(io, `tokens ${tokens}`);
  return { dest, ok: true, tokens };
}

export async function setupBrowser({
  io,
  platform = process.platform,
  pathEnv = readEnv().PATH,
  whichFn = whichBin,
  interactive = false,
}: SetupCtx = {}): Promise<{ ok: boolean; lightpanda: string; chromium: string }> {
  const lp = await reprobeHint({
    found: whichFn("lightpanda", pathEnv, platform),
    id: "lightpanda",
    interactive,
    io,
    platform,
    probe: () => whichFn("lightpanda", pathEnv, platform),
  });
  const chromium = await reprobeHint({
    found: lookupChromium(whichFn, pathEnv, platform),
    id: "chromium",
    interactive,
    io,
    platform,
    probe: () => lookupChromium(whichFn, pathEnv, platform),
  });
  const st = browserEngineStatus(lp, chromium, platform);
  logLine(io, "session: .tmp/repo/browser/");
  if (lp && chromium) logLine(io, "browser ok  lightpanda (default) + chromium (fallback)");
  else if (!lp && chromium && platform !== "win32")
    logLine(io, "Chromium is the fallback only. Install Lightpanda as well (default engine).");
  else if (lp && !chromium)
    logLine(io, "Lightpanda ok. Install a chromium-family browser as well (shot/pdf/fallback).");

  return { chromium, lightpanda: lp, ok: st.ok };
}

export async function setupJev({ flags = {}, home = os.homedir(), io, interactive = false }: SetupCtx = {}): Promise<{
  ok: true;
  dest: string;
}> {
  let apiKey = str(flags["api-key"] || flags.key);
  if (interactive && io && !apiKey && typeof io.password === "function") {
    logLine(io, "Open: https://console.typesafe.ai/keys");
    apiKey = str(await io.password({ message: "TypeSafe API key" }));
  }
  if (!apiKey) throw new Error(interactive ? "need a TypeSafe API key" : "need --api-key (or TTY: bun repo setup jev)");

  const dest = writeSecretJson(path.join(home, ".workerstack", "jev.json"), { apiKey });
  logLine(io, `wrote ${dest}`);
  return { dest, ok: true };
}

async function runTarget(target: string, ctx: SetupCtx): Promise<unknown> {
  if (target === "speak") return setupSpeak(ctx);
  if (target === "listen") return setupListen(ctx);
  if (target === "google-workspace") return setupGoogleWorkspace(ctx);
  if (target === "browser") return setupBrowser(ctx);
  return setupJev(ctx);
}

export async function main(argv: string[], opts: SetupMainOpts = {}): Promise<number> {
  const { _, flags } = parseArgv(argv);
  const env = opts.env ?? readEnv();
  const home = opts.home || env.HOME || env.USERPROFILE || os.homedir();
  const cwd = opts.cwd || process.cwd();
  const targets = setupTargets([...(await enabledSkills(cwd))]);
  const interactive =
    opts.interactive == null
      ? ttyInteractive({
          argv,
          env,
          stdin: opts.stdin ?? process.stdin,
          stdout: opts.stdout ?? process.stdout,
        })
      : Boolean(opts.interactive);
  const io = opts.io ?? (interactive ? await defaultIo() : null);
  const ctx: SetupCtx = {
    env,
    fetchFn: opts.fetchFn,
    flags,
    home,
    interactive,
    io,
    loginFn: opts.loginFn,
    openUrlFn: opts.openUrlFn,
    pathEnv: opts.pathEnv || env.PATH || readEnv().PATH,
    platform: opts.platform || process.platform,
    spawnSyncFn: opts.spawnSyncFn,
    whichFn: opts.whichFn,
  };

  const statusOpts = {
    env,
    home,
    pathEnv: ctx.pathEnv,
    platform: ctx.platform,
    whichFn: ctx.whichFn,
  };
  let statuses: Statuses = await targetStatuses({ ...statusOpts, targets });
  let target = normalizeTarget(_[0]);
  if (target && !targets.includes(target)) {
    errLine(io, `${target} is off. Add it to agents.skills in workerstack.config.ts, then run \`bun repo sync\`.`);
    return 1;
  }
  if (!target && interactive && io && typeof io.select === "function") {
    target = normalizeTarget(
      await io.select({
        initialValue: firstMissing(statuses, targets),
        message: "Setup",
        options: menuOptions(statuses, targets),
      }),
    );
  }
  if (!target) {
    errLine(io, USAGE.trimEnd());
    return 1;
  }
  try {
    const st = statuses[target];
    const force = flagOn(flags, "redo");
    if (st?.ok && interactive && !force && io && typeof io.confirm === "function") {
      const again = await io.confirm({
        initialValue: false,
        message: `${target} already ok (${st.extra}). Redo?`,
      });
      if (!again) {
        logLine(io, `skip ${target} (already ok)`);
        logLine(io, formatStatus(statuses, targets));
        return 0;
      }
    }
    await runTarget(target, ctx);
    statuses = await targetStatuses({ ...statusOpts, targets });
    logLine(io, formatStatus(statuses, targets));
    return 0;
  } catch (e) {
    errLine(io, errMessage(e));
    return 1;
  }
}
