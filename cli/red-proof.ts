import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { childEnv } from "./env.ts";
import { NESTED_VITEST_FLAGS } from "./nested-vitest-flags.ts";
import { MAX_BUFFER, REPORT_FAILED, STATUS_ADDED, STATUS_DELETED, STDERR_TAIL_LINES } from "./red-proof.constants.ts";
import { toolEnv } from "./scripts/tool-env.ts";
import { type GitRun, runGit } from "./sync/standards.ts";
import { isCodeFile, isSource, isTestFile } from "./test-files.ts";

/** One `git diff --cached --name-status --no-renames -z` entry: a status letter (A, M, D, T) and a path. */
export type NameStatus = { status: string; path: string };
/** Runs vitest with `args` (after the binary) in `cwd`, giving up after `timeoutMs`; a run that did not finish has a non-zero code. */
export type VitestRun = (args: string[], cwd: string, timeoutMs: number) => { code: number; stderr: string };
export type RedProofDeps = { git?: GitRun; vitest?: VitestRun; timeoutMs?: number };
export type RedProofResult = { ok: true; line: string } | { ok: false; problem: string };

const TIMEOUT_MS = 5 * 60_000;
const NO_FILE =
  "red-proof: no changed vitest test file outside e2e/ to run on HEAD; add one that fails without the change";

/** The entries of `git diff --name-status -z` output. */
export function parseNameStatus(text: string): NameStatus[] {
  const parts = text.split("\0").filter((part) => part !== "");
  return Array.from({ length: parts.length / 2 }, (_, n) => ({
    path: parts[2 * n + 1] /* entries come in status, path pairs */ as string,
    status: parts[2 * n] /* entries come in status, path pairs */ as string,
  }));
}

/** A vitest test file the proof runs: a code file `isTest` matches, outside `e2e/`. */
const isRunnable = (file: string): boolean => isCodeFile(file) && isTestFile(file) && !/(^|\/)e2e\//.test(file);

/** Vitest from the package at `cwd`, run under bun as the package's own tests would; null-free: a run that ends early reports why. */
const runVitest: VitestRun = (args, cwd, timeoutMs) => {
  let manifest: string;
  try {
    manifest = Bun.resolveSync("vitest/package.json", cwd);
  } catch {
    return { code: 1, stderr: `cannot resolve vitest from ${cwd}` };
  }
  const { bin } = JSON.parse(fs.readFileSync(manifest, "utf8")) /* vitest's manifest has a bin map */ as {
    bin: Record<string, string>;
  };
  const script = path.join(path.dirname(manifest), bin["vitest"] /* vitest declares its bin */ as string);
  const result = spawnSync(process.execPath, ["--bun", script, ...args], {
    cwd,
    encoding: "utf8",
    env: toolEnv(childEnv({ NO_COLOR: "1" })),
    maxBuffer: MAX_BUFFER,
    timeout: timeoutMs,
  });
  if (result.error) return { code: 1, stderr: `vitest did not finish within ${timeoutMs}ms (${result.error.message})` };
  return { code: result.status /* null only when result.error is set */ as number, stderr: result.stderr };
};

/** Unpacks a tar file into `cwd`; shaped like a git runner so a failure reads the same. */
const untar: GitRun = (cwd, args) => {
  const result = spawnSync("tar", [...args], { cwd, encoding: "utf8" });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
};

