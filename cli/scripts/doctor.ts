#!/usr/bin/env bun
/** Unified prereq doctor. Print-only install hints. Never runs installs. */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  PACKAGED_SKILLS_REL,
  WORKSPACE_SKILLS_REL,
  findSkillContentConflicts,
  formatSkillConflictWarn,
} from "./skill-conflicts.ts";
import { isRecord } from "./hook-input.ts";
import { INDEX_REL, sectionBody } from "../sync/maps.ts";
import { isSelf } from "../sync/stock.ts";
import { enabledSkills } from "../config.ts";
import { nestedHolds, nestedTmpDirs } from "./clean.ts";
import { redundantIgnoreLines } from "./gitignore-guard.ts";
import { canonicalPath, gitRevParse, resolveRoots } from "./workspace-root.ts";
import { WORKTREE_CMD, defaultBranch, listWorktrees, type WorktreeInfo } from "./worktree.ts";

/** One doctor check's outcome; `extra` is the detail printed after the status. */
export interface DoctorStatus {
  ok: boolean;
  extra: string;
}

/** A workspace leftover and the command that clears exactly it. */
export interface WorkspaceIssue {
  kind: string;
  path: string;
  detail: string;
  clear: string;
}

export interface DoctorResult {
  code: number;
  stdout: string;
  stderr: string;
}

type ModelCli = "codex" | "grok" | "agy" | "cursor";
type ListCli = Exclude<ModelCli, "codex" | "agy">;

/** A model named in a generated agent file, with the CLI that has to offer it. */
interface ModelRef {
  cli: ModelCli;
  file: string;
  model: string;
}

/** What a CLI offers (`ids`), or why it was skipped. */
interface Offered {
  ids?: string[];
  skip?: string;
}

export interface ListResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type ListRunner = (bin: string, args: string[], opts: { signal: AbortSignal }) => Promise<ListResult>;

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const CHROMIUM_BINS = [
  "chromium",
  "chromium-browser",
  "google-chrome",
  "google-chrome-stable",
  "chrome",
  "msedge",
  "microsoft-edge",
];

export const LIGHTPANDA_REPO = "https://github.com/lightpanda-io/browser";
const RTK_CURL = "curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh";
const RTK_DOCS = "https://www.rtk-ai.app/docs/getting-started/installation/";
const LP_INSTALL_SH = "curl -fsSL https://pkg.lightpanda.io/install.sh | bash";
const REQUIRED = ["bun", "git", "rtk", "lightpanda", "chromium"];
const MAPS_SECTIONS = ["skills", "refs"];

function winShim(bin: unknown): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(String(bin || ""));
}

export function whichBin(
  name: string,
  pathEnv: string | undefined = process.env.PATH,
  platform: string = process.platform,
): string {
  if (!name) return "";
  const hostWin = process.platform === "win32";
  const delim = (platform === "win32" || hostWin) && String(pathEnv || "").includes(";") ? ";" : path.delimiter;
  const dirs = String(pathEnv || "").split(delim);
  const names: string[] = [];
  if ((hostWin || platform === "win32") && !path.extname(name)) {
    if (hostWin) {
      const pathext = String(process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM");
      for (const raw of pathext.split(";")) {
        if (!raw) continue;
        names.push(name + raw.toLowerCase());
        names.push(name + raw);
      }
    }
    names.push(`${name}.exe`);
    names.push(name);
  } else {
    names.push(name);
  }
  const uniq = [...new Set(names)];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const n of uniq) {
      const candidate = path.join(dir, n);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        if (hostWin) {
          try {
            fs.accessSync(candidate, fs.constants.F_OK);
            return candidate;
          } catch {
            /* try next */
          }
        }
      }
    }
  }
  return "";
}

function delimOf(pathEnv: string | undefined, platform: string): string {
  return platform === "win32" && String(pathEnv || "").includes(";") ? ";" : path.delimiter;
}

function withNmBin(cwd: string | undefined, pathEnv: string | undefined, platform: string): string {
  const nm = path.join(cwd || "", "node_modules", ".bin");
  const d = delimOf(pathEnv, platform);
  return `${nm}${d}${pathEnv || ""}`;
}

