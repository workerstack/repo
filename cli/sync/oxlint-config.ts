import path from "node:path";

import { CONFIG_FILE } from "../config.constants.ts";
import type { LintSkip, ResolvedLint } from "../config.ts";
import { STYLELINT_RULE } from "../css/stylelint.constants.ts";
import { FIXTURES_DIR } from "../fixtures.constants.ts";
import { isRecord } from "../json.ts";
import { binsOf } from "../lint/manifest.ts";
import { isRustRule, SCRIPT_RULES } from "../lint/script-rules.ts";
import { ERROR_SEVERITY, JSON_INDENT } from "./json.constants.ts";
import catalog from "./oxlint-catalog.json" with { type: "json" };
import { OFF_RULES, RULES, type RuleSetting, TEST_RULES } from "./oxlint-rules.ts";
import { boundariesSetting, tagErrors } from "./oxlint-tags.ts";
import type { PackageJson, Workspace } from "./workspace.ts";

/** The generated config sync writes at the root. */
export const OXLINT_CONFIG_PATH = ".oxlintrc.json";

/** The skip-free copies `repo check` writes beside it for one run, each named for its process. */
export const UNSKIPPED_CONFIG_GLOB = ".oxlintrc.unskipped-*.json";

export function unskippedConfigPath(pid: number): string {
  return UNSKIPPED_CONFIG_GLOB.replace("*", String(pid));
}

/** Fixture trees are copies of other repos' files: never linted or formatted. */
export const FIXTURES: string = `**/${FIXTURES_DIR}/**`;

/** Reject files hold code that must not compile, checked by `repo check` and `repo turn` instead of linted. */
const REJECT_FILES = "**/*.reject.{ts,tsx}";
const TESTS = ["**/*.{test,spec}.{ts,tsx}", "**/*.e2e.{ts,tsx}"];
const CONFIGS = "**/*.config.ts";
const WORKERSTACK_CONFIG = "**/workerstack.config.ts";
const CATEGORIES = ["correctness", "suspicious", "pedantic", "perf", "style", "restriction", "nursery"] as const;

/** The categories the base runs whole; the catalog lists their rules. */
const ON_CATEGORIES: readonly string[] = ["correctness", "suspicious"];

/** Every rule of the six plugins with its category. */
const categories: Readonly<Record<string, string>> = catalog;
const OFF_SIDE_EFFECTS = { "repo/no-module-side-effects": "off" };
const OFF_DEFAULT_EXPORT = { "import/no-default-export": "off" };
const REPO_PLUGIN = { name: "repo", specifier: "@workerstack/repo/lint" };

/** Through this package, never the bare name: an isolated install does not hoist our dependencies to the root. */
const TAILWIND_PLUGIN = { name: "tailwindcss", specifier: "@workerstack/repo/tailwind" };

/** oxlint-tailwindcss's class rules, at error where the plugin warns on duplicates and colours. */
const TAILWIND_RULES: Readonly<Record<string, RuleSetting>> = {
  "tailwindcss/no-conflicting-classes": "error",
  "tailwindcss/no-duplicate-classes": "error",
  "tailwindcss/no-hardcoded-colors": "error",
  "tailwindcss/no-unknown-classes": "error",
};

/** The exports that name an oxlint plugin entry: ours and the tailwindcss re-export. */
const PLUGIN_EXPORTS = ["./lint", "./tailwind"];

/** A Stylelint rule, `stylelint/<rule>` in lowercase: any such name passes; one with no hit fails `repo check`. */
function isStylelintRule(rule: string): boolean {
  return STYLELINT_RULE.test(rule);
}

/** The files a manifest's plugin exports (`./lint`, `./tailwind`) name, as a path or as their `default` condition. */
function lintExportOf(manifest: PackageJson): unknown[] {
  const { exports } = manifest;

  return PLUGIN_EXPORTS.map((key) => {
    const target = isRecord(exports) ? exports[key] : undefined;

    return isRecord(target) ? target.default : target;
  });
}

/** Every string `pick` finds in the root's and each package's manifest, as a root-relative POSIX path, sorted. */
function filesOf(workspace: Workspace, pick: (manifest: PackageJson) => unknown[]): string[] {
  const all = [{ dir: "", manifest: workspace.manifest }, ...workspace.packages];

  const files = all.flatMap(({ dir, manifest }) =>
    pick(manifest).flatMap((file) => (typeof file === "string" ? [path.posix.join(dir, file)] : [])),
  );

  return [...new Set(files)].toSorted();
}

/**
 * A bin runs its main at import, and a plugin entry must default-export the plugin it assembles from its rules: each
 * gets an override when there is one.
 */
function packageOverrides(workspace: Workspace): { files: string[]; rules: Record<string, string> }[] {
  const overrides = [
    { files: filesOf(workspace, (manifest) => binsOf(manifest.bin)), rules: OFF_SIDE_EFFECTS },
    { files: filesOf(workspace, lintExportOf), rules: { ...OFF_DEFAULT_EXPORT, "repo/index-file": "off" } },
  ];

  return overrides.filter((override) => override.files.length > 0);
}

/** The generated config's text, or why a skip or the package tags could not be written. */
export type Built = { ok: true; value: string } | { ok: false; errors: string[] };

function isOn(setting: RuleSetting) {
  return (Array.isArray(setting) ? setting[0] : setting) === ERROR_SEVERITY;
}

