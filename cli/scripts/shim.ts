#!/usr/bin/env bun
/**
 * Install a `repo` command into a directory on PATH: a launcher that runs the nearest project's own
 * @workerstack/repo from any directory below it. Applies by default; `--dry-run` only reports, `--check` exits 1
 * when a file is missing or stale. Windows also gets `repo.mjs` and `repo.cmd` for cmd.exe and PowerShell.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { repoEnv } from "../repo-env.ts";
import type { Result } from "../result.ts";
import * as K from "./shim.constants.ts";

type Parsed = { ok: true; check: boolean; dryRun: boolean; dir: string | null } | { ok: false; error: string };

/** What `runShim` reads: the platform's home, PATH and launcher text are all passed in so tests need no real ones. */
export type ShimOpts = {
  argv: readonly string[];
  platform: string;
  home: string;
  localAppData?: string | undefined;
  pathEnv: string | undefined;
  source: string;
};

export type ShimResult = { code: number; out: string[]; err: string[] };

type File = { name: string; body: string; executable: boolean };

type Flags = { check: boolean; dryRun: boolean; dir: string | null };

/** The flags after reading `a` (with `next` after it), and whether `next` was its value. */
type FlagStep = { flags: Flags; tookNext: boolean };

function flagStep(flags: Flags, a: string, next: string | undefined): Result<FlagStep, string> {
  if (a === K.DRY_RUN_FLAG) return { ok: true, value: { flags: { ...flags, dryRun: true }, tookNext: false } };

  if (a === K.CHECK_FLAG) return { ok: true, value: { flags: { ...flags, check: true }, tookNext: false } };

  if (a !== K.DIR_FLAG && !a.startsWith(K.DIR_PREFIX)) return { error: `unknown flag: ${a}`, ok: false };
  const value = a === K.DIR_FLAG ? next : a.slice(K.DIR_PREFIX.length);

  if (value === undefined || value === "") return { error: `${K.DIR_FLAG} needs a path`, ok: false };

  return { ok: true, value: { flags: { ...flags, dir: value }, tookNext: a === K.DIR_FLAG } };
}

export function parseArgv(argv: readonly string[]): Parsed {
  let flags: Flags = { check: false, dir: null, dryRun: false };
  let isTaken = false;

  for (const [i, a] of argv.entries()) {
    if (isTaken) {
      isTaken = false;
      continue;
    }

    const step = flagStep(flags, a, argv[i + 1]);

    if (!step.ok) return step;
    ({ flags, tookNext: isTaken } = step.value);
  }

  if (flags.check && flags.dryRun) return { error: "--check and --dry-run do not combine", ok: false };

  return { ...flags, ok: true };
}

/** Where the launcher goes: `%LOCALAPPDATA%\workerstack\bin` on Windows, `~/.local/bin` elsewhere. */
export function shimDir({
  platform,
  home,
  localAppData,
}: {
  platform: string;
  home: string;
  localAppData?: string | undefined;
}): string {
  if (platform !== K.WINDOWS) return path.join(home, ".local", "bin");
  const base = localAppData === undefined || localAppData === "" ? path.join(home, "AppData", "Local") : localAppData;

  return path.join(base, "workerstack", "bin");
}

/** The files to install: the launcher everywhere, plus `repo.mjs` and `repo.cmd` on Windows. */
function filesFor(platform: string, source: string): File[] {
  const body = source.replaceAll("\r\n", "\n");
  const launcher = { body, executable: true, name: K.LAUNCHER_NAME };

  if (platform !== K.WINDOWS) return [launcher];

  return [
    launcher,
    { body, executable: false, name: K.LAUNCHER_MJS },
    { body: K.CMD_BODY, executable: false, name: K.LAUNCHER_CMD },
  ];
}