/** Floor when no package.json beside the scripts declares `engines.bun` (init copies the scripts into consumers). */
export const BUN_MIN_FALLBACK = "1.4.4";

/** The `engines.bun` floor from the package.json two levels above this script, as `1.4.4`. */
function bunMinimum(): string {
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    const pkg: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const range = isRecord(pkg) && isRecord(pkg.engines) ? pkg.engines.bun : undefined;
    return /\d+(?:\.\d+){0,2}/.exec(String(range))?.[0] ?? BUN_MIN_FALLBACK;
  } catch {
    return BUN_MIN_FALLBACK;
  }
}

/** True when dotted version `have` (an optional leading `v`) is at least `min`; an unreadable `have` is not. */
function versionAtLeast(have: string, min: string): boolean {
  const a = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(have);
  if (!a) return false;
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = Number(a[i + 1] ?? 0);
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

function readVersion(bin: string, flag: string): string {
  try {
    return String(
      execFileSync(bin, [flag], {
        encoding: "utf8",
        timeout: 8000,
        stdio: ["ignore", "pipe", "pipe"],
        shell: winShim(bin),
      }),
    ).trim();
  } catch {
    return "";
  }
}

function lookupChromium(pathEnv: string | undefined, platform: string): string {
  for (const n of CHROMIUM_BINS) {
    const hit = whichBin(n, pathEnv, platform);
    if (hit) return hit;
  }
  return "";
}

export function installHints(id: string, platform: string = process.platform): string[] {
  if (id === "all") {
    const keys = ["bun", "git", "rtk", "lightpanda", "chromium"];
    return keys.flatMap((k) => installHints(k, platform));
  }
  if (id === "bun") {
    if (platform === "win32") return ['powershell -c "irm bun.sh/install.ps1 | iex"', "https://bun.sh"];
    return ["curl -fsSL https://bun.sh/install | bash", "https://bun.sh"];
  }
  if (id === "git") {
    if (platform === "win32") return ["winget install Git.Git"];
    if (platform === "darwin") return ["brew install git"];
    return ["sudo apt install git"];
  }
  if (id === "rtk") {
    if (platform === "win32") {
      return ["rtk.exe on PATH (release zip) or WSL curl", RTK_DOCS];
    }
    return [RTK_CURL, "brew install rtk"];
  }
  if (id === "lightpanda") {
    if (platform === "win32") {
      return [
        "Windows: native Lightpanda not required; WSL2 only",
        "wsl --install",
        `in WSL: ${LP_INSTALL_SH}`,
        LIGHTPANDA_REPO,
      ];
    }
    if (platform === "darwin") {
      return [
        LP_INSTALL_SH,
        "brew tap lightpanda-io/browser",
        "brew install lightpanda-io/browser/lightpanda",
        LIGHTPANDA_REPO,
      ];
    }
    return [LP_INSTALL_SH, LIGHTPANDA_REPO];
  }
  if (id === "chromium") {
    if (platform === "win32") {
      return [
        "winget install Google.Chrome",
        "winget install Microsoft.Edge",
        "add chrome.exe or msedge.exe to PATH or shim",
      ];
    }
    if (platform === "darwin") {
      return ["brew install --cask chromium", "brew install --cask google-chrome"];
    }
    return ["sudo apt install chromium"];
  }
  if (id === "ffmpeg") {
    if (platform === "win32") return ["winget install Gyan.FFmpeg"];
    if (platform === "darwin") return ["brew install ffmpeg"];
    return ["sudo apt install ffmpeg"];
  }
  if (id === "whisper-cli") {
    if (platform === "win32") {
      return ["whisper.cpp release: whisper-cli.exe on PATH", "https://github.com/ggml-org/whisper.cpp"];
    }
    if (platform === "darwin") return ["brew install whisper-cpp"];
    return ["https://github.com/ggml-org/whisper.cpp"];
  }
  return [];
}

function isFile(abs: string): boolean {
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

export function jevDoctorStatus({
  env = process.env,
  home = os.homedir(),
}: { env?: NodeJS.ProcessEnv; home?: string } = {}): DoctorStatus {
  if (String(env.TYPESAFE_API_KEY || "").trim()) return { ok: true, extra: "env" };
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(home, ".workerstack", "jev.json"), "utf8"));
    if (String(isRecord(parsed) && parsed.apiKey ? parsed.apiKey : "").trim()) {
      return { ok: true, extra: "config" };
    }
  } catch {
    /* absent */
  }
  return { ok: false, extra: "" };
}

