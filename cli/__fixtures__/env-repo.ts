/**
 * The world the `bun repo env` tests run in: a real temp git repo named `acme`, a temp HOME beside it holding
 * `~/.workerstack/keys`, `@workerstack/repo` linked to this checkout so env files import `@workerstack/repo/env`, and
 * a runner that hands an env module's `main(argv, deps)` fake deps and records what it printed and started. Every
 * value and key is made in the test. The deps every env module's main takes (env-command, env-edit, env-keys,
 * env-values):
 *
 *   type EnvDeps = {
 *     cwd?: string;                                      // where the command runs; the repo is its git toplevel
 *     home?: string;                                     // HOME: ~/.workerstack/keys lives here
 *     env?: Record<string, string | undefined>;          // process variables read (WORKERSTACK_ENV_KEY)
 *     stdout?: (s: string) => void;
 *     stderr?: (s: string) => void;
 *     stdin?: () => Promise<string>;                     // the whole of a piped stdin
 *     isTTY?: boolean;                                   // stdin is a terminal: read through `prompt` instead
 *     prompt?: (message: string) => Promise<string>;     // a hidden prompt (prompt.ts `password`)
 *     gh?: (args: string[], cwd: string, input: string) => Captured;    // `input` is gh's stdin
 *     spawn?: (command: string[], options: { cwd: string; env: Record<string, string> }) => Promise<number>;
 *   };
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, vi } from "vitest";

import { newIdentity, reveal, seal, type AgeKeyPair } from "../env/age.ts";
import type { EnvDeps } from "../scripts/env-io.ts";

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The shop's env file, where most cases keep their values. */
export const ENV_REL = "projects/shop/env.ts";
/** The keys file at the repo root. */
export const KEYS_JSON = ".repo/env.keys.json";
/** The repo's key file under HOME. */
export const KEY_REL = ".workerstack/keys/acme.key";
/** The repo's key file as the lines name it. */
export const KEY_LABEL = "~/.workerstack/keys/acme.key";
/** What a refusal for a missing keys file prints. */
export const NO_KEYS_FILE = "repo env: no .repo/env.keys.json; run `bun repo env init`\n";
/** What a bad command line prints. */
export const USAGE =
  "usage: bun repo env init | set KEY --scope <global|local|dev|prod> [--plain] [--file f] | " +
  "get KEY --scope s [--reveal] | ls | run --scope s -- cmd | export --scope s --format dotenv | " +
  "key import | key ci [--dry-run]\n";
/** The import of an env file that seals nothing. */
export const IMPORT = 'import { defineEnv } from "@workerstack/repo/env";\n';
/** The import of an env file that seals. */
export const IMPORT_SEALED = 'import { defineEnv, sealed } from "@workerstack/repo/env";\n';
/** Room for the age work and the git runs a case does. */
export const SPAWN = { timeout: 30_000 };

const roots: string[] = [];

/**
 * Per test: removes the repos `envRepo` made, and points the process HOME at an empty dir with no
 * WORKERSTACK_ENV_KEY, so a command that skips `deps.home` finds no key and never a real one.
 */
export function useEnvRepos(): void {
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of roots.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
  });
  beforeEach(() => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "env-elsewhere-"));
    roots.push(elsewhere);
    vi.stubEnv("HOME", elsewhere);
    vi.stubEnv("WORKERSTACK_ENV_KEY", undefined);
  });
}

/** A fake secret, new per call: never a real key. */
export function fakeSecret(): string {
  return `${["sk", "test", "fake"].join("_")}${crypto.randomUUID().replaceAll("-", "")}`;
}

/** The repo, its HOME, and the key pair its keys file names (undefined when it has none). */
export type EnvWorld = { repo: string; home: string; key: AgeKeyPair | undefined };

/** The files a repo is planted with, given the key pair its keys file names. */
type Files = Record<string, string> | ((key: AgeKeyPair) => Promise<Record<string, string>>);

/** How `envRepo` plants the repo. */
export type Plant = {
  /** Written and tracked. */
  files?: Files;
  /** Written after the add, so git does not track them. */
  untracked?: Record<string, string>;
  /** A keys file naming a new key pair, that key at HOME; true by default. */
  keyed?: boolean;
  /** The key at HOME instead of the repo's: another pair, or null for an empty keys dir. */
  homeKey?: AgeKeyPair | null;
  /** `.gitignore`, `node_modules/@workerstack/repo` and `git add -A`; true by default. */
  linked?: boolean;
};

/** Writes `files` (relative path to text) under `root`. */
function put(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

/** Writes `.repo/env.keys.json` for `recipient` in `repo`. */
export function keysFileFor(repo: string, recipient: string): void {
  put(repo, { [KEYS_JSON]: `${JSON.stringify({ recipient, repo: "acme" }, null, 2)}\n` });
}

/** Writes `identity` as the key file `name` under HOME's keys dir, 0600. */
export function keyFileIn(home: string, name: string, identity: string): void {
  const dir = path.join(home, ".workerstack/keys");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `${identity}\n`, { mode: 0o600 });
}

