/**
 * `bun repo env migrate [--dry-run]`: rewrites each tracked createScriptEnv file to defineEnv, sealing every
 * `secret("v")` and flagged plain literal for `.repo/env.keys.json`'s recipient, and each helper site to its defineEnv
 * form (env-migrate-edit.ts). A call parity cannot reach refuses first (env-migrate-facts.ts), and so does a file to
 * be written with uncommitted changes. Before any write a child process hashes every value the old files hold; then
 * the files are written, parents first, and proved against a fresh child's hashes (env-migrate-write.ts). `--dry-run`
 * reports what would change and writes nothing; a rerun finds nothing to migrate.
 */
import path from "node:path";

import { seal } from "../env/age.ts";
import { parseArgs } from "./env-args.ts";
import { DRY_RUN, EXIT_OK, PREFIX } from "./env-command.constants.ts";
import { guarded, ioOf, keysOrRefuse, refuse, repoRoot, usage, type EnvDeps, type EnvIo } from "./env-io.ts";
import { migrateSource } from "./env-migrate-edit.ts";
import { scriptFacts } from "./env-migrate-facts.ts";
import { hashEnvs } from "./env-migrate-parity.ts";
import { dryRunLines, migratedLines, type Plan } from "./env-migrate-report.ts";
import { isIsolated, scan } from "./env-migrate-scan.ts";
import { refuseUncommitted, writeAll } from "./env-migrate-write.ts";

const SPEC = { command: "none", switches: [DRY_RUN], values: [], words: 0 } as const;
const TS_EXTENSION = /\.[cm]?tsx?$/u;

/** `plans` with each file after the migrating files its `parent:` comes from. */
function parentsFirst(plans: readonly Plan[]): Plan[] {
  const ordered: Plan[] = [];
  const seen = new Set<string>();

  function place(plan: Plan): void {
    if (seen.has(plan.rel)) return;
    seen.add(plan.rel);
    const dir = path.posix.dirname(plan.rel);
    const parents = plan.facts.parents.map((spec) => path.posix.join(dir, spec).replace(TS_EXTENSION, ""));

    for (const other of plans) if (parents.includes(other.rel.replace(TS_EXTENSION, ""))) place(other);
    ordered.push(plan);
  }

  for (const plan of plans) place(plan);

  return ordered;
}

/** Every file of `root` that migrates, rewritten with seals for `recipient`, parents first, and the skips. */
async function plansOf(root: string, recipient: string): Promise<{ plans: Plan[]; skipped: readonly string[] }> {
  const { files, packages, skipped } = scan(root);

  const all = await Promise.all(
    files.map(async ([rel, before]) => {
      const migrated = await migrateSource(before, {
        file: rel,
        isolated: isIsolated(root, rel),
        packages,
        seal: (value: string) => seal(value, recipient),
      });

      return { before, migrated, rel };
    }),
  );

  const changed = all.filter(({ before, migrated }) => migrated.text !== before);

  return {
    plans: parentsFirst(changed.map((plan) => ({ ...plan, facts: scriptFacts(plan.rel, plan.before, packages) }))),
    skipped,
  };
}

/** Runs the migration; see the file comment. */
async function migrate(io: EnvIo, { dryRun }: { dryRun: boolean }): Promise<number> {
  const root = repoRoot(io.cwd);
  const { recipient } = keysOrRefuse(root);
  const { plans, skipped } = await plansOf(root, recipient);

  function print(lines: readonly string[]): number {
    io.stdout(`${lines.join("\n")}\n`);

    return EXIT_OK;
  }

  if (plans.length === 0) return print([`${PREFIX}nothing to migrate`]);

  if (dryRun) return print(dryRunLines(plans, skipped));
  refuseUncommitted(
    root,
    plans.map(({ rel }) => rel),
  );
  const targets = plans.flatMap(({ facts, rel }) => facts.bindings.map((name) => ({ name, rel })));
  const run = { env: { ...io.env, HOME: io.home } };
  const before = await hashEnvs(root, targets, run);

  if (!before.ok) refuse(`could not load ${before.rel} before migrating (${before.reason})`);
  await writeAll(root, plans, { before: before.hashes, host: process, run, stderr: io.stderr, targets });

  return print(migratedLines(plans, targets.length));
}

/** Runs `migrate`; see the file comment. */
export function main(argv: string[], deps?: EnvDeps): Promise<number> {
  const io = ioOf(deps);
  const args = parseArgs(argv.slice(1), SPEC);

  if (args === null) return Promise.resolve(usage(io));

  return guarded(io, () => migrate(io, { dryRun: args.switches.has(DRY_RUN) }));
}