export function speakDoctorStatus({
  env = process.env,
  home = os.homedir(),
}: { env?: NodeJS.ProcessEnv; home?: string } = {}): DoctorStatus {
  const names: string[] = [];
  if (String(env.ELEVENLABS_API_KEY || "").trim()) names.push("elevenlabs");
  if (String(env.OPENAI_API_KEY || "").trim()) names.push("openai");
  const hasFile = isFile(path.join(home, ".workerstack", "speak.json"));
  if (!names.length && !hasFile) return { ok: false, extra: "" };
  return { ok: true, extra: names.length ? names.join(",") : "config" };
}

const WORKSPACE_ACCOUNT_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const WORKSPACE_KIND_ORDER = ["oauth", "tokens", "adc", "clasprc"];

export function workspaceDoctorStatus({ home = os.homedir() }: { home?: string } = {}): DoctorStatus {
  const repo = path.join(home, ".workerstack");
  const kinds = new Set<string>();
  const scanAccountDir = (dir: string): void => {
    if (isFile(path.join(dir, "google-oauth.json"))) kinds.add("oauth");
    if (isFile(path.join(dir, "tokens.json"))) kinds.add("tokens");
  };
  const root = path.join(repo, "workspace");
  try {
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory() || !WORKSPACE_ACCOUNT_RE.test(ent.name)) continue;
      scanAccountDir(path.join(root, ent.name));
    }
  } catch {
    /* none */
  }
  if (isFile(path.join(home, ".config", "gcloud", "application_default_credentials.json"))) {
    kinds.add("adc");
  }
  if (isFile(path.join(home, ".clasprc.json"))) kinds.add("clasprc");
  if (!kinds.size) return { ok: false, extra: "" };
  return { ok: true, extra: WORKSPACE_KIND_ORDER.filter((k) => kinds.has(k)).join(",") };
}

function row(name: string, status: string, extra: string = ""): string {
  const a = String(name).padEnd(18);
  const b = String(status).padEnd(18);
  const c = extra ? String(extra).trim() : "";
  return c ? `${a} ${b} ${c}` : `${a} ${b}`;
}

export const GLOBALS_MANIFEST_REL = "agents/global-settings/manifest.json";

/** The package's own root, two levels above `cli/scripts/doctor.ts`: where the stock globals live. */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GROK_GLOBALS_REL = "agents/global-settings/grok.toml";

/**
 * One `globals` row from checkGlobals: ok, the first drift line, or the check error. Null when the
 * repo ships no manifest. check-globals needs smol-toml, which setup.ts (it imports this file)
 * must run without, so it loads here on demand instead of at import.
 */
export async function globalsRow(
  cwd: string | undefined,
  home: string | undefined,
  sourceRoot: string = PACKAGE_ROOT,
): Promise<string | null> {
  if (!fs.existsSync(path.join(sourceRoot, GLOBALS_MANIFEST_REL))) return null;
  let mod: typeof import("./check-globals.ts");
  try {
    mod = await import("./check-globals.ts");
  } catch (err) {
    return row("globals", "unavailable", `${errorText(err).split("\n")[0]}; run bun install`);
  }
  const r = mod.checkGlobals({
    sourceRoot,
    ...(home === undefined ? {} : { home }),
    ...(cwd === undefined ? {} : { workspaceRoot: cwd }),
  });
  if (r.ok) return row("globals", "ok");
  return row("globals", r.drift ? mod.driftLine(r.drift[0]!) : (r.error ?? "")); // drift is only set when non-empty
}