function currentText(abs: string): string | null {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

/** A PATH entry as two of them compare: no trailing separator, and no case on Windows. */
function fold(entry: string, platform: string): string {
  return (platform === K.WINDOWS ? entry.toLowerCase() : entry).replace(K.TRAILING_SEPARATORS, "");
}

/** PATH entries split on this host's delimiter, since `pathEnv` is this process's own PATH. */
function pathEntries(pathEnv: string | undefined, platform: string): string[] {
  return (pathEnv ?? "")
    .split(path.delimiter)
    .filter((p) => p !== "")
    .map((p) => fold(p, platform));
}

/** The lines that tell a person how to put `dir` on PATH, one per shell family. */
function pathHint(dir: string, platform: string): string[] {
  if (platform === K.WINDOWS) {
    const user = "$([Environment]::GetEnvironmentVariable('Path','User'))";
    const set = `[Environment]::SetEnvironmentVariable("Path", "${user};${dir}", "User")`;

    return [`${dir} is not on PATH; in PowerShell run:`, `  ${set}`];
  }

  return [`${dir} is not on PATH; add it:`, `  bash, zsh: export PATH="${dir}:$PATH"`, `  fish: fish_add_path ${dir}`];
}

function isOnPath(dir: string, pathEnv: string | undefined, platform: string): boolean {
  return pathEntries(pathEnv, platform).includes(fold(dir, platform));
}

/** The first installed file that is missing or differs from what `repo shim` writes, or null when all match. */
function firstBad(dir: string, files: File[]): { name: string; state: "missing" | "stale" } | null {
  for (const f of files) {
    const text = currentText(path.join(dir, f.name));

    if (text !== f.body) return { name: f.name, state: text === null ? "missing" : "stale" };
  }

  return null;
}

/** `ok`, or why the shim in its default dir is not what `repo shim` would write. */
export function shimState(
  o: Pick<ShimOpts, "platform" | "home" | "localAppData" | "source">,
): "ok" | "missing" | "stale" {
  return firstBad(shimDir(o), filesFor(o.platform, o.source))?.state ?? "ok";
}

function checkFiles(dir: string, files: File[]): ShimResult {
  const bad = firstBad(dir, files);

  if (bad === null) return { code: 0, err: [], out: ["shim ok"] };

  return { code: 1, err: [], out: [`shim drift: ${bad.name} is ${bad.state} (run repo shim)`] };
}

function writeFiles({ dir, files, apply }: { dir: string; files: File[]; apply: boolean }): string[] {
  return files.map((f) => {
    const abs = path.join(dir, f.name);

    if (currentText(abs) === f.body) {
      if (apply && f.executable && process.platform !== K.WINDOWS) fs.chmodSync(abs, K.EXECUTABLE);

      return `${K.UNCHANGED} shim ${abs}`;
    }

    if (apply) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(abs, f.body, f.executable ? { mode: K.EXECUTABLE } : {});

      if (f.executable && process.platform !== K.WINDOWS) fs.chmodSync(abs, K.EXECUTABLE);
    }

    return `${apply ? K.APPLY : K.DRY_RUN} shim ${abs}`;
  });
}

export function runShim(o: ShimOpts): ShimResult {
  const parsed = parseArgv(o.argv);

  if (!parsed.ok) return { code: 1, err: [parsed.error], out: [] };
  const dir = path.resolve(parsed.dir ?? shimDir(o));
  const files = filesFor(o.platform, o.source);

  if (parsed.check) return checkFiles(dir, files);
  const out = writeFiles({ apply: !parsed.dryRun, dir, files });

  const hint = isOnPath(dir, o.pathEnv, o.platform) ? [] : pathHint(dir, o.platform);

  return { code: 0, err: [], out: [...out, ...hint] };
}

export function main(argv: string[]): number {
  const source = fs.readFileSync(fileURLToPath(new URL("shim-launcher.mjs", import.meta.url)), "utf8");

  try {
    const r = runShim({
      argv,
      home: os.homedir(),
      localAppData: repoEnv.process.LOCALAPPDATA,
      pathEnv: repoEnv.process.PATH,
      platform: process.platform,
      source,
    });

    for (const line of r.out) process.stdout.write(`${line}\n`);

    for (const line of r.err) process.stderr.write(`${line}\n`);

    return r.code;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);

    return 1;
  }
}
