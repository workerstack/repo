import type { InstallHints, ModelCli } from "./doctor.types.ts";

export const CHROMIUM_BINS: string[] = [
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
const WHISPER_REPO = "https://github.com/ggml-org/whisper.cpp";
const BUN_SITE = "https://bun.sh";
export const REQUIRED = ["bun", "git", "rtk", "lightpanda", "chromium"] as const;
export const MAPS_SECTIONS: string[] = ["refs"];

/** The platforms the hints and PATH lookup tell apart. */
export const WIN32 = "win32";
export const DARWIN = "darwin";

/** The `installHints` id that prints every required tool's hints. */
export const HINT_ALL = "all";

/** Print-only install lines per tool: per platform, else `other`. */
const INSTALL_HINTS = {
  bun: {
    other: ["curl -fsSL https://bun.sh/install | bash", BUN_SITE],
    win32: ['powershell -c "irm bun.sh/install.ps1 | iex"', BUN_SITE],
  },
  chromium: {
    darwin: ["brew install --cask chromium", "brew install --cask google-chrome"],
    other: ["sudo apt install chromium"],
    win32: [
      "winget install Google.Chrome",
      "winget install Microsoft.Edge",
      "add chrome.exe or msedge.exe to PATH or shim",
    ],
  },
  ffmpeg: {
    darwin: ["brew install ffmpeg"],
    other: ["sudo apt install ffmpeg"],
    win32: ["winget install Gyan.FFmpeg"],
  },
  git: { darwin: ["brew install git"], other: ["sudo apt install git"], win32: ["winget install Git.Git"] },
  lightpanda: {
    darwin: [
      LP_INSTALL_SH,
      "brew tap lightpanda-io/browser",
      "brew install lightpanda-io/browser/lightpanda",
      LIGHTPANDA_REPO,
    ],
    other: [LP_INSTALL_SH, LIGHTPANDA_REPO],
    win32: [
      "Windows: native Lightpanda not required; WSL2 only",
      "wsl --install",
      `in WSL: ${LP_INSTALL_SH}`,
      LIGHTPANDA_REPO,
    ],
  },
  rtk: { other: [RTK_CURL, "brew install rtk"], win32: ["rtk.exe on PATH (release zip) or WSL curl", RTK_DOCS] },
  "whisper-cli": {
    darwin: ["brew install whisper-cpp"],
    other: [WHISPER_REPO],
    win32: ["whisper.cpp release: whisper-cli.exe on PATH", WHISPER_REPO],
  },
} as const satisfies Readonly<Record<string, InstallHints>>;

function hasHints(id: string): id is keyof typeof INSTALL_HINTS {
  return Object.hasOwn(INSTALL_HINTS, id);
}

/** The install lines of the tool `id`, or undefined when it has none. */
export function installHintsOf(id: string): InstallHints | undefined {
  return hasHints(id) ? INSTALL_HINTS[id] : undefined;
}

/** The executable suffixes Windows tries when PATHEXT is unset. */
export const PATHEXT_DEFAULT = ".EXE;.CMD;.BAT;.COM";

/** The version parts `versionAtLeast` compares: major, minor, patch. */
export const VERSION_PARTS = 3;

/** How long one `--version` call may take. */
export const VERSION_TIMEOUT_MS = 8000;

/** Floor when no package.json beside the scripts declares `engines.bun` (init copies the scripts into consumers). */
export const BUN_MIN_FALLBACK = "1.4.4";

export const GLOBALS_MANIFEST_REL = "agents/global-settings/manifest.json";
export const GROK_GLOBALS_REL = "agents/global-settings/grok.toml";

/** The width of a row's name and status columns. */
export const ROW_PAD = 18;

export const WORKSPACE_ACCOUNT_RE: RegExp = /^[a-zA-Z0-9_-]{1,40}$/;
export const WORKSPACE_KIND_ORDER: string[] = ["oauth", "tokens", "adc", "clasprc"];

/** The root ignore file, which the redundant-line scan skips. */
export const GITIGNORE = ".gitignore";

/** git's output can be large in a big checkout. */
export const GIT_MAX_BUFFER: number = 256 * 1024 * 1024;

/** Days a worktree may sit unmerged before doctor lists it; the window `commit-push` uses for recent branches. */
export const STALE_DAYS = 7;
export const DAY_SECONDS = 86_400;
export const MS_PER_SECOND = 1000;

/** The shortest `dir/` line that can repeat a bare `dir` line. */
export const MIN_DIR_LINE = 2;
export const NOT_FOUND = -1;

/** A sort comparator's answer when the left item goes first. */
export const SORTS_BEFORE = -1;

/** One overall wait for every CLI's model list. */
export const MODEL_LIST_CAP_MS = 20_000;
export const OFFERED_SHOWN = 6;
export const MODEL_CLIS: ModelCli[] = ["codex", "grok", "agy", "cursor"];

/** A cursor agent's `model: inherit` runs the parent session's model. */
export const INHERIT = "inherit";

/** What the shared cap settles with, so a list that outlasts it reads as capped. */
export const CAPPED = "capped";
export const ENOENT = "ENOENT";

/**
 * The only values agy 1.5.3 accepts for an agent's `model:` (its validator: "unsupported model: %q, must be one of
 * 'inherit', 'flash', 'pro', 'flash_lite'"). Any other value silently drops the agent; `agy models` lists session
 * models, which an agent file cannot name.
 */
export const AGY_AGENT_MODELS: string[] = [INHERIT, "flash", "pro", "flash_lite"];