/** The `maps` row: null outside `@workerstack/repo`; otherwise ok when `references/INDEX.md` has both generated marker pairs. */
export function mapsRow(cwd: string | undefined): { line: string; ok: boolean } | null {
  const root = cwd || "";
  if (!isSelf(root)) return null;
  const fix = "run bun repo sync";
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, INDEX_REL), "utf8");
  } catch {
    return { line: row("maps", "missing", `${INDEX_REL} is missing; ${fix}`), ok: false };
  }
  const absent = MAPS_SECTIONS.find((name) => sectionBody(text, name) == null);
  if (absent) return { line: row("maps", "missing", `${INDEX_REL} has no repo:${absent} section; ${fix}`), ok: false };
  return { line: row("maps", "ok", `${INDEX_REL} ${MAPS_SECTIONS.map((n) => `repo:${n}`).join(", ")}`), ok: true };
}

function gitOut(cwd: string, args: string[]): string | null {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function ignoreLines(file: string): string[] {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trimEnd());
  } catch {
    return [];
  }
}

/** Days a worktree may sit unmerged before doctor lists it; the window `commit-push` uses for recent branches. */
const STALE_DAYS = 7;
const DAY_SECONDS = 86_400;

/** Whole days since the branch's last commit when it holds commits the default branch lacks, else null. */
function daysSinceUnmergedCommit(root: string, branch: string, target: string): number | null {
  const ahead = Number(gitOut(root, ["rev-list", "--count", `${target}..refs/heads/${branch}`]));
  const last = Number(gitOut(root, ["log", "-1", "--format=%ct", `refs/heads/${branch}`]));
  return ahead > 0 && last > 0 ? Math.floor((Date.now() / 1000 - last) / DAY_SECONDS) : null;
}

const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * Workspace leftovers (roadmap D9), each with the command that clears exactly it. Reads only; deletes nothing.
 */
export function workspaceIssues({ root, checkout }: { root: string; checkout: string }): WorkspaceIssue[] {
  // resolveRoots already asked git about this dir; the memo saves a spawn.
  const facts = gitRevParse(checkout);
  if (!facts) return [];
  const top = canonicalPath(path.resolve(facts.top));
  const item = (kind: string, p: string, detail: string, clear: string): WorkspaceIssue => ({
    kind,
    path: p,
    detail,
    clear,
  });

  const stray = nestedTmpDirs(root).map((dir) => {
    const holds = nestedHolds(dir);
    return item("stray .tmp/repo", dir, holds ? `holds ${holds}` : "", `rm -r ${dir}`);
  });

  const listed = gitOut(top, ["ls-files", "-co", "--exclude-standard", "-z", "--", ":(glob)**/.gitignore"]) ?? "";
  const redundant: WorkspaceIssue[] = [];
  for (const rel of new Set(listed.split("\0").filter((r) => r && r !== ".gitignore"))) {
    const file = path.join(top, ...rel.split("/"));
    const lines = ignoreLines(file).filter((l) => l && !l.startsWith("#"));
    const hits = lines.length ? redundantIgnoreLines(file, lines) : [];
    if (!hits.length) continue;
    const tracked = gitOut(top, ["ls-files", "--error-unmatch", "--", rel]) !== null;
    const detail = hits.map((h) => `"${h.line}" ignored by ${h.rule}`).join(", ");
    redundant.push(item("redundant .gitignore", file, detail, tracked ? `git -C ${top} rm -q ${rel}` : `rm ${file}`));
  }

  const rootIgnore = path.join(top, ".gitignore");
  const lines = ignoreLines(rootIgnore);
  const duplicate: WorkspaceIssue[] = [];
  lines.forEach((line, i) => {
    if (!line.endsWith("/") || line.startsWith("!") || line.length < 2) return;
    const bare = lines.indexOf(line.slice(0, -1));
    if (bare === -1) return;
    duplicate.push(
      item(
        "duplicate .gitignore line",
        `${rootIgnore}:${i + 1} "${line}"`,
        `"${lines[bare]}" on line ${bare + 1} covers it`,
        `delete line ${i + 1} of ${rootIgnore}`,
      ),
    );
  });

  const worktrees = listWorktrees(root);
  const label = (w: WorktreeInfo): string => w.branch || "detached";
  const missing = worktrees.filter((w) => w.state === "missing");
  const outside = worktrees.filter((w) => w.state !== "missing" && !w.managed);
  const merged = worktrees.filter((w) => w.state === "clean" && w.managed && w.merged);
  const target = defaultBranch(root);
  const stale: { w: WorktreeInfo; days: number }[] = [];
  for (const w of worktrees) {
    if (!w.managed || w.state === "missing" || w.merged || !w.branch) continue;
    const days = daysSinceUnmergedCommit(root, w.branch, target);
    if (days !== null && days >= STALE_DAYS) stale.push({ w, days });
  }
  return [
    ...stray.sort(byPath),
    ...redundant.sort(byPath),
    ...duplicate,
    ...missing.map((w) => item("missing worktree", w.path, label(w), `git -C ${root} worktree prune`)).sort(byPath),
    ...outside
      .map((w) => item("worktree outside .worktrees", w.path, label(w), `git -C ${root} worktree remove ${w.path}`))
      .sort(byPath),
    ...merged.map((w) => item("merged worktree", w.path, label(w), `${WORKTREE_CMD} prune`)).sort(byPath),
    ...stale
      .map(({ w, days }) =>
        item(
          "stale worktree",
          w.path,
          `${w.branch}, last commit ${days} days ago`,
          `${WORKTREE_CMD} finish ${path.basename(w.path)}`,
        ),
      )
      .sort(byPath),
  ];
}