async function filesOf(files: Files, key: AgeKeyPair | undefined): Promise<Record<string, string>> {
  if (typeof files !== "function") return files;
  if (key === undefined) throw new Error("planted files that need a key in a repo with none");
  return files(key);
}

/** A temp git repo `acme` (with an empty `projects/shop`) and a temp HOME beside it, planted as `plant` says. */
export async function envRepo(plant: Plant = {}): Promise<EnvWorld> {
  const { files = {}, untracked = {}, keyed = true, homeKey, linked = true } = plant;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "env-repo-"));
  roots.push(root);
  const repo = path.join(root, "acme");
  const home = path.join(root, "home");
  fs.mkdirSync(path.join(repo, "projects/shop"), { recursive: true });
  fs.mkdirSync(home);
  const key = keyed ? await newIdentity() : undefined;
  if (key !== undefined) keysFileFor(repo, key.recipient);
  put(repo, await filesOf(files, key));
  const held = homeKey === undefined ? key : homeKey;
  if (held === null) fs.mkdirSync(path.join(home, ".workerstack/keys"), { recursive: true });
  else if (held !== undefined) keyFileIn(home, "acme.key", held.identity);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  if (linked) {
    put(repo, { ".gitignore": "node_modules\n" });
    fs.mkdirSync(path.join(repo, "node_modules/@workerstack"), { recursive: true });
    fs.symlinkSync(SELF_ROOT, path.join(repo, "node_modules/@workerstack/repo"), "dir");
    execFileSync("git", ["add", "-A"], { cwd: repo });
  }
  put(repo, untracked);
  return { home, key, repo };
}

/** Writes `files` into `w.repo` and tracks them. */
export function plant(w: EnvWorld, files: Record<string, string>): void {
  put(w.repo, files);
  execFileSync("git", ["add", "-A"], { cwd: w.repo });
}

/** The text of `rel` in `w.repo`, the shop's env file by default. */
export function read(w: EnvWorld, rel = ENV_REL): string {
  return fs.readFileSync(path.join(w.repo, rel), "utf8");
}

/** A gh call the fake recorded: its arguments, directory and stdin. */
export type GhCall = { args: string[]; cwd: string; input: string };
/** A child the fake spawn recorded. */
export type Spawned = { command: string[]; cwd: string; env: Record<string, string> };
/** What a run returned, printed, asked and started, and the process variables it was given, after it ran. */
export type EnvGot = {
  code: number;
  out: string;
  err: string;
  gh: GhCall[];
  prompts: string[];
  spawned: Spawned[];
  env: Record<string, string | undefined>;
};
/** How a run is fed: a piped `stdin` or a terminal answering `tty`, its process variables and its fakes' exits. */
export type RunOptions = {
  cwd?: string;
  stdin?: string;
  tty?: string;
  env?: Record<string, string | undefined>;
  ghCode?: number;
  childCode?: number;
};
/** An env module's entry. */
export type EnvMain = (argv: string[], deps: EnvDeps) => Promise<number>;
/** Runs `argv` through one entry in `w.repo`. */
export type EnvRun = (w: EnvWorld, argv: string[], options?: RunOptions) => Promise<EnvGot>;

function depsFor(w: EnvWorld, options: RunOptions, got: EnvGot): EnvDeps {
  const { stdin, tty, ghCode = 0, childCode = 0 } = options;
  return {
    cwd: options.cwd ?? w.repo,
    env: got.env,
    gh: (args, at, input) => {
      got.gh.push({ args, cwd: at, input });
      return ghCode === 0 ? { code: 0, stderr: "", stdout: "" } : { code: ghCode, stderr: "HTTP 403\n", stdout: "" };
    },
    home: w.home,
    isTTY: tty !== undefined,
    prompt: (message) => {
      got.prompts.push(message);
      return Promise.resolve(tty ?? "");
    },
    spawn: (command, spawnOptions) => {
      got.spawned.push({ command, cwd: spawnOptions.cwd, env: spawnOptions.env });
      return Promise.resolve(childCode);
    },
    stderr: (s) => {
      got.err += s;
    },
    stdin: () => (stdin === undefined ? Promise.reject(new Error("stdin read on a terminal")) : Promise.resolve(stdin)),
    stdout: (s) => {
      got.out += s;
    },
  };
}

/** A runner for `entry`: a piped `stdin` or a terminal answering `tty`, a fake gh exiting `ghCode`, a child `childCode`. */
export function envRunner(entry: EnvMain): EnvRun {
  return async (w, argv, options = {}) => {
    const got: EnvGot = { code: -1, env: { ...options.env }, err: "", gh: [], out: "", prompts: [], spawned: [] };
    got.code = await entry(argv, depsFor(w, options, got));
    return got;
  };
}

