/** The names `repo mutate` and its report share. */

import { FIXTURES_DIR } from "./fixtures.constants.ts";
import { REPO, STATE } from "./repo-dirs.ts";

/** Prefix of the temp dir holding a run's clone, Stryker config and raw report. */
export const TEMP_PREFIX = "workerstack-mutate-";

/** The clone's dir inside the temp dir, so the config and the raw report stay outside it. */
export const CLONE_DIR = "repo";
export const CONFIG_NAME = "stryker.json";
export const RAW_REPORT_NAME = "stryker-report.json";

/** Where an unsharded run writes its report, relative to the repo root. */
export const DEFAULT_REPORT: string = `${REPO}/${STATE}/mutation/report.json`;

/** The spaces a written JSON file is indented with. */
export const JSON_INDENT = 2;
export const OK = 0;
export const FAILED = 1;
export const SHORT_SHA = 7;

/** The manifest a Rust workspace root holds. */
export const CARGO_MANIFEST = "Cargo.toml";

/** The words a flag and its value take. */
export const FLAG_WORDS = 2;
export const FIRST_SHARD = 1;
export const NEWLINE = "\n";
export const JSON_SUFFIX = ".json";

export const CHECK_COMMAND = "check";
export const SHARD_FLAG = "--shard";
export const REPORT_FLAG = "--report";
export const RUST_FLAG = "--rust";
export const WRITE_FLAG = "--write";
export const FLAG_PREFIX = "--";
export const ASSIGN = "=";
export const SHARD_PATTERN: RegExp = /^(\d+)\/(\d+)$/;

/** The package manifests of the mutation tool, read from the clone's install. */
export const STRYKER_CORE = "@stryker-mutator/core";
export const STRYKER_RUNNER = "@stryker-mutator/vitest-runner";
export const MANIFEST = "package.json";

/** The dir `bun install` fills. */
export const INSTALLED_DIR = "node_modules";
export const INSTALL_HINT: string = `bun add -d ${STRYKER_CORE}@10.1.1 ${STRYKER_RUNNER}@10.1.1`;
export const INSTALL_ARGS: readonly string[] = ["install", "--frozen-lockfile"];
export const INSTALL_COMMAND = "bun install --frozen-lockfile";

/** The bun flags that run Stryker's node bin under bun with the preload. */
export const BUN_FLAGS: readonly string[] = ["--bun", "--preload"];
export const STRYKER_BIN_NAME = "stryker";
export const STRYKER_RUN = "run";

/** The globs a mutated file must not match, with the tests (`*.test.*`, `*.spec.*`) and declaration files. */
export const EXCLUDED: readonly RegExp[] = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /* @__PURE__ */ new RegExp(`(^|/)${FIXTURES_DIR}/`),
  /\.d\.ts$/,
];

/** The Stryker options this repo needs; see plan 55's Context for why each is set. */
export const STRYKER_OPTIONS = {
  coverageAnalysis: "perTest",
  disableTypeChecks: false,
  ignoreStatic: true,
  inPlace: true,
  reporters: ["json"],
  testRunner: "vitest",
  vitest: { pool: "forks" },
} as const;

/** Stryker statuses that count as a kill, a survivor, and the rest, which no score counts. */
export const KILLED_STATUSES: readonly string[] = ["Killed", "Timeout"];
export const SURVIVOR_STATUSES: readonly string[] = ["Survived", "NoCoverage"];

/** cargo-mutants outcome summaries that count as a kill and as a survivor; Unviable counts for nothing. */
export const CARGO_KILLED: readonly string[] = ["CaughtMutant", "Timeout"];
export const CARGO_MISSED = "MissedMutant";

/** The package a file belongs to when no workspace package dir holds it. */
export const ROOT_PACKAGE = ".";
export const PERCENT = 100;
export const PERCENT_DIGITS = 2;
export const SEPARATOR = "; ";
export const ARROW = "→";