export function workspaceLines(items: WorkspaceIssue[]): string[] {
  if (!items.length) return [row("workspace", "ok")];
  return [
    row("workspace", `${items.length} to clear`, "report only; nothing was deleted"),
    ...items.map((i) => `- ${i.kind} ${i.path}${i.detail ? ` (${i.detail})` : ""}: ${i.clear}`),
  ];
}

/** One overall wait for every CLI's model list. */
const MODEL_LIST_CAP_MS = 20_000;
const OFFERED_SHOWN = 6;
const MODEL_CLIS: ModelCli[] = ["codex", "grok", "agy", "cursor"];

const frontmatterModel = (text: string): string | undefined => {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return fm?.[1] === undefined ? undefined : /^model:[ \t]*["']?([^"'\r\n]+?)["']?[ \t]*$/m.exec(fm[1])?.[1];
};
const tomlModel = (text: string): string | undefined => /^model[ \t]*=[ \t]*"([^"\n]+)"/m.exec(text)?.[1];
/** Values of the `[subagents.models]` table, read without a TOML parser (setup.ts imports this file before smol-toml is installed). */
const subagentModels = (text: string): string[] => {
  const at = text.search(/^\[subagents\.models\][ \t]*$/m);
  if (at < 0) return [];
  const table = text.slice(at).split(/\r?\n/).slice(1);
  const body = table.slice(
    0,
    Math.max(
      0,
      table.findIndex((l) => l.startsWith("[")),
    ) || table.length,
  );
  return body.flatMap((l) => /^[\w-]+[ \t]*=[ \t]*"([^"]+)"/.exec(l)?.[1] ?? []);
};

/**
 * Every model the checkout's generated agent files (plus the grok roles and global settings) name, per CLI.
 * The offered set differs per CLI: codex reads a cache file, agy is a fixed set, grok and cursor run list commands.
 * Claude agents use stable aliases and are not read.
 */
