import path from "node:path";
import type { PackageJson, Workspace } from "./workspace.ts";

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
  "repo/filename-matches-export": "error",
  "repo/no-commented-out-code": "error",
  "repo/no-mock-of-subject": "error",
  "repo/no-module-side-effects": "error",
  "repo/no-module-state": "error",
  "repo/no-side-effect-import": "error",
  "repo/no-v8-ignore": "error",
  "repo/todo-needs-id": "error",
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A manifest's bin scripts: `bin` as one path or a map of them; anything else names none. */
function binsOf(manifest: PackageJson): unknown[] {
  return isRecord(manifest.bin) ? Object.values(manifest.bin) : [manifest.bin];
}

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

/** A bin runs its main at import, and a plugin entry must default-export: each gets an override when there is one. */
function packageOverrides(workspace: Workspace): { files: string[]; rules: Record<string, string> }[] {
  const overrides = [
    { files: filesOf(workspace, binsOf), rules: OFF_SIDE_EFFECTS },
    { files: filesOf(workspace, lintExportOf), rules: OFF_DEFAULT_EXPORT },
  ];
  return overrides.filter((override) => override.files.length > 0);
}

/** The oxlint config: the repo plugin and the named rules, type-aware, with eslint-disable comments ignored. */
export function oxlintConfig(workspace: Workspace): string {
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
    ],
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}
