/**
 * `repo check`'s knip lines: one knip run against the generated config without its ignores, every issue it finds a
 * problem unless a `knip.ignore` entry covers it, each entry reported with its reason, and an entry that matches
 * nothing (before or after the run) refused. The config is written beside `knip.json` for the run and named for the
 * process, so two checks never remove each other's copy.
 */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { readJson } from "./json.ts";
import {
  BINARIES_TYPE,
  DEPENDENCY_TYPES,
  EXIT_BAD_CONFIG,
  FILES_TYPE,
  MANIFEST_FIELDS,
  STDERR_LINES,
  WORDINGS,
  type Wording,
} from "./knip-check.constants.ts";
import type { KnipIgnore } from "./knip-schema.ts";
import { captureBun, type Captured } from "./scripts/lint.ts";
import { standardsWorkspace } from "./standards-workspace.ts";
import { knipConfig } from "./sync/knip-config.ts";
import type { Workspace } from "./sync/workspace.ts";

/** What `repo check` prints of knip: report lines that pass, problem lines that fail it. */
export type KnipCheck = { report: string[]; problems: string[] };

/** Runs knip with `args` in `cwd`; the default spawns the knip this package installs. */
export type KnipRun = (args: string[], cwd: string) => Captured;

/** The knip runner `checkKnipAt` uses unless a test injects another. */
export type KnipDeps = { run?: KnipRun };

/** One knip finding: its file, how its type is worded, name and namespace (an enum's, say). */
type Issue = { file: string; wording: Wording; name: string; namespace: string | undefined };

const NONE: KnipCheck = { problems: [], report: [] };
const FIX_CONFIG = "run `bun repo sync` and check knip.json";

function entrySchema() {
  return z.object({ name: z.string(), namespace: z.string().optional() });
}

function reportSchema() {
  return z.object({ issues: z.array(z.looseObject({ file: z.string() })) });
}

function manifestSchema() {
  return z.object({ bin: z.object({ knip: z.string() }) });
}

function unignoredPath(): string {
  return `knip.unignored-${process.pid}.json`;
}

/** The path of the knip bin in this package's install. */
function knipBin(): string {
  const manifest = Bun.resolveSync("knip/package.json", import.meta.dirname);
  const { bin } = readJson(manifestSchema(), fs.readFileSync(manifest, "utf8"));

  return path.join(path.dirname(manifest), bin.knip);
}

/** The knip runner for real: the resolved bin under bun, with no `GIT_*` variable. */
function runKnip(args: string[], cwd: string): Captured {
  return captureBun([knipBin(), ...args], cwd);
}

/** The issues in knip's json report, in its order; null when `stdout` is not that report. */
function issuesOf(stdout: string): Issue[] | null {
  try {
    const parsed = readJson(reportSchema(), stdout);

    return parsed.issues.flatMap((entry) =>
      WORDINGS.flatMap(
        (wording) =>
          z
            .array(entrySchema())
            .optional()
            .parse(entry[wording.type])
            ?.map(({ name, namespace }) => ({ file: entry.file, name, namespace, wording })) ?? [],
      ),
    );
  } catch {
    return null;
  }
}

/** `knip: <file>: <what is wrong>; <the fix>`. */
function lineOf({ file, wording, name, namespace }: Issue): string {
  const { type, label, fix } = wording;
  const subject = type === FILES_TYPE ? label : `${label} "${namespace === undefined ? name : `${namespace}.${name}`}"`;

  return `knip: ${file}: ${subject}; ${fix}`;
}

/** Whether `ignore` covers `issue`. */
function covers(ignore: KnipIgnore, issue: Issue): boolean {
  if ("file" in ignore) return new Bun.Glob(ignore.file).match(issue.file);

  if ("dependency" in ignore) return DEPENDENCY_TYPES.includes(issue.wording.type) && issue.name === ignore.dependency;

  return issue.wording.type === BINARIES_TYPE && issue.name === ignore.binary;
}

/** `file "x"`, `dependency "x"` or `binary "x"`. */
function kindName(ignore: KnipIgnore): [string, string] {
  if ("file" in ignore) return ["file", ignore.file];

  if ("dependency" in ignore) return ["dependency", ignore.dependency];

  return ["binary", ignore.binary];
}

