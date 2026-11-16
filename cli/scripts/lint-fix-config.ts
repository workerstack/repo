/**
 * The lint fix of precommit and turn: oxlint's fix on each file over its baseline under the root config narrowed to
 * the rules that file is over on, so a baselined hit of any other rule is never rewritten. The narrowed config keeps
 * every field but `categories`, `rules` and the overrides' rules, so plugins, settings and globs resolve as in the
 * real one; it is written beside it for the run (oxlint reads override globs against the config's own dir) and named
 * for the process, so two runs never remove each other's copy.
 */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { type Json, readJson } from "../json.ts";
import type { Result } from "../result.ts";
import { byCodeUnit } from "../sync/by-code-unit.ts";
import { JSON_INDENT } from "../sync/json.constants.ts";
import catalog from "../sync/oxlint-catalog.json" with { type: "json" };
import { CATEGORIES, fixConfigPath, OXLINT_CONFIG_PATH } from "../sync/oxlint-config.ts";
import { fixPasses } from "./fix-passes.ts";
import { type Counts, countsOf, type Diagnostic, gate, lintReport } from "./lint-baseline.ts";
import { stripJsonc } from "./strip-jsonc.ts";

/** Every rule of the six built-in plugins with its category. */
const categories: Readonly<Record<string, string>> = catalog;

/** A rule code as oxlint reports it, `plugin(rule)`. */
const RULE_CODE = /^([^()]+)\(([^()]+)\)$/;

const OFF = "off";
const ON = "error";

type Rules = Record<string, Json>;

/** oxlint's diagnostics, or why they could not be had. */
type Report = Result<Diagnostic[]>;

/** Files with the over rule codes they share. */
type Group = { files: readonly string[]; rules: readonly string[] };

/** The lintable files a fix may rewrite, and the baseline they are gated against. */
type Gated = { files: readonly string[]; baseline: Counts };

/** The parts of an oxlint config the narrowing rewrites; every other field passes through as it is. */
function configSchema() {
  const rules = z.record(z.string(), z.json());

  return z.looseObject({
    overrides: z.array(z.looseObject({ rules: rules.default({}) })).default([]),
    rules: rules.default({}),
  });
}

/** `plugin(rule)` as its config key `plugin/rule`; a code of no rule, such as `parse-error`, stays as it is. */
function keyOf(code: string): string {
  return code.replace(RULE_CODE, "$1/$2");
}

/** `rules` with only the entries `keys` holds. */
function only(rules: Rules, keys: ReadonlySet<string>): Rules {
  return Object.fromEntries(Object.entries(rules).filter(([key]) => keys.has(key)));
}

/**
 * The root config `configText` (null when it is absent, read as `{}`) narrowed to the over rule codes `overRules`:
 * every category off; `rules` with each over key the config or an override lists at its real value, or at `error`
 * for a category rule only the catalog knows; each override's rules cut to the over keys, an override left with none
 * dropped. A code no config entry and no catalog rule knows (a script rule) drops out.
 */
export function fixConfig(configText: string | null, overRules: readonly string[]): string {
  const { overrides, rules, ...rest } = readJson(configSchema(), configText === null ? "{}" : stripJsonc(configText));
  const listed = [...Object.keys(rules), ...overrides.flatMap((override) => Object.keys(override.rules))];
  const known = new Set([...listed, ...Object.keys(categories)]);
  const keys = new Set(overRules.map(keyOf).filter((key) => known.has(key)));

  // A category rule only the catalog knows runs at error; a listed key keeps its value and options.
  const catalogued = [...keys].filter((key) => Object.hasOwn(categories, key)).map((key): [string, Json] => [key, ON]);
  const narrowed = { ...Object.fromEntries(catalogued), ...only(rules, keys) };

  const cut = overrides
    .map((override) => ({ ...override, rules: only(override.rules, keys) }))
    .filter((override) => Object.keys(override.rules).length > 0);

  const fixed = {
    ...rest,
    categories: Object.fromEntries(CATEGORIES.map((category): [string, Json] => [category, OFF])),
    overrides: cut,
    rules: narrowed,
  };

  return `${JSON.stringify(fixed, null, JSON_INDENT)}\n`;
}

/** The files over their baseline on some rule, grouped by that set of rules, each group's rules sorted. */
function overGroups({ files, baseline }: Gated, report: readonly Diagnostic[]): Group[] {
  const { over } = gate(baseline, countsOf(report), files);

  const grouped = Map.groupBy(files, (file) =>
    over
      .filter((e) => e.file === file)
      .map((e) => e.rule)
      .toSorted(byCodeUnit)
      .join(" "),
  );

  return [...grouped].filter(([key]) => key !== "").map(([key, group]) => ({ files: group, rules: key.split(" ") }));
}

/** oxlint's fix on the group's files under the root config narrowed to its rules, the copy removed after. */
async function narrowedFix(root: string, { rules, files }: Group): Promise<void> {
  const config = path.join(root, OXLINT_CONFIG_PATH);
  const real = fs.existsSync(config) ? fs.readFileSync(config, "utf8") : null;
  const rel = fixConfigPath(process.pid);
  const file = path.join(root, rel);
  fs.writeFileSync(file, fixConfig(real, rules));

  try {
    await lintReport(root, ["--fix", "-c", rel, ...files]);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/** The narrowed fix of each group, one at a time: they share the process's one copy name. */
async function fixEach(root: string, groups: readonly Group[]): Promise<void> {
  const [first, ...rest] = groups;

  if (first === undefined) return;
  await narrowedFix(root, first);
  await fixEach(root, rest);
}

/**
 * The narrowed fix on the files `report` shows over their baseline, in rounds reported again after each until a round
 * rewrites none: a fix can leave a hit of another rule, which the next round fixes when it is over. The report of the
 * files as left; `report` itself when nothing was over or it could not be had.
 */
export async function fixOverBaseline(root: string, gated: Gated, report: Report): Promise<Report> {
  let last = report;

  await fixPasses(root, gated.files, async () => {
    const groups = last.ok ? overGroups(gated, last.value) : [];
    await fixEach(root, groups);

    if (groups.length > 0) last = await lintReport(root, gated.files);
  });

  return last;
}