function agentModelRefs(checkout: string, sourceRoot: string): ModelRef[] {
  const refs: ModelRef[] = [];
  const readAt = (root: string, rel: string): string => {
    try {
      return fs.readFileSync(path.join(root, ...rel.split("/")), "utf8");
    } catch {
      return "";
    }
  };
  const read = (rel: string): string => readAt(checkout, rel);
  const dirFiles = (rel: string, ext: string): string[] => {
    try {
      return fs
        .readdirSync(path.join(checkout, ...rel.split("/")))
        .filter((n) => n.endsWith(ext))
        .sort()
        .map((n) => `${rel}/${n}`);
    } catch {
      return [];
    }
  };
  const add = (cli: ModelCli, files: string[], models: (text: string) => (string | undefined)[]): void => {
    for (const file of files) for (const model of models(read(file))) if (model) refs.push({ cli, file, model });
  };
  add("codex", dirFiles(".codex/agents", ".toml"), (t) => [tomlModel(t)]);
  add("grok", dirFiles(".grok/agents", ".md"), (t) => [frontmatterModel(t)]);
  add("grok", dirFiles(".grok/roles", ".toml"), (t) => [tomlModel(t)]);
  for (const model of subagentModels(readAt(sourceRoot, GROK_GLOBALS_REL)))
    if (model) refs.push({ cli: "grok", file: GROK_GLOBALS_REL, model });
  add("agy", dirFiles(".agents/agents", ".md"), (t) => [frontmatterModel(t)]);
  // `inherit` runs the parent session's model, which the account can always use, so it names nothing to check.
  add("cursor", dirFiles(".cursor/agents", ".md"), (t) => [frontmatterModel(t)].filter((m) => m !== "inherit"));
  return refs;
}

const firstGroups = (out: string, re: RegExp): string[] => out.split(/\r?\n/).flatMap((l) => re.exec(l)?.[1] ?? []);
/**
 * The only values agy 1.5.3 accepts for an agent's `model:` (its validator: "unsupported model: %q, must be one of 'inherit', 'flash', 'pro', 'flash_lite'").
 * Any other value silently drops the agent; `agy models` lists session models, which an agent file cannot name.
 */
const AGY_AGENT_MODELS = ["inherit", "flash", "pro", "flash_lite"];
/** Each CLI's list command and how to read ids out of its output. */
const MODEL_LISTS: Record<ListCli, { bin: string; args: string[]; ids: (out: string) => string[] }> = {
  grok: {
    bin: "grok",
    args: ["models"],
    ids: (out) => firstGroups(out.slice(Math.max(0, out.indexOf("Available models:"))), /^\s+(?:\*\s+)?(\S+)/),
  },
  cursor: { bin: "cursor-agent", args: ["--list-models"], ids: (out) => firstGroups(out, /^(\S+) - /) },
};

/** Real list runner: resolves { code, stdout, stderr }; rejects with ENOENT when the CLI is not on PATH, or when the signal aborts it. */
const spawnList: ListRunner = (bin, args, { signal }) => {
  return new Promise<ListResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(bin, args, { signal, stdio: ["ignore", "pipe", "pipe"], shell: winShim(bin) });
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
};

function codexOffered(home: string): Offered {
  const file = path.join(home, ".codex", "models_cache.json");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { skip: `codex models cache missing at ${file}` };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || !Array.isArray(parsed.models)) throw new Error("malformed");
    const ids: string[] = [];
    for (const m of parsed.models) {
      if (!isRecord(m)) throw new Error("malformed");
      if (typeof m.slug === "string" && m.slug) ids.push(m.slug);
    }
    if (ids.length) return { ids };
  } catch {
    /* malformed */
  }
  return { skip: `codex models cache malformed at ${file}` };
}

const CAPPED = Symbol("capped");

/** One CLI's offered ids, or why it is skipped. `capped` settles when the shared cap is over. */
async function listedModels(
  cli: ListCli,
  {
    run,
    signal,
    capped,
    capMs,
  }: { run: ListRunner; signal: AbortSignal; capped: Promise<typeof CAPPED>; capMs: number },
): Promise<Offered> {
  const { bin, args, ids } = MODEL_LISTS[cli];
  try {
    const r = await Promise.race([run(bin, args, { signal }), capped]);
    if (r === CAPPED) return { skip: `${cli} models took over ${capMs / 1000} s` };
    if (r.code !== 0) {
      const first = String(r.stderr || "")
        .split(/\r?\n/)
        .find((l) => l.trim());
      return { skip: `${cli} models failed: ${first ? first.trim() : `exit ${r.code}`}` };
    }
    const found = ids(String(r.stdout || ""));
    return found.length ? { ids: found } : { skip: `${cli} models failed: no models listed` };
  } catch (err) {
    if (isRecord(err) && err.code === "ENOENT") return { skip: `${cli} not installed` };
    return { skip: `${cli} models failed: ${errorText(err).split("\n")[0]}` };
  }
}