/** Why `ignore` is stale before knip runs, or null: its file is gone, or no package.json declares its dependency. */
function staleBefore(workspace: Workspace, ignore: KnipIgnore): string | null {
  if ("file" in ignore) {
    const isFound = fs.globSync(ignore.file, { cwd: workspace.root }).length > 0;

    return isFound ? null : `${ignore.file} no longer exists; delete the entry`;
  }

  if (!("dependency" in ignore)) return null;
  const manifests = [workspace.manifest, ...workspace.packages.map((pkg) => pkg.manifest)];

  const declared = manifests.some((manifest) =>
    MANIFEST_FIELDS.some((f) => manifest[f]?.[ignore.dependency] !== undefined),
  );

  return declared ? null : `dependency "${ignore.dependency}" is in no package.json; delete the entry`;
}

/** The last lines of knip's stderr, on one line. */
function tail(stderr: string): string {
  return stderr.trim().split("\n").slice(-STDERR_LINES).join(" ");
}

/** Runs knip on the unignored config, written for the run only. */
function runUnignored(workspace: Workspace, run: KnipRun): Captured {
  const name = unignoredPath();
  const file = path.join(workspace.root, name);

  try {
    fs.writeFileSync(file, knipConfig(workspace, []));

    return run(["--config", name, "--no-exit-code", "--reporter", "json"], workspace.root);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/** The issues no entry of `ignores` covers, and how many each entry covers (an issue two cover counts for both). */
function applyIgnores(ignores: readonly KnipIgnore[], issues: readonly Issue[]) {
  const hits = ignores.map((ignore) => issues.filter((issue) => covers(ignore, issue)).length);

  return { hits, open: issues.filter((issue) => !ignores.some((ignore) => covers(ignore, issue))) };
}

/** The report line for the entries that covered something, and a problem for each live entry that covered nothing. */
function ignoreLines(ignores: readonly KnipIgnore[], hits: readonly number[], stale: readonly (string | null)[]) {
  const unused = ignores.flatMap((ignore, i) => {
    const [kind, name] = kindName(ignore);
    const gone = hits[i] === 0 && stale[i] === null;

    return gone ? [`knip.ignore[${i}]: ${kind} "${name}" has no knip issue any more; delete the entry`] : [];
  });

  const used = ignores.filter((_, i) => hits[i] !== 0);
  const shown = used.map((ignore) => `${kindName(ignore).join(" ")} (${ignore.reason})`);
  const line = `knip: ${used.length} ${used.length === 1 ? "ignore" : "ignores"}: ${shown.join(", ")}`;

  return { report: used.length === 0 ? [] : [line], unused };
}

/**
 * Every issue knip finds in `workspace` is a problem unless an entry of `ignores` covers it. Each covering entry is
 * reported with its reason; one that matches nothing, before or after the run, is a problem.
 */
export function checkKnip(workspace: Workspace, ignores: readonly KnipIgnore[], run: KnipRun): KnipCheck {
  const before = ignores.map((ignore) => staleBefore(workspace, ignore));
  const stale = before.flatMap((why, i) => (why === null ? [] : [`knip.ignore[${i}]: ${why}`]));
  const ran = runUnignored(workspace, run);
  const issues = issuesOf(ran.stdout);

  if (ran.code === EXIT_BAD_CONFIG || issues === null)
    return { problems: [...stale, `knip: exited ${ran.code}: ${tail(ran.stderr)}; ${FIX_CONFIG}`], report: [] };
  const { open, hits } = applyIgnores(ignores, issues);
  const { report, unused } = ignoreLines(ignores, hits, before);

  return { problems: [...stale, ...open.map(lineOf), ...unused], report };
}

/**
 * `repo check`'s knip lines for the repo at `cwd`: none without a config, the standards pack or a readable
 * workspace.
 */
export async function checkKnipAt(cwd: string, deps: KnipDeps = {}): Promise<KnipCheck> {
  const found = await standardsWorkspace(cwd);

  return found === null ? NONE : checkKnip(found.workspace, found.config.knip.ignore, deps.run ?? runKnip);
}
