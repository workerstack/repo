/**
 * `repo mutate`: runs StrykerJS under bun, in place, in a throwaway `git clone --shared` of HEAD so no mutant can touch
 * the checkout, over the tracked files matching `coverage.mutate` or shard `i/n` of them, and writes a report of every
 * file's kills and survivors. A whole run holds each package to its floor in `coverage.mutationFloors`; a shard checks
 * none, and `check <dir>` merges a run's shard reports and does. A typed path is relative to the current directory; the default report is under the repo root.
 */
import path from "node:path";
import { parseArgs, type Shard } from "./mutate-args.ts";
import { checkReports } from "./check-reports.ts";
import { fail, type MutateConfig, type MutateDeps } from "./mutate-deps.ts";
import { selectFiles } from "./mutate-files.ts";
import { judgeRun, plural } from "./mutate-floors.ts";
import { realDeps } from "./mutate-real-deps.ts";
import { survivorCount } from "./mutate-report.ts";
import { runInClone } from "./mutate-run.ts";
import { DEFAULT_REPORT, FAILED, JSON_INDENT, NEWLINE, OK, SHORT_SHA } from "./mutate.constants.ts";

const NOTE = "(uncommitted changes are not mutated)";
const whole = (shard: Shard): boolean => shard.total === 1;

/** The commit to mutate and the tracked files to mutate in it, after saying the commit; or the failing exit code. */
function target(config: MutateConfig, deps: MutateDeps): { sha: string; files: string[] } | number {
  const head = deps.git(config.root, ["rev-parse", "HEAD"]);
  if (head.code !== 0) return fail(deps, `${config.root} has no commit to mutate: ${head.stderr.trim()}`);
  const sha = head.stdout.trim();
  const dirty = deps.git(config.root, ["status", "--porcelain"]).stdout.trim() !== "";
  deps.out(`mutate: HEAD ${sha.slice(0, SHORT_SHA)}${dirty ? ` ${NOTE}` : ""}${NEWLINE}`);
  const tracked = deps.git(config.root, ["ls-tree", "-r", "--name-only", "HEAD"]).stdout.split(NEWLINE);
  const files = selectFiles(tracked, config.mutate);
  if (files.length > 0) return { sha, files };
  const globs = config.mutate.join(", ");
  return fail(deps, `no tracked file matches coverage.mutate (${globs}); set coverage.mutate in workerstack.config.ts`);
}

async function runShard(shard: Shard, typed: string | undefined, deps: MutateDeps): Promise<number> {
  const config = await deps.config(deps.cwd);
  if (Array.isArray(config)) return fail(deps, ...config);
  const found = target(config, deps);
  if (typeof found === "number") return found;
  if (whole(shard)) deps.out(`mutate: ${plural(found.files.length, "file")}, shard 1/1${NEWLINE}`);
  const report = typed ?? DEFAULT_REPORT;
  const reportFile = typed === undefined ? path.join(config.root, report) : path.resolve(deps.cwd, report);
  const ran = runInClone({ root: config.root, sha: found.sha, files: found.files, shard }, deps);
  if (ran === null) return FAILED;
  const json = `${JSON.stringify(ran.report, null, JSON_INDENT)}${NEWLINE}`;
  deps.fs.write(reportFile, json);
  if (whole(shard)) return judgeRun({ report: ran.report, config, shown: report }, deps);
  const files = plural(ran.files, "file");
  const survivors = plural(survivorCount(ran.report.files), "survivor");
  deps.out(`mutate: ${files}, shard ${shard.index}/${shard.total}, ${survivors} in ${report}${NEWLINE}`);
  return OK;
}

/** `repo mutate` with its collaborators injected; the exit code. */
export function runMutate(argv: string[], deps: MutateDeps): Promise<number> {
  const args = parseArgs(argv);
  if (args.kind === "error") return Promise.resolve(fail(deps, args.line));
  return args.kind === "check" ? checkReports(args.dir, args.write, deps) : runShard(args.shard, args.report, deps);
}

/** The registry entry: `repo mutate` in the current directory. */
export function main(argv: string[]): Promise<number> {
  return runMutate(argv, realDeps(process.cwd()));
}
