import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { readJsonFile } from "../package-json.ts";
import { JSON_INDENT } from "../sync/json.constants.ts";
import {
  CURRENT_DIR,
  EMPTY_MODULE,
  LINT_OK,
  PROBE_ARGS,
  PROBE_FILE,
  PROBE_INPUT,
  PROBE_OUTPUT,
  PROBE_SOURCE,
  PROJECT_DIR_PREFIX,
  TSC_ARGS,
  TSC_MODULE,
  TSCONFIG,
  TSCONFIG_FILE,
  TYPE_IMPORT,
  TYPES_FILE,
  UNINDENTED,
} from "./consumer.constants.ts";
import { exportSubpaths } from "./exports.ts";
import type { Subpath } from "./exports.ts";
import { addedName, addPeers, addSpecs, initProject, installedIn, specOf } from "./install.ts";
import type { Package } from "./install.ts";
import { packTarball } from "./pack.ts";
import type { PackIo } from "./pack.ts";
import { refuse } from "./refuse.ts";
import {
  addFailed,
  CONSUMER_ARGS,
  CONSUMER_PREFIX,
  consumerOk,
  failedProbe,
  noTarball,
  notInTarball,
  probeCrashed,
  typeError,
} from "./release-messages.constants.ts";
import { tarballLint } from "./tarball-lint.ts";

/** The TypeScript compiler's script from this package's install. */
export function tscScript(): string {
  // Bun.resolveSync, not import.meta.resolve: vitest's transform drops the latter, and tests run this in-process.
  return Bun.resolveSync(TSC_MODULE, import.meta.dirname);
}

/** Where `repo release consumer` runs and prints, and the tools it works through. */
export type ConsumerIo = Pick<PackIo, "cwd" | "stdout" | "stderr" | "bun" | "tar" | "tmp" | "mkdtemp" | "list"> & {
  /** Removes a directory and what is in it. */
  rm: (dir: string) => void;
  /** The path of the TypeScript compiler's script, which `bun` runs. */
  tsc: string;
};

function failuresSchema() {
  return z.array(z.object({ key: z.string(), kind: z.string(), message: z.string() }));
}

/** Every file under `dir`, as paths relative to it with `/`. */
function walk(dir: string, base = ""): string[] {
  return fs.readdirSync(path.join(dir, base), { withFileTypes: true }).flatMap((entry) => {
    const rel = base === "" ? entry.name : `${base}/${entry.name}`;

    return entry.isDirectory() ? walk(dir, rel) : [rel];
  });
}

/** The package installed in `project` and the subpaths whose files are in it. */
type Installed = { project: string; name: string; present: Subpath[] };

/** Imports or resolves each subpath in a `bun` child of `project`; the line for each that fails. */
function probeImports({ project, name, present }: Installed, io: ConsumerIo): string[] {
  fs.writeFileSync(path.join(project, PROBE_FILE), PROBE_SOURCE);
  const items = present.map((subpath) => ({ key: subpath.key, kind: subpath.kind, spec: specOf(name, subpath) }));
  fs.writeFileSync(path.join(project, PROBE_INPUT), JSON.stringify(items));
  const probe = io.bun(PROBE_ARGS, project);
  const output = path.join(project, PROBE_OUTPUT);

  if (!fs.existsSync(output)) return [probeCrashed(probe.code, probe.stderr.trim())];

  return readJsonFile(output, failuresSchema()).map((failure) =>
    failedProbe(failure.key, failure.kind, failure.message),
  );
}

/** Type-checks an `import type` of every subpath with a types target; the line for each tsc error. */
function checkTypes({ project, name, present }: Installed, io: ConsumerIo): string[] {
  const typed = present.filter((subpath) => subpath.types !== null);
  const imports = typed.map((subpath, index) => TYPE_IMPORT(index, specOf(name, subpath)));
  const importLines = imports.join("");
  fs.writeFileSync(path.join(project, TYPES_FILE), importLines === "" ? EMPTY_MODULE : importLines);
  fs.writeFileSync(path.join(project, TSCONFIG_FILE), `${JSON.stringify(TSCONFIG, null, JSON_INDENT)}\n`);
  const tsc = io.bun(TSC_ARGS(io.tsc), project);

  if (tsc.code === 0) return [];

  return `${tsc.stdout}${tsc.stderr}`
    .split("\n")
    .filter((line) => UNINDENTED.test(line))
    .map(typeError);
}

/** The lines a tarball earns once installed in `project`: the problems with its exports, imports and types. */
function testInstalled(project: string, pkg: Package, io: ConsumerIo): { summary: string; problems: string[] } {
  const { name, root, installed } = pkg;
  const files = walk(root);
  const expanded = exportSubpaths(installed.exports, files);
  const missing = expanded.subpaths.filter((subpath) => !files.includes(subpath.runtime.slice(CURRENT_DIR.length)));
  const present = expanded.subpaths.filter((subpath) => !missing.includes(subpath));
  const target = { name, present, project };

  const problems = [
    ...expanded.errors,
    ...missing.map((subpath) => notInTarball(subpath.key, subpath.runtime.slice(CURRENT_DIR.length))),
    ...probeImports(target, io),
    ...checkTypes(target, io),
  ];

  const summary = consumerOk(`${name}@${installed.version}`, expanded.exports, expanded.subpaths.length);

  return { problems, summary };
}

/**
 * `repo release consumer [<tarball>]`: installs the tarball of this checkout (or the one given) in an empty project
 * and tests every export.
 */
export async function releaseConsumer(argv: readonly string[], io: ConsumerIo): Promise<number> {
  if (argv.length > 1) return refuse(io, CONSUMER_PREFIX, CONSUMER_ARGS);
  const packDirs: string[] = [];

  function mkdtemp(prefix: string): string {
    const dir = io.mkdtemp(prefix);
    packDirs.push(dir);

    return dir;
  }

  const packIo = { ...io, mkdtemp };

  try {
    return await consumeTarball(argv[0], packIo, io);
  } finally {
    for (const dir of packDirs) io.rm(dir);
  }
}

/** Packs (into a directory the caller removes) or finds the tarball, installs it in a project and tests it. */
async function consumeTarball(given: string | undefined, packIo: ConsumerIo, io: ConsumerIo): Promise<number> {
  let tarball: string;

  if (given === undefined) {
    const packed = packTarball(packIo);

    if (typeof packed === "string") return refuse(io, CONSUMER_PREFIX, packed);
    tarball = packed.tarball;
  } else {
    tarball = path.resolve(io.cwd, given);

    if (!fs.existsSync(tarball)) return refuse(io, CONSUMER_PREFIX, noTarball(tarball));
  }

  const project = io.mkdtemp(path.join(io.tmp, PROJECT_DIR_PREFIX));

  try {
    initProject(project);
    const added = addSpecs(project, [tarball], io);

    if (added !== null) return refuse(io, CONSUMER_PREFIX, addFailed(added));
    const pkg = installedIn(project, addedName(project));
    const peerFailure = addPeers(project, pkg, io);

    if (peerFailure !== null) return refuse(io, CONSUMER_PREFIX, addFailed(peerFailure));
    const tested = testInstalled(project, pkg, io);
    const problems = [...tested.problems, ...(await tarballLint(tarball))];

    for (const problem of problems) io.stderr(`${CONSUMER_PREFIX}${problem}\n`);

    if (problems.length > 0) return 1;
    io.stdout(`${CONSUMER_PREFIX}${tested.summary}${LINT_OK}\n`);

    return 0;
  } finally {
    io.rm(project);
  }
}
