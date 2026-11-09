import path from "node:path";
import { CONFIG_FILE, type LintSkip } from "../config.ts";
import { binsOf, isRecord } from "../lint/manifest.ts";
import { MAGIC_RULES } from "../magic/magic-rules.ts";
import type { PackageJson, Workspace } from "./workspace.ts";

/** The generated config sync writes at the root. */
export const OXLINT_CONFIG_PATH = ".oxlintrc.json";
/** The skip-free copies `repo check` writes beside it for one run, each named for its process. */
export const UNSKIPPED_CONFIG_GLOB = ".oxlintrc.unskipped-*.json";
export const unskippedConfigPath = (pid: number): string => UNSKIPPED_CONFIG_GLOB.replace("*", String(pid));
/** Fixture trees are copies of other repos' files: never linted or formatted. */
export const FIXTURES = "**/fixtures/**";
const TESTS = ["**/*.{test,spec}.{ts,tsx}", "**/*.e2e.{ts,tsx}"];
const CONFIGS = "**/*.config.ts";
const CATEGORIES = ["correctness", "suspicious", "pedantic", "perf", "style", "restriction", "nursery"] as const;
/** Size limits count code only: blank lines and comments are free. */
const CODE_LINES = { skipBlankLines: true, skipComments: true };
const OFF_SIDE_EFFECTS = { "repo/no-module-side-effects": "off" };
const OFF_DEFAULT_EXPORT = { "import/no-default-export": "off" };

/** Every rule the base turns on; each is an error, none a warning. The `repo/` rules are `@workerstack/repo/lint`'s. */
const RULES: Record<string, string | [string, Record<string, unknown>]> = {
  "repo/as-needs-reason": "error",
  "repo/boundaries": "error",
  "repo/class-file": "error",
  "repo/config-file": "error",
  "repo/entry-file": "error",
  "repo/filename-matches-export": "error",
  "repo/index-file": "error",
  "repo/no-commented-out-code": "error",
  "repo/no-mock-of-subject": "error",
  "repo/no-module-side-effects": "error",
  "repo/no-module-state": "error",
  "repo/no-side-effect-import": "error",
  "repo/no-v8-ignore": "error",
  "repo/todo-needs-id": "error",
  "repo/types-file": "error",
  "unicorn/prefer-node-protocol": "error",
  "eslint/max-lines": ["error", { max: 200, ...CODE_LINES }],
  "eslint/max-lines-per-function": ["error", { max: 30, ...CODE_LINES }],
  "eslint/max-params": ["error", { max: 3 }],
  "eslint/complexity": ["error", { max: 10 }],
  "eslint/max-depth": ["error", { max: 4 }],
  "eslint/no-shadow": "error",
  "eslint/no-else-return": "error",
  "eslint/no-nested-ternary": "error",
  "eslint/no-param-reassign": "error",
  "eslint/no-await-in-loop": "error",
  "eslint/require-await": "error",
  "eslint/no-console": "error",
  "import/no-cycle": "error",
  "import/no-default-export": "error",
  // `repo/as-needs-reason` checks `x as T`; this refuses `<T>x`, which takes no reason comment. Object literals stay
  // free so `{} as T` reaches the reason check too.
  "typescript/consistent-type-assertions": ["error", { assertionStyle: "as", objectLiteralTypeAssertions: "allow" }],
  "typescript/no-explicit-any": "error",
  "typescript/no-non-null-assertion": "error",
  "typescript/no-floating-promises": "error",
  "typescript/no-unnecessary-condition": "error",
  "typescript/no-unsafe-argument": "error",
  "typescript/no-unsafe-assignment": "error",
  "typescript/switch-exhaustiveness-check": "error",
};

/** Test rules, only in test files, where module-scope setup and printing are allowed. */
const TEST_RULES: Record<string, string> = {
  "repo/no-module-state": "off",
  "vitest/expect-expect": "error",
  "vitest/no-conditional-tests": "error",
  "vitest/no-focused-tests": "error",
  "vitest/no-disabled-tests": "error",
  "vitest/warn-todo": "error",
  "eslint/no-console": "off",
};

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
  return [...new Set(files)].sort();
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

const isOn = (setting: string | [string, unknown]) => (Array.isArray(setting) ? setting[0] : setting) === "error";

/** Every rule key the generated config sets to `error`, in the base or in the test override. */
const runRules = (): Set<string> =>
  new Set(
    [...Object.entries(RULES), ...Object.entries(TEST_RULES)].flatMap(([rule, setting]) =>
      isOn(setting) ? [rule] : [],
    ),
  );

/** One line per skipped rule name neither the generated config nor the magic literal check runs, naming its entry. */
function unknownRules(skips: readonly LintSkip[]): string[] {
  const run = runRules();
  return skips.flatMap((skip, index) =>
    skip.rules
      .filter((rule) => !run.has(rule) && !MAGIC_RULES.includes(rule))
      .map((rule) => `${CONFIG_FILE}: lint.skip[${index}].rules: "${rule}" is not a rule the generated config runs`),
  );
}

/**
 * Each `lint.skip` entry as an override turning off its oxlint rules for its files; the magic rules are no oxlint
 * rules (`repo check` and `repo turn` drop their hits), so an entry of only those writes none.
 */
function skipOverrides(skips: readonly LintSkip[]): { files: readonly string[]; rules: Record<string, string> }[] {
  return skips.flatMap((skip) => {
    const rules = skip.rules.filter((rule) => !MAGIC_RULES.includes(rule));
    return rules.length === 0
      ? []
      : [{ files: skip.files, rules: Object.fromEntries(rules.map((rule) => [rule, "off"])) }];
  });
}

/**
 * The oxlint config: the repo plugin and the named rules, type-aware, with eslint-disable comments ignored. Each
 * `lint.skip` entry is an override written last, so it turns off only its rules for only its files.
 */
export function oxlintConfig(workspace: Workspace, skips: readonly LintSkip[]): Built {
  const errors = unknownRules(skips);
  if (errors.length > 0) return { ok: false, errors };
  const config = {
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "vitest"],
    // A specifier, not a path: oxlint resolves it from the config's node_modules, or from NODE_PATH (`repo lint`).
    jsPlugins: [{ name: "repo", specifier: "@workerstack/repo/lint" }],
    categories: Object.fromEntries(CATEGORIES.map((category) => [category, "off"])),
    options: { typeAware: true, respectEslintDisableDirectives: false },
    ignorePatterns: [FIXTURES],
    rules: RULES,
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
