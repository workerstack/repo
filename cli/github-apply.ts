import { loadConfig } from "./config.ts";
import { readEnv } from "./env.ts";
import { driftOf } from "./github.ts";
import {
  CHECK_FLAG,
  CHECK_PREFIX,
  CI_SKIP,
  GITHUB_PREFIX,
  GITHUB_USAGE,
  MID_DOT,
  NO_ORIGIN,
  NO_ORIGIN_LINE,
  UP_TO_DATE,
} from "./github.constants.ts";
import { applyFailure, ghRunner, skipReason, type Gh } from "./github-gh.ts";
import { originSlug } from "./github-origin.ts";
import { readCurrent } from "./github-read.ts";
import { wantedAt } from "./github-wanted-at.ts";
import { runWrites, writesFor } from "./github-write.ts";
import type { Drift, Wanted, Current } from "./github.types.ts";

/** What `repo github` runs with: the checkout, the one door to GitHub, and where its lines go. */
export type GithubIo = { cwd: string; gh: Gh; stdout(text: string): void; stderr(text: string): void };
/** What the check side runs with: the door to GitHub, and whether this is CI, whose token cannot read admin settings. */
export type CheckIo = { gh: Gh; ci: boolean };
/** What `repo check` prints: problems fail it, a report line does not. */
export type GithubLines = { problems: string[]; report: string[] };

const realCheckIo = (): CheckIo => ({ gh: ghRunner(), ci: Boolean(readEnv().GITHUB_ACTIONS) });
const say = (text: string) => `${GITHUB_PREFIX} ${text}\n`;

/** Prints each drift as a line and fails; nothing to fix is a pass. */
function reportDrift(slug: string, drifts: readonly Drift[], io: GithubIo): number {
  if (drifts.length === 0) {
    io.stdout(say(`${slug}${MID_DOT}${UP_TO_DATE}`));
    return 0;
  }
  for (const drift of drifts) io.stderr(say(drift.message));
  return 1;
}

type Plan = { slug: string; wanted: Wanted; current: Current };

/** Makes GitHub match what is wanted, changing only what differs; a second run finds nothing to do. */
async function apply({ slug, wanted, current }: Plan, io: GithubIo): Promise<number> {
  const writes = writesFor({ slug, wanted, current, drifts: driftOf(wanted, current) });
  const done = await runWrites(io.gh, writes);
  if (!done.ok) {
    io.stderr(say(applyFailure(slug, done, "change")));
    return 1;
  }
  io.stdout(say([slug, ...(done.parts.length > 0 ? done.parts : [UP_TO_DATE])].join(MID_DOT)));
  return 0;
}

/** `repo github [--check]`: apply the repository's rulesets, security settings and metadata, or only report drift. */
export async function repoGithub(argv: string[], io: GithubIo): Promise<number> {
  const check = argv.length === 1 && argv[0] === CHECK_FLAG;
  if (argv.length > 0 && !check) {
    io.stderr(say(GITHUB_USAGE));
    return 1;
  }
  const slug = originSlug(io.cwd);
  if (slug === null) {
    io.stderr(say(NO_ORIGIN_LINE));
    return 1;
  }
  const wanted = await wantedAt(io.cwd);
  if (!wanted.ok) {
    for (const error of wanted.errors) io.stderr(say(error));
    return 1;
  }
  const read = await readCurrent(io.gh, slug);
  if (!read.ok) {
    io.stderr(say(applyFailure(slug, read, check ? "read" : "change")));
    return 1;
  }
  if (check) return reportDrift(slug, driftOf(wanted.wanted, read.current), io);
  return await apply({ slug, wanted: wanted.wanted, current: read.current }, io);
}

const skipped = (reason: string): GithubLines => ({ problems: [], report: [`${CHECK_PREFIX} skipped, ${reason}`] });

/**
 * The drift of the checkout at `cwd` for `repo check`, under the release pack only: each setting that differs is a problem. When GitHub cannot be
 * read (CI's token, no login, no answer in time, no GitHub origin) it is a skip report, never a failure.
 */
export async function checkGithubAt(cwd: string, io: CheckIo = realCheckIo()): Promise<GithubLines> {
  const loaded = await loadConfig(cwd);
  // Without the release pack there is no CI to require; an unreadable config is already reported by sync --check.
  if (!loaded.ok || !loaded.config.packs.includes("release")) return { problems: [], report: [] };
  if (io.ci) return skipped(CI_SKIP);
  const slug = originSlug(cwd);
  if (slug === null) return skipped(NO_ORIGIN);
  const wanted = await wantedAt(cwd);
  // An unreadable config or manifest is already reported by sync --check.
  if ("unreadable" in wanted) return { problems: [], report: [] };
  if (!wanted.ok) return { problems: wanted.errors.map((error) => `${CHECK_PREFIX} ${error}`), report: [] };
  const read = await readCurrent(io.gh, slug);
  if (!read.ok) return skipped(skipReason(read));
  const problems = driftOf(wanted.wanted, read.current).map((drift) => `${CHECK_PREFIX} ${drift.message}`);
  return { problems, report: [] };
}

/** The `repo github` command. */
export async function main(argv: string[]): Promise<number> {
  const io = {
    cwd: process.cwd(),
    gh: ghRunner(),
    stdout: process.stdout.write.bind(process.stdout),
    stderr: process.stderr.write.bind(process.stderr),
  };
  return await repoGithub(argv, io);
}
