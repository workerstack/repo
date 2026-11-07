#!/usr/bin/env node
/** Unified prereq doctor. Print-only install hints. Never runs installs. */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  PACKAGED_SKILLS_REL,
  SKILLS_SOURCE_REL,
  findSkillContentConflicts,
  formatSkillConflictWarn,
} from "./skill-conflicts.mjs";
import { selectedPacks } from "./feature-packs.mjs";
import { nestedHolds, nestedTmpDirs } from "./clean.mjs";
import { redundantIgnoreLines } from "./gitignore-guard.mjs";
import { canonicalPath, gitRevParse, resolveRoots } from "./workspace-root.mjs";
import { listWorktrees } from "./worktree.mjs";

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
const NODE_URL = "https://nodejs.org";
const RTK_CURL =
  "curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh";
const RTK_DOCS = "https://www.rtk-ai.app/docs/getting-started/installation/";
const LP_INSTALL_SH = "curl -fsSL https://pkg.lightpanda.io/install.sh | bash";
const REQUIRED = ["node", "bun", "git", "rtk", "rulesync", "lightpanda", "chromium"];
export const REQUIRED_MAP_FILES = [
  { name: "INDEX.md", rel: ".rulesync/reference/INDEX.md" },
  { name: "skills-map.md", rel: ".rulesync/reference/skills-map.md" },
  { name: "refs-map.md", rel: ".rulesync/reference/refs-map.md" },
  { name: "law.md", rel: ".rulesync/reference/law.md" },
];

export function nodeMajor(version) {
  const m = String(version || "").match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function winShim(bin) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(String(bin || ""));
}

