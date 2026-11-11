import path from "node:path";
import { CONFIG_FILE, type LintSkip } from "../config.ts";
import { binsOf, isRecord } from "../lint/manifest.ts";
import { isRustRule, SCRIPT_RULES } from "../lint/script-rules.ts";
import catalog from "./oxlint-catalog.json" with { type: "json" };
import { OFF_RULES, RULES, type RuleSetting, TEST_RULES } from "./oxlint-rules.ts";
import type { PackageJson, Workspace } from "./workspace.ts";

/** The generated config sync writes at the root. */
export const OXLINT_CONFIG_PATH = ".oxlintrc.json";
/** The skip-free copies `repo check` writes beside it for one run, each named for its process. */
export const UNSKIPPED_CONFIG_GLOB = ".oxlintrc.unskipped-*.json";
export const unskippedConfigPath = (pid: number): string => UNSKIPPED_CONFIG_GLOB.replace("*", String(pid));
/** Fixture trees are copies of other repos' files: never linted or formatted. */
export const FIXTURES = "**/fixtures/**";
/** Reject files hold code that must not compile, checked by `repo check` and `repo turn` instead of linted. */
const REJECT_FILES = "**/*.reject.{ts,tsx}";
const TESTS = ["**/*.{test,spec}.{ts,tsx}", "**/*.e2e.{ts,tsx}"];
const CONFIGS = "**/*.config.ts";
const CATEGORIES = ["correctness", "suspicious", "pedantic", "perf", "style", "restriction", "nursery"] as const;
/** The categories the base runs whole; the catalog lists their rules. */
const ON_CATEGORIES: readonly string[] = ["correctness", "suspicious"];
/** Every rule of the six plugins with its category. */
const categories: Readonly<Record<string, string>> = catalog;
const OFF_SIDE_EFFECTS = { "repo/no-module-side-effects": "off" };
const OFF_DEFAULT_EXPORT = { "import/no-default-export": "off" };

/** The file a manifest's `./lint` export names, as a path or as its `default` condition. */
function lintExportOf(manifest: PackageJson): unknown[] {
  const target = isRecord(manifest.exports) ? manifest.exports["./lint"] : undefined;
  return [isRecord(target) ? target.default : target];
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

/** The generated config's text, or why a skip could not be turned into an override. */
export type Built = { ok: true; value: string } | { ok: false; errors: string[] };

const isOn = (setting: RuleSetting) => (Array.isArray(setting) ? setting[0] : setting) === "error";

/** Every rule key the generated config sets to `error`, in the base or in the test override. */
const runRules = (): Set<string> =>
  new Set(
    [...Object.entries(RULES), ...Object.entries(TEST_RULES)].flatMap(([rule, setting]) =>
      isOn(setting) ? [rule] : [],
    ),
  );

/**
 * One line per skipped rule name neither the generated config nor a script check runs, naming its entry. The Rust
 * names (the `repo/rust-*` rules, `clippy/<lint>` and `rust/<lint>`) are known only when the root has a Cargo.toml.
 */
function unknownRules(skips: readonly LintSkip[], rust: boolean): string[] {
  const run = runRules();
  const known = (rule: string) =>
    run.has(rule) ||
    (ON_CATEGORIES.includes(categories[rule] ?? "") && !Object.hasOwn(OFF_RULES, rule)) ||
    (rust ? SCRIPT_RULES.includes(rule) || isRustRule(rule) : SCRIPT_RULES.includes(rule) && !isRustRule(rule));
  return skips.flatMap((skip, index) =>
    skip.rules
      .filter((rule) => !known(rule))
      .map((rule) => `${CONFIG_FILE}: lint.skip[${index}].rules: "${rule}" is not a rule the generated config runs`),
  );
}

/**
 * Each `lint.skip` entry as an override turning off its oxlint rules for its files; the script rules are no oxlint
 * rules (`repo check` and `repo turn` drop their hits), so an entry of only those writes none; the Rust lints are
 * cargo's, not oxlint's, and never reach the config either.
 */
function skipOverrides(skips: readonly LintSkip[]): { files: readonly string[]; rules: Record<string, string> }[] {
  return skips.flatMap((skip) => {
    const rules = skip.rules.filter((rule) => !SCRIPT_RULES.includes(rule) && !isRustRule(rule));
    return rules.length === 0
      ? []
      : [{ files: skip.files, rules: Object.fromEntries(rules.map((rule) => [rule, "off"])) }];
  });
}

/**
 * The oxlint config: the repo plugin and the named rules, type-aware, with eslint-disable comments ignored. Each
 * `lint.skip` entry is an override written last, so it turns off only its rules for only its files. `rust` is whether
 * the root has a Cargo.toml, which is what lets a skip name a Rust rule.
 */
export function oxlintConfig(workspace: Workspace, skips: readonly LintSkip[], rust = false): Built {
  const errors = unknownRules(skips, rust);
  if (errors.length > 0) return { ok: false, errors };
  const config = {
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "vitest"],
    // A specifier, not a path: oxlint resolves it from the config's node_modules, or from NODE_PATH (`repo lint`).
    jsPlugins: [{ name: "repo", specifier: "@workerstack/repo/lint" }],
    categories: Object.fromEntries(
      CATEGORIES.map((category) => [category, ON_CATEGORIES.includes(category) ? "error" : "off"]),
    ),
    options: { typeAware: true, respectEslintDisableDirectives: false },
    ignorePatterns: [FIXTURES, REJECT_FILES],
    rules: { ...RULES, ...Object.fromEntries(Object.keys(OFF_RULES).map((rule) => [rule, "off"])) },
    overrides: [
      { files: TESTS, rules: { ...OFF_SIDE_EFFECTS, ...TEST_RULES } },
      // vitest and workerstack configs must default-export, and call their define helper at import.
      { files: [CONFIGS], rules: { ...OFF_DEFAULT_EXPORT, ...OFF_SIDE_EFFECTS } },
      ...packageOverrides(workspace),
      ...skipOverrides(skips),
    ],
  };
  return { ok: true, value: `${JSON.stringify(config, null, 2)}\n` };
}