/** The result's stdout, or a throw naming `what` and git's reason. */
function must(what: string, result: ReturnType<GitRun>): string {
  if (result.status !== 0) throw new Error(`red-proof: ${what} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

const ARCHIVE = ".red-proof.tar";

type Tree = { root: string; tree: string; git: GitRun };

/** Unpacks the staged tree into the HEAD tree dir. */
function unpack({ root, tree, git }: Tree): void {
  const archive = path.join(tree, ARCHIVE);
  const sha = must("git write-tree", git(root, ["write-tree"])).trim();
  // No eol conversion: `git show` in putBack writes the blob as is, so the tree must hold blobs as they are too.
  must("git archive", git(root, ["-c", "core.autocrlf=false", "archive", "--format=tar", `--output=${archive}`, sha]));
  // Relative to the tree: GNU tar reads an absolute `C:\\…` as `host:path` and tries to connect to the host `C`.
  must("tar", untar(tree, ["-xf", ARCHIVE]));
}

/** Puts every changed source file back from HEAD, or removes it when new. */
function putBack({ root, tree, git }: Tree, change: NameStatus[]): void {
  for (const { status, path: file } of change.filter((entry) => isSource(entry.path))) {
    const target = path.join(tree, file);
    if (status === STATUS_ADDED) {
      fs.rmSync(target, { force: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, must(`git show HEAD:${file}`, git(root, ["show", `HEAD:${file}`])));
    }
  }
}

/** Links each package dir's checkout `node_modules` into the tree; returns the package dirs (`.` is the root). */
function linkModules({ root, tree, git }: Tree): Set<string> {
  const listed = must("git ls-files", git(root, ["ls-files", "-z", "--", ":(glob)**/package.json"]));
  const dirs = new Set(["."]);
  for (const manifest of listed.split("\0").filter((entry) => entry !== "")) dirs.add(path.dirname(manifest));
  for (const dir of dirs) {
    const modules = path.join(root, dir, "node_modules");
    if (fs.existsSync(modules) && fs.existsSync(path.join(tree, dir)))
      fs.symlinkSync(modules, path.join(tree, dir, "node_modules"), "junction"); // no symlink privilege needed on Windows
  }
  return dirs;
}

/** The nearest package dir at or above the file, `.` when none. */
function ownerOf(file: string, dirs: Set<string>): string {
  let dir = path.dirname(file);
  while (dir !== "." && !dirs.has(dir)) dir = path.dirname(dir);
  return dir;
}

/** The test files grouped by owner package dir, each path relative to that dir. */
function groupByOwner(files: string[], dirs: Set<string>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const dir = ownerOf(file, dirs);
    groups.set(dir, [...(groups.get(dir) ?? []), path.posix.relative(dir, file)]);
  }
  return groups;
}

/** The shape of the vitest json report this reads. */
const reportSchema = () => z.object({ testResults: z.array(z.object({ name: z.string(), status: z.string() })) });

/** The vitest results in the report file, or null when it is missing, unreadable or not a vitest report. */
function readReport(file: string): { name: string; status: string }[] | null {
  try {
    return reportSchema().parse(JSON.parse(fs.readFileSync(file, "utf8"))).testResults;
  } catch {
    return null;
  }
}

type Ran = { problem: string } | { failed: string[]; passed: string[] };
type Run = (args: string[], cwd: string) => ReturnType<VitestRun>;

/** Runs the groups' test files in the HEAD tree; the problem when a run wrote no report, else who failed and who passed. */
function runGroups(tree: string, groups: Map<string, string[]>, vitest: Run): Ran {
  const failed: string[] = [];
  const passed: string[] = [];
  let n = 0;
  for (const [dir, files] of groups) {
    const output = path.join(tree, `.red-proof-report-${n++}.json`);
    const args = ["run", ...files, ...NESTED_VITEST_FLAGS, "--reporter=json", `--outputFile=${output}`];
    const ran = vitest(args, path.join(tree, dir));
    const results = readReport(output);
    if (results === null) {
      const tail = ran.stderr.trim().split("\n").slice(STDERR_TAIL_LINES).join(" | ");
      return { problem: `red-proof: vitest wrote no report in ${dir} (exit ${ran.code}): ${tail}`.trimEnd() };
    }
    for (const file of files) {
      const red = results.some(
        (r) => r.status === REPORT_FAILED && r.name.split(path.sep).join("/").endsWith(`/${file}`),
      );
      (red ? failed : passed).push(path.posix.join(dir, file));
    }
  }
  return { failed, passed };
}

/** Red when any test file failed on HEAD, else a refusal naming the ones that passed. */
function verdict(ran: { failed: string[]; passed: string[] }, total: number): RedProofResult {
  if (ran.failed.length > 0)
    return { line: `red-proof: ${ran.failed.length} of ${total} changed test files failed on HEAD`, ok: true };
  const named = ran.passed.join(", ");
  return {
    ok: false,
    problem: `red-proof: no changed test file fails on HEAD's source (${named} passed); a feat or fix needs one that fails without the change`,
  };
}

/**
 * Runs the changed vitest test files against HEAD's source and says whether one fails there. The staged tree is built
 * under `<root>/.tmp/repo/red-proof-<pid>/` with every changed source file put back; the dir is removed on the way out.
 */
export function redProof(root: string, change: NameStatus[], deps: RedProofDeps = {}): RedProofResult {
  const { git = runGit, vitest = runVitest, timeoutMs = TIMEOUT_MS } = deps;
  if (git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]).status !== 0)
    return { line: "red-proof: skipped, no HEAD to run against", ok: true };
  const tests = change.filter((entry) => entry.status !== STATUS_DELETED && isRunnable(entry.path));
  if (tests.length === 0) return { ok: false, problem: NO_FILE };
  const tree = path.join(root, ".tmp", "repo", `red-proof-${process.pid}`);
  fs.rmSync(tree, { force: true, recursive: true });
  fs.mkdirSync(tree, { recursive: true });
  try {
    const context = { git, root, tree };
    unpack(context);
    putBack(context, change);
    const groups = groupByOwner(
      tests.map((entry) => entry.path),
      linkModules(context),
    );
    const ran = runGroups(tree, groups, (args, cwd) => vitest(args, cwd, timeoutMs));
    return "problem" in ran ? { ok: false, problem: ran.problem } : verdict(ran, tests.length);
  } finally {
    fs.rmSync(tree, { force: true, recursive: true });
  }
}