/** The tailwindcss plugin, its entry sheet as settings and its rules, with an entry; none of them without one. */
function tailwindParts(lint: ResolvedLint) {
  const entryPoint = lint.tailwind?.entryPoint;

  if (entryPoint === undefined) return { plugins: [], rules: {}, settings: {} };

  return { plugins: [TAILWIND_PLUGIN], rules: TAILWIND_RULES, settings: { settings: { tailwindcss: { entryPoint } } } };
}

/** Every rule key the generated config sets to `error`, in the base, the tailwindcss rules or the test override. */
function runRules(lint: ResolvedLint): Set<string> {
  return new Set(
    [...Object.entries(RULES), ...Object.entries(tailwindParts(lint).rules), ...Object.entries(TEST_RULES)].flatMap(
      ([rule, setting]) => (isOn(setting) ? [rule] : []),
    ),
  );
}

/**
 * One line per skipped rule name neither the generated config nor a script check runs, naming its entry. The Rust
 * names (the `repo/rust-*` rules, `clippy/<lint>` and `rust/<lint>`) are known only when the root has a Cargo.toml;
 * a lowercase `stylelint/<rule>` always; a `tailwindcss/<rule>` only with an entry sheet.
 */
function unknownRules(lint: ResolvedLint, { rust }: { rust: boolean }): string[] {
  const run = runRules(lint);

  function known(rule: string) {
    return (
      run.has(rule) ||
      isStylelintRule(rule) ||
      (ON_CATEGORIES.includes(categories[rule] ?? "") && !Object.hasOwn(OFF_RULES, rule)) ||
      (rust ? SCRIPT_RULES.includes(rule) || isRustRule(rule) : SCRIPT_RULES.includes(rule) && !isRustRule(rule))
    );
  }

  return lint.skip.flatMap((skip, index) =>
    skip.rules
      .filter((rule) => !known(rule))
      .map((rule) => `${CONFIG_FILE}: lint.skip[${index}].rules: "${rule}" is not a rule the generated config runs`),
  );
}

/**
 * Each `lint.skip` entry as an override turning off its oxlint rules for its files; the script rules are no oxlint
 * rules (`repo check` and `repo turn` drop their hits), so an entry of only those writes none; the Rust lints are
 * cargo's and the Stylelint rules Stylelint's, not oxlint's, and never reach the config either.
 */
function skipOverrides(skips: readonly LintSkip[]): { files: readonly string[]; rules: Record<string, string> }[] {
  return skips.flatMap((skip) => {
    const rules = skip.rules.filter(
      (rule) => !SCRIPT_RULES.includes(rule) && !isRustRule(rule) && !isStylelintRule(rule),
    );

    return rules.length === 0
      ? []
      : [{ files: skip.files, rules: Object.fromEntries(rules.map((rule) => [rule, "off"])) }];
  });
}

/** The overrides, in order: tests, configs, the workerstack config, then the package and `lint.skip` ones. */
function overridesOf(workspace: Workspace, lint: ResolvedLint) {
  return [
    { files: TESTS, rules: { ...OFF_SIDE_EFFECTS, ...TEST_RULES } },
    // vitest and workerstack configs must default-export, and call their define helper at import.
    { files: [CONFIGS], rules: { ...OFF_DEFAULT_EXPORT, ...OFF_SIDE_EFFECTS } },
    // `ci.checks` run in key order, one after another, so sorting the keys would reorder a consumer's checks.
    { files: [WORKERSTACK_CONFIG], rules: { "eslint/sort-keys": "off" } },
    ...packageOverrides(workspace),
    ...skipOverrides(lint.skip),
  ];
}

/**
 * The oxlint config: the repo plugin and the named rules, type-aware, with eslint-disable comments ignored. Each
 * `lint.skip` entry is an override written last, so it turns off only its rules for only its files, and
 * `lint.boundaries`, checked against the workspace, is the options of `repo/boundaries`. `rust` is whether the root has
 * a Cargo.toml, which is what lets a skip name a Rust rule. `lint.tailwind`, the entry sync found or was given, adds
 * the tailwindcss plugin with the entry as its settings and its four class rules.
 */
export function oxlintConfig(
  workspace: Workspace,
  lint: ResolvedLint,
  { rust = false }: { rust?: boolean } = {},
): Built {
  const errors = [...unknownRules(lint, { rust }), ...tagErrors(workspace, lint.boundaries)];

  if (errors.length > 0) return { errors, ok: false };
  const tailwind = tailwindParts(lint);

  // The config is written in this key order, so a blank line starts each run of keys that is already sorted.
  const config = {
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "vitest"],

    // A specifier, not a path: oxlint resolves it from the config's node_modules, or from NODE_PATH (`repo lint`).
    jsPlugins: [REPO_PLUGIN, ...tailwind.plugins],

    categories: Object.fromEntries(
      CATEGORIES.map((category) => [category, ON_CATEGORIES.includes(category) ? "error" : "off"]),
    ),
    options: { respectEslintDisableDirectives: false, typeAware: true },
    ...tailwind.settings,
    ignorePatterns: [FIXTURES, REJECT_FILES],
    rules: {
      ...RULES,
      ...boundariesSetting(lint.boundaries),
      ...tailwind.rules,
      ...Object.fromEntries(Object.keys(OFF_RULES).map((rule) => [rule, "off"])),
    },

    overrides: overridesOf(workspace, lint),
  };

  return { ok: true, value: `${JSON.stringify(config, null, JSON_INDENT)}\n` };
}
