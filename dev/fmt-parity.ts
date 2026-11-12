#!/usr/bin/env bun
/** Format copies of each named tree with oxfmt and with bun fmt, as is and perturbed; any byte difference fails. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { childEnv } from "../cli/env.ts";
import { capture, captureBun, captureTool } from "../cli/scripts/lint.ts";
import type { Captured } from "../cli/scripts/lint.ts";
import {
  ARGV_START,
  CONFIG_FILE,
  FILE_MODE,
  HEAVY_DIRS,
  NO_CONFIG,
  NOT_GIT,
  PERTURB_BUN_ARGS,
  PERTURB_CONFIG,
  USAGE,
} from "./fmt-parity.constants.ts";
import type { TOOLS } from "./fmt-parity.constants.ts";
import { processIo } from "./process-io.ts";

type Tool = (typeof TOOLS)[number];

export type ParityDeps = { format: Record<Tool, (dir: string) => Captured>; tmp: string };

export type Io = { err: (line: string) => void; out: (line: string) => void };

type Phase = { differing: string[]; name: string };

/** What formatting one tree found: the phases that finished, the files compared and why a phase could not finish. */
type ParityReport = { failure?: string; phases: Phase[]; total: number };

/** One compare: the copy every tool starts from, the files read back and the phase named in a failure. */
type Job = { base: string; files: string[]; phase: string };

type Outcome = { differing: string[] } | { failure: string };

function defaultDeps(): ParityDeps {
  return {
    format: {
      "bun fmt": (dir) => captureBun(["fmt", "--no-script", "."], dir),
      oxfmt: (dir) => captureTool("oxfmt", ["."], dir),
    },
    tmp: os.tmpdir(),
  };
}

function failureOf(phase: string, tool: string, result: Captured): string {
  const last = result.stderr.split("\n").findLast((line) => line.trim() !== "") ?? "";

  return `${phase}: ${tool} exited ${result.code}: ${last.trim()}`;
}

function git(dir: string, args: string[]): Captured {
  return capture("git", args, { cwd: dir, env: childEnv() });
}

/** Every file the formatters could read in `dir`, ignored ones included, without the heavy dirs. */
function listFiles(dir: string): string[] | undefined {
  const listed = git(dir, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  const ignored = git(dir, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard"]);

  if (listed.code !== 0 || ignored.code !== 0) return undefined;

  return [...listed.stdout.split("\0"), ...ignored.stdout.split("\0")]
    .filter((file) => file !== "" && !file.split("/").some((part) => HEAVY_DIRS.includes(part)))
    .filter((file) => fs.statSync(path.join(dir, file), { throwIfNoEntry: false })?.isFile() === true);
}

/** Copies `files` from `from` to `to`, symlinks dereferenced and made writable (sync leaves its files read-only). */
function copyFiles(files: string[], from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });

  for (const file of files) {
    const target = path.join(to, file);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(from, file), target);
    fs.chmodSync(target, FILE_MODE);
  }
}

/** Lays `base` out unlike its config would, with oxfmt then bun fmt, so files only one tool formats still move. */
function perturb(base: string, work: string): string | undefined {
  const config = path.join(work, "perturb.json");

  fs.writeFileSync(config, PERTURB_CONFIG);

  const ox = captureTool("oxfmt", ["-c", config, "."], base);

  if (ox.code !== 0) return failureOf("perturbed", "oxfmt", ox);

  const bun = captureBun([...PERTURB_BUN_ARGS, "."], base);

  return bun.code === 0 ? undefined : failureOf("perturbed", "bun fmt", bun);
}

/** Formats a copy of `base` with each tool and names the files the two copies hold differently. */
function compare(job: Job, deps: ParityDeps): Outcome {
  const { base, files, phase } = job;
  const ox = `${base}-${phase.replaceAll(" ", "-")}-oxfmt`;
  const bun = `${base}-${phase.replaceAll(" ", "-")}-bun`;

  const runs: [Tool, string][] = [
    ["oxfmt", ox],
    ["bun fmt", bun],
  ];

  for (const [tool, copy] of runs) {
    fs.cpSync(base, copy, { recursive: true });

    const result = deps.format[tool](copy);

    if (result.code !== 0) return { failure: failureOf(phase, tool, result) };
  }

  function same(file: string): boolean {
    return fs.readFileSync(path.join(ox, file)).equals(fs.readFileSync(path.join(bun, file)));
  }

  return { differing: files.filter((file) => !same(file)) };
}

/** Formats `files` of `dir` as is and perturbed with both tools; temp dirs go under `deps.tmp` and are removed. */
function parity(dir: string, files: string[], deps: ParityDeps): ParityReport {
  const work = fs.mkdtempSync(path.join(deps.tmp, "fmt-parity-"));
  const report: ParityReport = { phases: [], total: files.length };

  try {
    const base = path.join(work, "base");

    copyFiles(files, dir, base);

    const asIs = compare({ base, files, phase: "as is" }, deps);

    if ("failure" in asIs) return { ...report, failure: asIs.failure };
    report.phases.push({ differing: asIs.differing, name: "as is" });

    const failed = perturb(base, work);

    if (failed !== undefined) return { ...report, failure: failed };

    const moved = compare({ base, files, phase: "perturbed" }, deps);

    if ("failure" in moved) return { ...report, failure: moved.failure };
    report.phases.push({ differing: moved.differing, name: "perturbed" });

    return report;
  } finally {
    fs.rmSync(work, { force: true, recursive: true });
  }
}

function fail(io: Io, line: string): false {
  io.err(line);

  return false;
}

/** Reports one tree on `io`; returns whether both phases found it byte-equal. */
function check(tree: { dir: string; label: string }, io: Io, deps: ParityDeps): boolean {
  const { dir, label } = tree;
  const prefix = `fmt-parity: ${label}`;

  if (!fs.existsSync(dir)) return fail(io, `${prefix} does not exist`);

  if (!fs.existsSync(path.join(dir, CONFIG_FILE))) return fail(io, `${prefix} ${NO_CONFIG}`);

  const files = listFiles(dir);

  if (files === undefined) return fail(io, `${prefix} ${NOT_GIT}`);

  const report = parity(dir, files, deps);

  for (const { differing, name } of report.phases) {
    for (const file of differing) io.out(`${prefix} ${name}: ${file} differs`);
    io.out(`${prefix} ${name}: ${differing.length} of ${report.total} files differ`);
  }

  if (report.failure !== undefined) return fail(io, `${prefix} ${report.failure}`);

  return report.phases.every((phase) => phase.differing.length === 0);
}

/** Checks each named tree (the current dir when none); returns 0 when every tree is byte-equal, else 1. */
export function run(argv: string[], io: Io, deps: ParityDeps = defaultDeps()): number {
  const flag = argv.find((arg) => arg.startsWith("-"));

  if (flag !== undefined) {
    io.err(`fmt-parity: unknown flag ${flag}; ${USAGE}`);

    return 1;
  }

  const trees = argv.length === 0 ? ["."] : argv;
  const results = trees.map((tree) => check({ dir: path.resolve(process.cwd(), tree), label: tree }, io, deps));

  return results.every(Boolean) ? 0 : 1;
}

if (import.meta.main) process.exitCode = run(process.argv.slice(ARGV_START), processIo);