/**
 * The `agent models` row: every model an agent file names must be one its CLI still offers.
 * codex is read from its models cache, agy is checked against a fixed set (never skipped), grok and cursor run list commands.
 * Report only. A CLI that is missing, fails, or outlasts the one shared cap is skipped, and the row says so.
 */
export async function agentModelsLines({
  cwd = process.cwd(),
  env = process.env,
  home = os.homedir(),
  run = spawnList,
  capMs = MODEL_LIST_CAP_MS,
  sourceRoot = PACKAGE_ROOT,
}: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  run?: ListRunner;
  capMs?: number;
  sourceRoot?: string;
} = {}): Promise<string[]> {
  const refs = agentModelRefs(resolveRoots({}, { env, cwd }).checkout, sourceRoot);
  const clis = MODEL_CLIS.filter((cli) => refs.some((r) => r.cli === cli));
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capped = new Promise<typeof CAPPED>((resolve) => {
    timer = setTimeout(() => {
      resolve(CAPPED);
      abort.abort();
    }, capMs);
  });
  const ask = { run, signal: abort.signal, capped, capMs };
  const lists = await Promise.all(
    clis.map(async (cli): Promise<[ModelCli, Offered]> => [
      cli,
      cli === "codex" ? codexOffered(home) : cli === "agy" ? { ids: AGY_AGENT_MODELS } : await listedModels(cli, ask),
    ]),
  );
  clearTimeout(timer);
  const offered = new Map(lists);
  const skipped = lists.flatMap(([, l]) => l.skip ?? []);
  const fixes = refs.flatMap(({ cli, file, model }) => {
    const ids = offered.get(cli)!.ids; // every ref's cli is in clis
    if (!ids || ids.includes(model)) return [];
    return `- ${file}: model ${model} is not offered by ${cli}; offered: ${ids.slice(0, OFFERED_SHOWN).join(", ")}`;
  });
  const note = skipped.length ? `(skipped: ${skipped.join("; ")})` : "";
  return fixes.length
    ? [row("agent models", `${fixes.length} to fix`, note), ...fixes]
    : [row("agent models", "ok", note)];
}