/** The first characters of a recipient as the lines print it, `age1qz…`. */
export function short(recipient: string): string {
  return `${recipient.slice(0, 6)}…`;
}

/** The permission bits of `file`. */
export function modeOf(file: string): number {
  return fs.statSync(file).mode & 0o777;
}

/** Whether `identity` opens a value sealed for `recipient`. */
export async function unlocks(identity: string, recipient: string): Promise<boolean> {
  const probe = `probe-${crypto.randomUUID()}`;
  const [text] = await reveal([await seal(probe, recipient)], [identity]);
  return text === probe;
}

/** The cipher `KEY: sealed("…")` holds in `text`. */
export function cipherOf(text: string, key: string): string {
  const found = new RegExp(`${key}: sealed\\("([A-Za-z0-9+/=]+)"\\)`, "u").exec(text)?.[1];
  if (found === undefined) throw new Error(`no sealed ${key} in the file`);
  return found;
}

/** `text` with the cipher of `key` swapped for `CIPHER`, to compare every other byte. */
export function withoutCipher(text: string, key: string): string {
  return text.replace(cipherOf(text, key), "CIPHER");
}

/** `cipher` opened with the repo's key. */
export async function opened(w: EnvWorld, cipher: string): Promise<string> {
  const [text] = await reveal([cipher], [String(w.key?.identity)]);
  return String(text);
}

/** The shop env file, its prod block holding `prod` lines (each `    KEY: value,`). */
export function shopEnv(prod: string[], head = IMPORT): string {
  return [
    head,
    "// The shop's values.",
    "export const shopEnv = defineEnv({",
    "  global: {",
    '    CLOUDFLARE_ACCOUNT_ID: "fake-account",',
    "  },",
    "  local: {},",
    "  dev: {},",
    "  prod: {",
    '    APEX_DOMAIN: "anyrow.com",',
    ...prod,
    "  },",
    "});",
    "",
  ].join("\n");
}

/** A defineEnv file: `blocks` (lines inside the call) under the import of defineEnv and sealed. */
export function envFile(blocks: string[]): string {
  return [
    'import { defineEnv, sealed } from "@workerstack/repo/env";',
    "",
    "export const shopEnv = defineEnv({",
    ...blocks,
    "});",
    "",
  ].join("\n");
}

/** An env file exporting `env = defineEnv(config)`, after `head`. */
export function envOf(config: string, head = IMPORT): string {
  return `${head}export const env = defineEnv(${config});\n`;
}

/** The shop of the Usage: global APEX_DOMAIN plain, prod STRIPE_SECRET_KEY sealed for the repo's key. */
export function shop(secret: string): Plant {
  return {
    files: async (key) => ({
      [ENV_REL]: envFile([
        '  global: { APEX_DOMAIN: "anyrow.io" },',
        "  local: {},",
        "  dev: {},",
        `  prod: { STRIPE_SECRET_KEY: sealed("${await seal(secret, key.recipient)}") },`,
      ]),
      "projects/shop/deploy.ts": [
        'import { shopEnv } from "./env.ts";',
        "",
        "export const deploy = [shopEnv.current.APEX_DOMAIN, shopEnv.prod.STRIPE_SECRET_KEY];",
        "",
      ].join("\n"),
      // Names the key without importing the env file: not a user.
      "projects/shop/other.ts": 'export const name = "STRIPE_SECRET_KEY";\n',
      "projects/shop/seed.ts": [
        'import { shopEnv } from "./env.ts";',
        "",
        "export const key = shopEnv.prod.STRIPE_SECRET_KEY;",
        "",
      ].join("\n"),
    }),
    // Imports the env file and names the key, but git does not track it: not a user.
    untracked: { "projects/shop/draft.ts": 'import { shopEnv } from "./env.ts";\nshopEnv.prod.APEX_DOMAIN;\n' },
  };
}

/** `argv` run through `run` in a repo holding the shop: for the usage cases, which never reach its files. */
export async function inShop(run: EnvRun, argv: string[]): Promise<EnvGot> {
  return run(await envRepo(shop(fakeSecret())), argv);
}

/** Two env files, `a/env.ts` and `b/env.ts`, b declaring `ONLY_B` in prod. */
export function twoFiles(): Plant {
  return {
    files: {
      "a/env.ts": envFile(["  local: {},", "  dev: {},", '  prod: { APEX_DOMAIN: "a.example" },']),
      "b/env.ts": envFile(["  local: {},", "  dev: {},", '  prod: { ONLY_B: "b.example" },']),
    },
  };
}

/** The cells of a table line, split on runs of two or more spaces. */
export function cells(line: string): string[] {
  return line.split(/ {2,}/u);
}
