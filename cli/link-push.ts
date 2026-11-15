import path from "node:path";

import { checkoutOf, readDependents, unregisterDependent } from "./link-dependents.ts";
import type { LinkContext, LinkTarget } from "./link-io.types.ts";
import { entryOf, readState, writeState, type LinkEntry } from "./link-state.ts";
import {
  EXIT_FAIL,
  NO_DEPENDENTS,
  PUSH_TMP,
  droppedLine,
  notCleanLine,
  pushFailedLine,
  pushedLine,
} from "./link.constants.ts";
import { defaultBranch, git, samePath } from "./scripts/worktree-git.ts";
import { installPacked, packTarget, withTemp } from "./sync-package.ts";

/** One consumer root that still links a package of the source, and the entry its state holds for it. */
type Consumer = { root: string; entry: LinkEntry };

/** One package to pack, and every consumer that gets it. */
type Job = { target: LinkTarget; consumers: Consumer[] };

/** What one job's installs share: the command, the package and the tarball. */
type Pack = { ctx: LinkContext; target: LinkTarget; tarball: string };

/** The jobs to run, and how many roots were recorded before any drop. */
type Plan = { jobs: Job[]; listed: number };

/**
 * The packages to push, one job per package dir. A record whose root is gone, or no longer links that package from
 * that dir, is dropped with a warning. `listed` counts the roots recorded before any drop.
 */
function jobsOf(ctx: LinkContext): Plan {
  const source = ctx.roots.main;
  const dependents = readDependents(source, ctx.io.err);
  const jobs = new Map<string, Job>();

  for (const { packages, root } of dependents) {
    for (const pkg of packages) {
      const entry = entryOf(root, pkg.name);

      if (entry === null || !samePath(entry.source, pkg.dir)) {
        ctx.io.err(droppedLine(root, pkg.name));
        unregisterDependent(source, root, pkg.name);
        continue;
      }

      const key = `${pkg.name}\0${path.resolve(pkg.dir)}`;
      const target = { checkout: checkoutOf(pkg.dir) ?? pkg.dir, dir: pkg.dir, name: pkg.name };
      const job = jobs.get(key) ?? { consumers: [], target };
      jobs.set(key, { ...job, consumers: [...job.consumers, { entry, root }] });
    }
  }

  return { jobs: [...jobs.values()], listed: dependents.length };
}

/** Installs the tarball into one consumer and records the new sync time; true when it worked. */
async function pushOne({ ctx, tarball, target }: Pack, { entry, root }: Consumer): Promise<boolean> {
  try {
    const manifest = await installPacked(root, target, tarball);
    const state = readState(root);
    state[target.name] = { ...entry, syncedAt: ctx.io.now().toISOString() };
    writeState(root, state);
    ctx.io.out(pushedLine(target.name, manifest.version, root));

    return true;
  } catch (error) {
    ctx.io.err(pushFailedLine(target.name, root, (error /* the install steps throw Errors */ as Error).message));

    return false;
  }
}

/** Installs into each consumer in turn, so lines come out in order and one install fails alone. */
async function installAll(pack: Pack, list: Consumer[]): Promise<boolean[]> {
  const [first, ...rest] = list;

  if (first === undefined) return [];
  const done = await pushOne(pack, first);

  return [done, ...(await installAll(pack, rest))];
}

/** Packs the job's package once and installs it into each consumer; a failed pack fails every consumer. */
async function runJob(ctx: LinkContext, { consumers, target }: Job): Promise<boolean[]> {
  try {
    return await withTemp(path.join(ctx.roots.main, PUSH_TMP), (temp) =>
      installAll({ ctx, tarball: packTarget(target, temp), target }, consumers),
    );
  } catch (error) {
    const why = (error /* the pack throws Errors */ as Error).message;

    for (const { root } of consumers) ctx.io.err(pushFailedLine(target.name, root, why));

    return consumers.map(() => false);
  }
}

async function runJobs(ctx: LinkContext, jobs: Job[]): Promise<boolean[]> {
  const [first, ...rest] = jobs;

  if (first === undefined) return [];
  const done = await runJob(ctx, first);

  return [...done, ...(await runJobs(ctx, rest))];
}

/** Pushes every package any dependent links; the roots listed and how many installs failed. */
async function pushAll(ctx: LinkContext): Promise<{ failed: number; listed: number }> {
  const { jobs, listed } = jobsOf(ctx);
  const results = await runJobs(ctx, jobs);

  return { failed: results.filter((worked) => !worked).length, listed };
}

/**
 * `repo link push`: packs each package of this checkout's main checkout that a dependent links, once, and installs
 * it into each dependent that still links it. Exits 1 when any install failed, after the rest have been tried.
 */
export async function pushDependents(ctx: LinkContext): Promise<number> {
  const { failed, listed } = await pushAll(ctx);

  if (listed === 0) ctx.io.out(NO_DEPENDENTS);

  return failed === 0 ? 0 : EXIT_FAIL;
}

const ALL_ZEROS = /^0+$/;

/** The new id when the line moves `ref` to a commit: not another ref, not a deletion, not a no-op; else null. */
function movedTo(line: string, ref: string): string | null {
  const [before, after, name] = line.trim().split(" ");
  const moves = name === ref && before !== after && !ALL_ZEROS.test(String(after));

  return moves ? String(after) : null;
}

/** True when the main checkout has `branch` out at `id` whose tracked files equal that commit. */
function heldClean(main: string, branch: string, id: string): boolean {
  const head = git(main, ["symbolic-ref", "--short", "HEAD"]);
  const at = git(main, ["rev-parse", "HEAD"]);
  // The index may still be the old one while a commit's ref update is announced, so compare the files themselves.
  const same = git(main, ["--no-optional-locks", "diff", "--quiet", id, "--"]);

  return head.ok && head.out === branch && at.ok && at.out === id && same.ok;
}

/**
 * `repo link push --hook`: `stdin` holds git's reference-transaction lines, `<old> <new> <ref>`. Acts only for a move
 * of the default branch, and only when the main checkout holds the new commit clean; else it warns. Always 0.
 */
export async function pushFromHook(ctx: LinkContext, stdin: string): Promise<number> {
  const main = ctx.roots.main;
  const branch = defaultBranch(main);

  const [id] = stdin
    .split("\n")
    .map((line) => movedTo(line, `refs/heads/${branch}`))
    .filter((one) => one !== null);

  if (id === undefined) return 0;

  if (heldClean(main, branch, id)) await pushAll(ctx);
  else ctx.io.err(notCleanLine(main));

  return 0;
}