export function whichBin(name, pathEnv = process.env.PATH, platform = process.platform) {
  if (!name) return "";
  const hostWin = process.platform === "win32";
  const delim =
    (platform === "win32" || hostWin) && String(pathEnv || "").includes(";")
      ? ";"
      : path.delimiter;
  const dirs = String(pathEnv || "").split(delim);
  const names = [];
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

function delimOf(pathEnv, platform) {
  return platform === "win32" && String(pathEnv || "").includes(";") ? ";" : path.delimiter;
}

function withNmBin(cwd, pathEnv, platform) {
  const nm = path.join(cwd || "", "node_modules", ".bin");
  const d = delimOf(pathEnv, platform);
  return `${nm}${d}${pathEnv || ""}`;
}

function readNodeVersion(bin) {
  try {
    return String(
      execFileSync(bin, ["-v"], {
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

function lookupChromium(pathEnv, platform) {
  for (const n of CHROMIUM_BINS) {
    const hit = whichBin(n, pathEnv, platform);
    if (hit) return hit;
  }
  return "";
}

export function installHints(id, platform = process.platform) {
  if (id === "all") {
    const keys = ["node", "bun", "git", "rtk", "rulesync", "lightpanda", "chromium"];
    return keys.flatMap((k) => installHints(k, platform));
  }
  if (id === "node") {
    if (platform === "win32") {
      return [`${NODE_URL} (≥22)`, "nvm / OS pkg", "winget install OpenJS.NodeJS.LTS"];
    }
    return [`${NODE_URL} (≥22)`, "nvm / OS pkg"];
  }
  if (id === "bun") {
    if (platform === "win32") return ["powershell -c \"irm bun.sh/install.ps1 | iex\"", "https://bun.sh"];
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
  if (id === "rulesync") {
    return ["bun add -D rulesync"];
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
      return [LP_INSTALL_SH, "brew tap lightpanda-io/browser", "brew install lightpanda-io/browser/lightpanda", LIGHTPANDA_REPO];
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

function isFile(abs) {
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

export function jevDoctorStatus({ env = process.env, home = os.homedir() } = {}) {
  if (String(env.TYPESAFE_API_KEY || "").trim()) return { ok: true, extra: "env" };
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(home, ".workerstack", "jev.json"), "utf8"));
    if (String(parsed && parsed.apiKey ? parsed.apiKey : "").trim()) {
      return { ok: true, extra: "config" };
    }
  } catch {
    /* absent */
  }
  return { ok: false, extra: "" };
}

export function speakDoctorStatus({ env = process.env, home = os.homedir() } = {}) {
  const names = [];
  if (String(env.ELEVENLABS_API_KEY || "").trim()) names.push("elevenlabs");
  if (String(env.OPENAI_API_KEY || "").trim()) names.push("openai");
  const hasFile = isFile(path.join(home, ".workerstack", "speak.json"));
  if (!names.length && !hasFile) return { ok: false, extra: "" };
  return { ok: true, extra: names.length ? names.join(",") : "config" };
}

const WORKSPACE_ACCOUNT_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const WORKSPACE_KIND_ORDER = ["oauth", "tokens", "adc", "clasprc"];

export function workspaceDoctorStatus({ home = os.homedir() } = {}) {
  const repo = path.join(home, ".workerstack");
  const kinds = new Set();
  const scanAccountDir = (dir) => {
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
  if (
    isFile(path.join(home, ".config", "gcloud", "application_default_credentials.json"))
  ) {
    kinds.add("adc");
  }
  if (isFile(path.join(home, ".clasprc.json"))) kinds.add("clasprc");
  if (!kinds.size) return { ok: false, extra: "" };
  return { ok: true, extra: WORKSPACE_KIND_ORDER.filter((k) => kinds.has(k)).join(",") };
}

function row(name, status, extra = "") {
  const a = String(name).padEnd(18);
  const b = String(status).padEnd(18);
  const c = extra ? String(extra).trim() : "";
  return c ? `${a} ${b} ${c}` : `${a} ${b}`;
}

function mapFilePresent(cwd, rel) {
  try {
    return fs.statSync(path.join(cwd, rel)).isFile();
  } catch {
    return false;
  }
}

function isDir(abs) {
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

export const GLOBALS_MANIFEST_REL = ".rulesync/global-settings/manifest.json";

/**
 * One `globals` row from checkGlobals: ok, the first drift line, or the check error. Null when the
 * repo ships no manifest. check-globals needs smol-toml, which setup.mjs (it imports this file)
 * must run without, so it loads here on demand instead of at import.
 */
export function globalsRow(cwd, home) {
  if (!fs.existsSync(path.join(cwd || "", GLOBALS_MANIFEST_REL))) return null;
  let mod;
  try {
    mod = createRequire(import.meta.url)("./check-globals.mjs");
  } catch (err) {
    return row("globals", "unavailable", `${String(err && err.message).split("\n")[0]}; run bun install`);
  }
  const r = mod.checkGlobals({ home, workspaceRoot: cwd });
  if (r.ok) return row("globals", "ok");
  return row("globals", r.drift ? mod.driftLine(r.drift[0]) : r.error);
}

/** Product SoT: reference tree or skills (emit-maps in play). No .rulesync / no those trees → bins-only. */
export function mapsRequired(cwd) {
  const rs = path.join(cwd || "", ".rulesync");
  if (!isDir(rs)) return false;
  return isDir(path.join(rs, "reference")) || isDir(path.join(cwd, SKILLS_SOURCE_REL));
}

function gitOut(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function ignoreLines(file) {
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trimEnd());
  } catch {
    return [];
  }
}

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * Workspace leftovers (roadmap D9), each with the command that clears exactly it. Reads only; deletes nothing.
 * @returns {Array<{ kind: string, path: string, detail: string, clear: string }>}
 */
export function workspaceIssues({ root, checkout }) {
  // resolveRoots already asked git about this dir; the memo saves a spawn.
  const facts = gitRevParse(checkout);
  if (!facts) return [];
  const top = canonicalPath(path.resolve(facts.top));
  const item = (kind, p, detail, clear) => ({ kind, path: p, detail, clear });

  const stray = nestedTmpDirs(root).map((dir) => {
    const holds = nestedHolds(dir);
    return item("stray .tmp/repo", dir, holds ? `holds ${holds}` : "", `rm -r ${dir}`);
  });

  const listed = gitOut(top, ["ls-files", "-co", "--exclude-standard", "-z", "--", ":(glob)**/.gitignore"]) ?? "";
  const redundant = [];
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
  const duplicate = [];
  lines.forEach((line, i) => {
    if (!line.endsWith("/") || line.startsWith("!") || line.length < 2) return;
    const bare = lines.indexOf(line.slice(0, -1));
    if (bare === -1) return;
    duplicate.push(
      item("duplicate .gitignore line", `${rootIgnore}:${i + 1} "${line}"`, `"${lines[bare]}" on line ${bare + 1} covers it`, `delete line ${i + 1} of ${rootIgnore}`),
    );
  });

  const worktrees = listWorktrees(root);
  const label = (w) => w.branch || "detached";
  const missing = worktrees.filter((w) => w.state === "missing");
  const outside = worktrees.filter((w) => w.state !== "missing" && !w.managed);
  const merged = worktrees.filter((w) => w.state === "clean" && w.managed && w.merged);
  const script = path.join(checkout, ".rulesync", "scripts", "worktree.mjs");
  return [
    ...stray.sort(byPath),
    ...redundant.sort(byPath),
    ...duplicate,
    ...missing.map((w) => item("missing worktree", w.path, label(w), `git -C ${root} worktree prune`)).sort(byPath),
    ...outside.map((w) => item("worktree outside .worktrees", w.path, label(w), `git -C ${root} worktree remove ${w.path}`)).sort(byPath),
    ...merged.map((w) => item("merged worktree", w.path, label(w), `node ${script} prune`)).sort(byPath),
  ];
}

export function workspaceLines(items) {
  if (!items.length) return [row("workspace", "ok")];
  return [
    row("workspace", `${items.length} to clear`, "report only; nothing was deleted"),
    ...items.map((i) => `- ${i.kind} ${i.path}${i.detail ? ` (${i.detail})` : ""}: ${i.clear}`),
  ];
}

export function runDoctor({
  cwd = process.cwd(),
  pathEnv = process.env.PATH,
  platform = process.platform,
  execPath = process.execPath,
  nodeVersion = process.version,
  env = process.env,
  home = os.homedir(),
} = {}) {
  const nmPath = withNmBin(cwd, pathEnv, platform);
  const pathNode = whichBin("node", pathEnv, platform);
  const nodeBin = pathNode || execPath || "";
  let ver = "";
  if (nodeBin) {
    ver =
      execPath && nodeBin === execPath
        ? String(nodeVersion || process.version)
        : readNodeVersion(nodeBin);
  }
  const major = nodeMajor(ver);
  const nodeOk = Boolean(nodeBin) && major >= 22;

  const bun = whichBin("bun", pathEnv, platform);
  const git = whichBin("git", pathEnv, platform);
  const rtk = whichBin("rtk", nmPath, platform);
  const rulesync = whichBin("rulesync", nmPath, platform);
  const lightpanda = whichBin("lightpanda", pathEnv, platform);
  const chromium = lookupChromium(pathEnv, platform);
  const gh = whichBin("gh", pathEnv, platform);
  const clasp = whichBin("clasp", pathEnv, platform);
  const ffmpeg = whichBin("ffmpeg", pathEnv, platform);
  const whisperCli =
    whichBin("whisper-cli", pathEnv, platform) || whichBin("whisper-cpp", pathEnv, platform);

  const found = {
    node: nodeOk ? nodeBin : "",
    bun,
    git,
    rtk,
    rulesync,
    lightpanda,
    chromium,
  };

  const lines = [];
  if (nodeBin && !nodeOk) {
    lines.push(row("node", "need ≥22", `${ver} (${nodeBin})`));
  } else if (nodeOk) {
    lines.push(row("node", "ok", `${ver} (${nodeBin})`));
  } else {
    lines.push(row("node", "missing"));
  }
  lines.push(bun ? row("bun", "ok", bun) : row("bun", "missing"));
  lines.push(git ? row("git", "ok", git) : row("git", "missing"));
  lines.push(rtk ? row("rtk", "ok", rtk) : row("rtk", "missing"));
  lines.push(rulesync ? row("rulesync", "ok", rulesync) : row("rulesync", "missing"));
  lines.push(lightpanda ? row("lightpanda", "ok", lightpanda) : row("lightpanda", "missing"));
  lines.push(chromium ? row("chromium", "ok", chromium) : row("chromium", "missing"));
  const enabled = new Set(selectedPacks(cwd));
  lines.push(gh ? row("gh", "ok", gh) : row("gh", "missing (optional)"));
  if (enabled.has("clasp")) {
    lines.push(clasp ? row("clasp", "ok", clasp) : row("clasp", "missing (optional)"));
  }
  if (enabled.has("google-workspace")) {
    const workspace = workspaceDoctorStatus({ home });
    lines.push(
      workspace.ok
        ? row("google-workspace", "ok", workspace.extra)
        : row("google-workspace", "missing (optional)"),
    );
  }
  if (enabled.has("listen")) {
    lines.push(ffmpeg ? row("ffmpeg", "ok", ffmpeg) : row("ffmpeg", "missing (optional)"));
    lines.push(
      whisperCli ? row("whisper-cli", "ok", whisperCli) : row("whisper-cli", "missing (optional)"),
    );
  }
  if (enabled.has("speak")) {
    const speak = speakDoctorStatus({ env, home });
    lines.push(speak.ok ? row("speak", "ok", speak.extra) : row("speak", "missing (optional)"));
  }
  const jev = jevDoctorStatus({ env, home });
  lines.push(jev.ok ? row("jev", "ok", jev.extra) : row("jev", "missing (optional)"));
  const globals = globalsRow(cwd, home);
  if (globals) lines.push(globals);

  const missingRequired = REQUIRED.filter((k) => (k === "node" ? !nodeOk : !found[k]));
  if (missingRequired.length) {
    lines.push("");
    lines.push("install (print-only; not run):");
    const seen = new Set();
    for (const k of missingRequired) {
      for (const h of installHints(k, platform)) {
        if (seen.has(h)) continue;
        seen.add(h);
        lines.push(h);
      }
    }
  }

  const missingMaps = [];
  if (mapsRequired(cwd)) {
    for (const f of REQUIRED_MAP_FILES) {
      if (mapFilePresent(cwd, f.rel)) {
        lines.push(row(f.name, "ok", f.rel));
      } else {
        missingMaps.push(f);
        lines.push(row(f.name, "missing", f.rel));
      }
    }
    if (missingMaps.length) {
      lines.push(`maps missing: ${missingMaps.map((f) => f.name).join(", ")}`);
    }
  }

  const skillConflicts = findSkillContentConflicts({
    workspaceSkillsDir: path.join(cwd || "", SKILLS_SOURCE_REL),
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

  lines.push("");
  lines.push(`rulesync schema doctor: ${"bunx rulesync doctor"}`);
  const stdout = `${lines.join("\n")}\n`;
  return { code: missingRequired.length || missingMaps.length ? 1 : 0, stdout, stderr: "" };
}

/** Load the consumer's root `scripts/lib/env.mjs` `loadEnv` when it exists (this script is `.rulesync/scripts/doctor.mjs`). */
export async function loadOptionalConsumerEnv(baseHref = import.meta.url) {
  const file = fileURLToPath(new URL("../../scripts/lib/env.mjs", baseHref));
  if (!fs.existsSync(file)) return false;
  const { loadEnv } = await import(pathToFileURL(file).href);
  if (typeof loadEnv === "function") loadEnv();
  return true;
}

async function main() {
  await loadOptionalConsumerEnv();
  const r = runDoctor();
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.code);
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  main().catch((err) => {
    process.stderr.write((err && err.message ? err.message : String(err)) + "\n");
    process.exit(1);
  });
}
