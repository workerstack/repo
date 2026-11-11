import type { MapConfig } from "./folder-map.types.ts";

/** The default token budget, deepest cap and leaf-dir count that folds. */
const BUDGET = 5000;
const DEPTH_CAP = 6;
const FOLD_AT = 12;

/** The map's knobs when `.repo/map.jsonc` sets none. */
export const DEFAULTS: Readonly<MapConfig> = /* @__PURE__ */ Object.freeze({
  budget: BUDGET,
  codeExt: ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "sql", "vue", "svelte", "astro"],
  depthCap: DEPTH_CAP,
  exclude: [],
  foldAt: FOLD_AT,
  include: [],
  skip: [
    "_gen",
    "gen",
    "generated",
    "dist",
    "build",
    "assets",
    "static",
    "public",
    "fixtures",
    "__fixtures__",
    "__snapshots__",
    "__mocks__",
    "testdata",
    "vendor",
    "migrations",
    "locales",
    "i18n",
  ],
});

/** Where a repo sets its map knobs. */
export const CONFIG_REL = ".repo/map.jsonc";
/** The config keys that take a positive number, and those that take a list of strings. */
export const NUMBER_KEYS: readonly ["budget", "depthCap", "foldAt"] = ["budget", "depthCap", "foldAt"];
export const LIST_KEYS: readonly ["codeExt", "skip", "include", "exclude"] = ["codeExt", "skip", "include", "exclude"];

/** The files that make a dir a package root, and the two whose name is read its own way. */
export const PACKAGE_JSON = "package.json";
export const GO_MOD = "go.mod";
export const MANIFESTS: readonly string[] = [PACKAGE_JSON, GO_MOD, "Cargo.toml", "pyproject.toml"];
/** The dirname of a file at the repo top. */
export const TOP_DIR = ".";
/** git lists every file in one call; its output may be large. */
export const GIT_MAX_BUFFER: number = 256 * 1024 * 1024;
/** How many leaf dirs a fold row names. */
export const FOLD_SHOWN = 6;
/** The characters one token stands for. */
export const CHARS_PER_TOKEN = 4;
