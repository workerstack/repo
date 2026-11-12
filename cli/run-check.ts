import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CliDeps } from "./cli-deps.ts";
import type { LoadResult } from "./config.ts";
import { repoEnv } from "./repo-env.ts";
import type { SyncIo } from "./sync.ts";

/** Prints check's lines: a report on stdout; a problem on stderr, kept so the exit code can count it. */
type Printer = { report: (lines: readonly string[]) => void; fail: (lines: readonly string[]) => void };

function checkLine(line: string): string {
  return `repo check: ${line}\n`;
}

function printer(failing: string[]): Printer {
  return {
    fail: (lines) => {
      for (const line of lines) process.stderr.write(checkLine(line));
      failing.push(...lines);
    },
    report: (lines) => {
      for (const line of lines) process.stdout.write(checkLine(line));
    },
  };
}

/** Tsconfig bases, env modules, fixture folders and defineEnv values, printed before sync's own lines. */
async function checkSources(cwd: string, print: Printer): Promise<void> {
  // Loaded here so other commands never load typescript.
  const { checkTsconfigs } = await import("./check-tsconfig.ts");
  const { checkEnvModules } = await import("./check-env-modules.ts");
  const { checkFixtures } = await import("./check-fixtures.ts");
  const { checkEnvValues } = await import("./check-env-values.ts");
  const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  print.fail([...checkTsconfigs(cwd, pkgRoot), ...checkEnvModules(cwd), ...checkFixtures(cwd), ...checkEnvValues(cwd)]);
}

/** Manifests and disable comments, under the standards pack. */
async function checkStandards(cwd: string, loaded: LoadResult, print: Printer): Promise<void> {
  const { readWorkspace } = await import("./sync/workspace.ts");
  const { checkManifests } = await import("./check-manifests.ts");
  const { checkComments } = await import("./check-comments.ts");
  const on = loaded.ok && loaded.config.packs.includes("standards");
  const read = on ? readWorkspace(cwd) : undefined;
  // An unreadable manifest is already reported by sync --check.
  print.fail([...(read?.ok === true ? checkManifests(read.workspace) : []), ...(on ? checkComments(cwd) : [])]);
}

/** Public packages, then workspaces under the workspace pack; an unreadable manifest is sync --check's to report. */
async function checkPackages(cwd: string, loaded: LoadResult, print: Printer): Promise<void> {
  if (!loaded.ok) return;
  const { readWorkspace } = await import("./sync/workspace.ts");
  const { checkPublic } = await import("./check-public.ts");
  const { checkWorkspace } = await import("./check-workspace.ts");
  const read = readWorkspace(cwd);

  if (!read.ok) return;
  print.fail(checkPublic(cwd, read.workspace, loaded.config));
  print.fail(loaded.config.packs.includes("workspace") ? checkWorkspace(cwd, read.workspace) : []);
}

/** Reject files, then the script checks; the skip report counts every hit, the baseline only hits no skip turns off. */
async function checkLint(cwd: string, print: Printer): Promise<void> {
  const { checkRejectionsAt, checkScriptsAt } = await import("./script-diagnostics.ts");
  const rejections = await checkRejectionsAt(cwd);
  print.fail(rejections.map((line) => `rejections: ${line}`));
  const scripts = await checkScriptsAt(cwd);
  const { checkLintSkipsAt } = await import("./scripts/lint-skips.ts");
  const skips = await checkLintSkipsAt(cwd, scripts.all);
  print.report(skips.report);
  const { checkLintBaseline } = await import("./scripts/lint-baseline.ts");
  const baseline = await checkLintBaseline(cwd, scripts.kept);
  print.fail([...scripts.problems, ...skips.problems, ...baseline]);
}

/** The Rust supply chain, the nightly workflow, the changelog and the installed version against npm's latest. */
async function checkRelease(cwd: string, loaded: LoadResult, print: Printer): Promise<void> {
  const { supplyChainAt } = await import("./rust/supply-chain.ts");
  print.fail(supplyChainAt(cwd, loaded.ok ? loaded.config.packs : []));
  const { checkNightlyAt } = await import("./check-nightly.ts");
  print.fail(await checkNightlyAt(cwd));
  const { checkChangelog } = await import("./check-changelog.ts");
  print.fail(checkChangelog(cwd));
  const { checkLatestAt, latestRegistry } = await import("./check-latest.ts");
  const latest = await checkLatestAt(cwd, fetch, latestRegistry(repoEnv.process));
  print.report(latest.report);
  print.fail(latest.problems);
}

/** Floors, known failures and the lint baseline held against main, per the config's `coverage` paths. */
async function checkRatchets(root: string, loaded: LoadResult, print: Printer): Promise<void> {
  const { DEFAULT_COVERAGE } = await import("./coverage-config.ts");
  const { ratchetProblems } = await import("./check-ratchets.ts");
  const { knownFailures } = await import("./known-failures.ts");
  const { sourceFiles } = await import("./check-comments.ts");
  const coverage = loaded.ok ? loaded.config.coverage : DEFAULT_COVERAGE;
  const listed = sourceFiles(root);
  // Without a git listing there are no test files to read.
  const files = listed.ok ? listed.files : [];
  print.fail([...ratchetProblems(root, coverage), ...knownFailures(root, files, coverage.knownFailures)]);
}

/** Knip and actionlint, whose reports and problems print after every other check's. */
async function checkTools(cwd: string, print: Printer): Promise<void> {
  const { checkKnipAt } = await import("./knip-check.ts");
  const knip = await checkKnipAt(cwd);
  print.report(knip.report);
  print.fail(knip.problems);
  const { checkActionlintAt } = await import("./actionlint.ts");
  const { problems } = await checkActionlintAt(cwd);
  print.fail(problems);
}

/** `repo check`: every check in order, then exit 1 on any problem, else sync --check's code. */
export async function runCheck(io: SyncIo, deps: Pick<CliDeps, "runSync" | "checkIo">): Promise<void> {
  const { cwd } = io;
  // Started first: the GitHub calls overlap the other checks, which never wait on them.
  const githubPending = import("./github-apply.ts").then(({ checkGithubAt }) => checkGithubAt(cwd, deps.checkIo));
  const failing: string[] = [];
  const print = printer(failing);
  await checkSources(cwd, print);
  const synced = await deps.runSync(["--check"], io);
  const { loadConfig } = await import("./config.ts");
  const loaded = await loadConfig(cwd);
  await checkStandards(cwd, loaded, print);
  await checkPackages(cwd, loaded, print);
  await checkLint(cwd, print);
  await checkRelease(cwd, loaded, print);
  await checkRatchets(cwd, loaded, print);
  await checkTools(cwd, print);
  const github = await githubPending;
  print.report(github.report);
  print.fail(github.problems);
  const code = failing.length > 0 ? 1 : synced;

  if (code !== 0) process.exitCode = code;
}
