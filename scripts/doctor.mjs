#!/usr/bin/env node
/** Unified prereq doctor. Print-only install hints. Never runs installs. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  PACKAGED_SKILLS_REL,
  WORKSPACE_SKILLS_REL,
  findSkillContentConflicts,
  formatSkillConflictWarn,
} from "./skill-conflicts.mjs";

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
const RULESYNC_SCHEMA = "rulesync schema doctor: npm run rulesync:doctor";
const REQUIRED = ["node", "npm", "git", "rtk", "rulesync", "lightpanda", "chromium"];
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
    const keys = ["node", "npm", "git", "rtk", "rulesync", "lightpanda", "chromium"];
    return keys.flatMap((k) => installHints(k, platform));
  }
  if (id === "node") {
    if (platform === "win32") {
      return [`${NODE_URL} (≥22)`, "nvm / OS pkg", "winget install OpenJS.NodeJS.LTS"];
    }
    return [`${NODE_URL} (≥22)`, "nvm / OS pkg"];
  }
  if (id === "npm") {
    return ["npm ships with Node ≥22", NODE_URL];
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
    return ["npm i -D rulesync", "npx"];
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

export function speakDoctorStatus({ env = process.env, home = os.homedir() } = {}) {
  const names = [];
  if (String(env.ELEVENLABS_API_KEY || "").trim()) names.push("elevenlabs");
  if (String(env.OPENAI_API_KEY || "").trim()) names.push("openai");
  const hasFile = isFile(path.join(home, ".grunt", "speak.json"));
  if (!names.length && !hasFile) return { ok: false, extra: "" };
  return { ok: true, extra: names.length ? names.join(",") : "config" };
}

const WORKSPACE_ACCOUNT_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const WORKSPACE_KIND_ORDER = ["oauth", "tokens", "adc", "clasprc"];

export function workspaceDoctorStatus({ home = os.homedir() } = {}) {
  const grunt = path.join(home, ".grunt");
  const kinds = new Set();
  const scanAccountDir = (dir) => {
    if (isFile(path.join(dir, "google-oauth.json"))) kinds.add("oauth");
    if (isFile(path.join(dir, "tokens.json"))) kinds.add("tokens");
  };
  if (isFile(path.join(grunt, "google-oauth.json"))) kinds.add("oauth");
  if (isFile(path.join(grunt, "workspace-tokens.json"))) kinds.add("tokens");
  scanAccountDir(path.join(grunt, "workspace", "default"));
  const root = path.join(grunt, "workspace");
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

/** Product SoT: reference tree or skills (emit-maps in play). No .rulesync / no those trees → bins-only. */
export function mapsRequired(cwd) {
  const rs = path.join(cwd || "", ".rulesync");
  if (!isDir(rs)) return false;
  return isDir(path.join(rs, "reference")) || isDir(path.join(rs, "skills"));
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

  const npm = whichBin("npm", pathEnv, platform);
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
    npm,
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
  lines.push(npm ? row("npm", "ok", npm) : row("npm", "missing"));
  lines.push(git ? row("git", "ok", git) : row("git", "missing"));
  lines.push(rtk ? row("rtk", "ok", rtk) : row("rtk", "missing"));
  lines.push(rulesync ? row("rulesync", "ok", rulesync) : row("rulesync", "missing"));
  lines.push(lightpanda ? row("lightpanda", "ok", lightpanda) : row("lightpanda", "missing"));
  lines.push(chromium ? row("chromium", "ok", chromium) : row("chromium", "missing"));
  lines.push(gh ? row("gh", "ok", gh) : row("gh", "missing (optional)"));
  lines.push(clasp ? row("clasp", "ok", clasp) : row("clasp", "missing (optional)"));
  const workspace = workspaceDoctorStatus({ home });
  lines.push(
    workspace.ok
      ? row("google-workspace", "ok", workspace.extra)
      : row("google-workspace", "missing (optional)"),
  );
  lines.push(ffmpeg ? row("ffmpeg", "ok", ffmpeg) : row("ffmpeg", "missing (optional)"));
  lines.push(
    whisperCli ? row("whisper-cli", "ok", whisperCli) : row("whisper-cli", "missing (optional)"),
  );
  const speak = speakDoctorStatus({ env, home });
  lines.push(speak.ok ? row("speak", "ok", speak.extra) : row("speak", "missing (optional)"));

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
    workspaceSkillsDir: path.join(cwd || "", WORKSPACE_SKILLS_REL),
    packagedSkillsDir: path.join(cwd || "", PACKAGED_SKILLS_REL),
  });
  if (skillConflicts.length) {
    lines.push("");
    lines.push("skill conflicts (warn; re-init overwrites grunt-owned names):");
    for (const c of skillConflicts) {
      lines.push(formatSkillConflictWarn(c.name));
    }
  }

  lines.push("");
  lines.push(RULESYNC_SCHEMA);
  const stdout = `${lines.join("\n")}\n`;
  return { code: missingRequired.length || missingMaps.length ? 1 : 0, stdout, stderr: "" };
}

function main() {
  const r = runDoctor();
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.code);
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile || import.meta.url === pathToFileURL(invoked).href) {
  main();
}