export function runDoctor({
  cwd = process.cwd(),
  pathEnv = process.env.PATH,
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  extraLines = [],
  globals = null,
  skills = [],
}: {
  cwd?: string;
  pathEnv?: string | undefined;
  platform?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  extraLines?: string[];
  /** The `globals` row from `globalsRow`, computed by the caller because it loads check-globals on demand. */
  globals?: string | null;
  /** The skill packs the repo enables (`agents.skills`); their tools get a row. */
  skills?: readonly string[];
} = {}): DoctorResult {
  const nmPath = withNmBin(cwd, pathEnv, platform);
  const bunBin = whichBin("bun", pathEnv, platform);
  const bunVer = bunBin ? readVersion(bunBin, "--version") : "";
  const bunMin = bunMinimum();
  const bunOk = Boolean(bunBin) && versionAtLeast(bunVer, bunMin);
  const bun = bunOk ? bunBin : "";
  const git = whichBin("git", pathEnv, platform);
  const rtk = whichBin("rtk", nmPath, platform);
  const lightpanda = whichBin("lightpanda", pathEnv, platform);
  const chromium = lookupChromium(pathEnv, platform);
  const gh = whichBin("gh", pathEnv, platform);
  const clasp = whichBin("clasp", pathEnv, platform);
  const ffmpeg = whichBin("ffmpeg", pathEnv, platform);
  const whisperCli = whichBin("whisper-cli", pathEnv, platform) || whichBin("whisper-cpp", pathEnv, platform);

  const found: Record<string, string> = {
    bun,
    git,
    rtk,
    lightpanda,
    chromium,
  };

  const lines: string[] = [];
  if (bunBin && !bunOk) lines.push(row("bun", `need ≥${bunMin}`, `${bunVer || "unknown"} (${bunBin})`));
  else lines.push(bunOk ? row("bun", "ok", `${bunVer} (${bunBin})`) : row("bun", "missing"));
  lines.push(git ? row("git", "ok", git) : row("git", "missing"));
  lines.push(rtk ? row("rtk", "ok", rtk) : row("rtk", "missing"));
  lines.push(lightpanda ? row("lightpanda", "ok", lightpanda) : row("lightpanda", "missing"));
  lines.push(chromium ? row("chromium", "ok", chromium) : row("chromium", "missing"));
  const enabled = new Set<string>(skills);
  lines.push(gh ? row("gh", "ok", gh) : row("gh", "missing (optional)"));
  if (enabled.has("clasp")) {
    lines.push(clasp ? row("clasp", "ok", clasp) : row("clasp", "missing (optional)"));
  }
  if (enabled.has("google-workspace")) {
    const workspace = workspaceDoctorStatus({ home });
    lines.push(
      workspace.ok ? row("google-workspace", "ok", workspace.extra) : row("google-workspace", "missing (optional)"),
    );
  }
  if (enabled.has("listen")) {
    lines.push(ffmpeg ? row("ffmpeg", "ok", ffmpeg) : row("ffmpeg", "missing (optional)"));
    lines.push(whisperCli ? row("whisper-cli", "ok", whisperCli) : row("whisper-cli", "missing (optional)"));
  }
  if (enabled.has("speak")) {
    const speak = speakDoctorStatus({ env, home });
    lines.push(speak.ok ? row("speak", "ok", speak.extra) : row("speak", "missing (optional)"));
  }
  const jev = jevDoctorStatus({ env, home });
  lines.push(jev.ok ? row("jev", "ok", jev.extra) : row("jev", "missing (optional)"));
  if (globals) lines.push(globals);

  const missingRequired = REQUIRED.filter((k) => !found[k]);
  if (missingRequired.length) {
    lines.push("");
    lines.push("install (print-only; not run):");
    const seen = new Set<string>();
    for (const k of missingRequired) {
      for (const h of installHints(k, platform)) {
        if (seen.has(h)) continue;
        seen.add(h);
        lines.push(h);
      }
    }
  }

  const maps = mapsRow(cwd);
  if (maps) lines.push(maps.line);

  const skillConflicts = findSkillContentConflicts({
    workspaceSkillsDir: path.join(cwd || "", WORKSPACE_SKILLS_REL),
    packagedSkillsDir: path.join(cwd || "", PACKAGED_SKILLS_REL),
  });
  if (skillConflicts.length) {
    lines.push("");
    lines.push("skill conflicts (warn; re-init overwrites repo-owned names):");
    for (const c of skillConflicts) {
      lines.push(formatSkillConflictWarn(c.name));
    }
  }

  lines.push(...workspaceLines(workspaceIssues(resolveRoots({}, { env, cwd }))));
  lines.push(...extraLines);
  const stdout = `${lines.join("\n")}\n`;
  return { code: missingRequired.length || maps?.ok === false ? 1 : 0, stdout, stderr: "" };
}

/** Load the consumer's root `scripts/lib/env.mjs` `loadEnv` when it exists (this script is `cli/scripts/doctor.ts`). */
export async function loadOptionalConsumerEnv(baseHref: string | URL = import.meta.url): Promise<boolean> {
  const file = fileURLToPath(new URL("../../scripts/lib/env.mjs", baseHref));
  if (!fs.existsSync(file)) return false;
  const mod: unknown = await import(pathToFileURL(file).href);
  const loadEnv = isRecord(mod) ? mod.loadEnv : undefined;
  if (typeof loadEnv === "function") loadEnv();
  return true;
}

export async function main(): Promise<number> {
  await loadOptionalConsumerEnv();
  const r = runDoctor({
    extraLines: await agentModelsLines(),
    globals: await globalsRow(process.cwd(), os.homedir()),
    skills: await enabledSkills(process.cwd()),
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r.code;
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(errorText(err) + "\n");
      process.exit(1);
    },
  );
}
