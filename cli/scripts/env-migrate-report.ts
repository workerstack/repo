/**
 * The lines `bun repo env migrate` prints: on `--dry-run`, a line per file (parents first) and per helper site and the
 * skips; after a migration, what moved (and that its values match, when it held an env to prove), a line per key export
 * refuses for its `$`, and the git history line. They
 * name files, keys and counts, never a value.
 */
import { PREFIX } from "./env-command.constants.ts";
import type { Migrated } from "./env-migrate-edit.ts";
import type { ScriptFacts } from "./env-migrate-facts.ts";

/** One file to migrate: where it is, its text, its rewrite, and what main needs of it. */
export type Plan = {
  readonly rel: string;
  readonly before: string;
  readonly migrated: Migrated;
  readonly facts: ScriptFacts;
};

const HELPER_TEXT = { secretKeysOf: "secretKeysOf → sealedKeys", unwrapSecrets: "unwrapSecrets → dropped" } as const;

/** `count` and `word`, with an `s` unless there is one. */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** The report line of a migrating file: its values, what is sealed, what is kept and the spreads left. */
function fileLine({ migrated: { counts }, rel }: Plan): string {
  const credentials = counts.credentials.length;

  const sealing = [
    [counts.secrets, `${counts.secrets} secret()`],
    [credentials, `${plural(credentials, "plain credential")} (${counts.credentials.join(", ")})`],
  ] as const;

  const seals = sealing.filter(([count]) => count > 0).map(([, text]) => text);
  const spreads = Object.entries(counts.spreads).map(([block, count]) => `${plural(count, "spread")} in ${block}`);

  const parts: [boolean, string][] = [
    [true, plural(counts.values, "value")],
    [seals.length > 0, `seal ${seals.join(" and ")}`],
    [counts.plain > 0, `keep ${counts.plain} plain`],
    [spreads.length > 0, `left ${spreads.join(", ")}`],
  ];

  const shown = parts.filter(([isShown]) => isShown).map(([, text]) => text);

  return `  ${rel}: ${shown.join("; ")}`;
}

/** How many files and helper sites `plans` hold. */
function tally(plans: readonly Plan[]): string {
  const files = plans.filter(({ facts }) => facts.calls > 0).length;
  const sites = plans.flatMap(({ migrated }) => migrated.helpers).length;

  return `${plural(files, "file")} and ${plural(sites, "helper site")}`;
}

/** The dry-run report: each file, each helper site, and the skips. */
export function dryRunLines(plans: readonly Plan[], skipped: readonly string[]): string[] {
  const files = plans.filter(({ facts }) => facts.calls > 0).map(fileLine);

  const helpers = plans.flatMap(({ migrated, rel }) =>
    migrated.helpers.map((site) => `  ${rel}:${site.line} ${HELPER_TEXT[site.name]}`),
  );

  const skips = [skipped].filter((list) => list.length > 0).map((list) => `${PREFIX}skipped ${list.join(", ")}`);

  return [`${PREFIX}would migrate ${tally(plans)} (nothing written):`, ...files, ...helpers, ...skips];
}

/** The lines after a migration: what moved, parity when `targets` envs were proved, each `$` key, and git history. */
export function migratedLines(plans: readonly Plan[], targets: number): string[] {
  const sealed = plans.reduce((sum, { migrated: { counts } }) => sum + counts.secrets + counts.credentials.length, 0);
  const dollars = [...new Set(plans.flatMap(({ facts }) => facts.dollars))];
  const run = "pass it with `bun repo env run`";

  const history = [sealed]
    .filter((count) => count > 0)
    .map((count) => `the ${plural(count, "sealed value")} ${count === 1 ? "is" : "are"} still in git history`);

  const parity = [targets]
    .filter((count) => count > 0)
    .map(() => "; global, local, dev and prod values match createScriptEnv");

  return [
    `${PREFIX}migrated ${tally(plans)}${parity.join("")}`,
    ...dollars.map((key) => `${PREFIX}export refuses ${key} (it holds \`$\`); ${run}`),
    ...history.map((line) => `${PREFIX}${line}; rotate them`),
  ];
}
