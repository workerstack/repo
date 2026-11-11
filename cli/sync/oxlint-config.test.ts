import { describe, expect, it } from "vitest";

import type { LintSkip } from "../config.ts";
import { oxlintConfig } from "./oxlint-config.ts";
import type { PackageJson, Workspace } from "./workspace.ts";

const workspace = (manifest: PackageJson, packages: Workspace["packages"] = []): Workspace => ({
  manifest,
  packages,
  root: "/repo",
});
const configOf = (ws: Workspace, skips: readonly LintSkip[] = []): unknown => {
  const built = oxlintConfig(ws, skips);
  if (!built.ok) throw new Error(built.errors.join("\n"));
  return JSON.parse(built.value);
};

const SIZE = { skipBlankLines: true, skipComments: true };
const CATEGORIES = Object.fromEntries(
  ["correctness", "suspicious", "pedantic", "perf", "style", "restriction", "nursery"].map((name) => [
    name,
    name === "correctness" || name === "suspicious" ? "error" : "off",
  ]),
);
const REPO_RULES = {
  "repo/as-needs-reason": "error",
  "repo/boundaries": "error",
  "repo/class-file": "error",
  "repo/config-file": "error",
  "repo/deprecated-replacement": "error",
  "repo/entry-file": "error",
  "repo/env-in-config": "error",
  "repo/filename-matches-export": "error",
  "repo/index-file": "error",
  "repo/max-line-width": "error",
  "repo/member-ordering": "error",
  "repo/naming-convention": "error",
  "repo/native-path-separator": "error",
  "repo/no-block-comment": "error",
  "repo/no-boolean-param": "error",
  "repo/no-commented-out-code": "error",
  "repo/no-mock-of-subject": "error",
  "repo/no-module-side-effects": "error",
  "repo/no-module-state": "error",
  "repo/no-side-effect-import": "error",
  "repo/no-v8-ignore": "error",
  "repo/public-jsdoc": "error",
  "repo/skip-on-platform": "error",
  "repo/todo-needs-id": "error",
  "repo/types-file": "error",
  "unicorn/prefer-node-protocol": "error",
};
const REJECTED =
  "eslint/one-var eslint/id-length typescript/prefer-readonly-parameter-types typescript/explicit-function-return-type unicorn/no-null eslint/no-ternary vitest/prefer-expect-assertions vitest/require-test-timeout eslint/no-magic-numbers typescript/prefer-optional-chain eslint/no-negated-condition".split(
    " ",
  );
const BASE_RULES = {
  "eslint/max-lines": ["error", { max: 200, ...SIZE }],
  "eslint/max-lines-per-function": ["error", { max: 30, ...SIZE }],
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
  "typescript/consistent-type-assertions": ["error", { assertionStyle: "as", objectLiteralTypeAssertions: "allow" }],
  "typescript/no-explicit-any": "error",
  "typescript/no-non-null-assertion": "error",
  "typescript/no-floating-promises": "error",
  "typescript/no-unnecessary-condition": "error",
  "typescript/no-unsafe-argument": "error",
  "typescript/no-unsafe-assignment": "error",
  "typescript/no-unsafe-member-access": "error",
  "typescript/no-unsafe-return": "error",
  "typescript/no-unsafe-call": "error",
  "typescript/no-unsafe-type-assertion": "off",
  "typescript/strict-boolean-expressions": [
    "error",
    { allowNullableObject: false, allowNumber: false, allowString: false },
  ],
  "typescript/prefer-nullish-coalescing": "error",
  "eslint/eqeqeq": ["error", "always", { null: "ignore" }],
  "eslint/sort-keys": ["error", "asc", { allowLineSeparatedGroups: true, caseSensitive: true, natural: false }],
  ...Object.fromEntries(REJECTED.map((rule) => [rule, "off"])),
  "typescript/consistent-type-definitions": ["error", "type"],
  "typescript/consistent-type-imports": "error",
  "eslint/func-style": ["error", "declaration", { allowArrowFunctions: false }],
  "eslint/curly": ["error", "multi-or-nest", "consistent"],
  "eslint/prefer-template": "error",
  "eslint/no-lonely-if": "error",
  "eslint/max-nested-callbacks": ["error", { max: 3 }],
  "unicorn/switch-case-braces": "error",
  "unicorn/no-negated-condition": "error",
  "unicorn/no-lonely-if": "error",
  "unicorn/no-array-reduce": "error",
  "unicorn/no-array-for-each": "error",
  "unicorn/no-await-expression-member": "error",
  "unicorn/prefer-string-replace-all": "error",
  "unicorn/no-useless-undefined": ["error", { checkArguments: false }],
  "typescript/switch-exhaustiveness-check": "error",
  "vitest/valid-expect": ["error", { maxArgs: 2 }],
};
const TEST_OVERRIDE = {
  files: ["**/*.{test,spec}.{ts,tsx}", "**/*.e2e.{ts,tsx}"],
  rules: {
    "eslint/no-console": "off",
    "repo/no-module-side-effects": "off",
    "repo/no-module-state": "off",
    "vitest/expect-expect": "error",
    "vitest/no-conditional-tests": "error",
    "vitest/no-disabled-tests": "error",
    "vitest/no-focused-tests": "error",
    "vitest/prefer-called-with": "error",
    "vitest/prefer-strict-equal": "error",
    "vitest/warn-todo": "error",
  },
};
const CONFIG_OVERRIDE = {
  files: ["**/*.config.ts"],
  rules: { "import/no-default-export": "off", "repo/no-module-side-effects": "off" },
};
/** `ci.checks` run in key order, so the workerstack config keeps its keys where the consumer put them. */
const WORKERSTACK_OVERRIDE = { files: ["**/workerstack.config.ts"], rules: { "eslint/sort-keys": "off" } };
const BASE_OVERRIDES = [TEST_OVERRIDE, CONFIG_OVERRIDE, WORKERSTACK_OVERRIDE];

describe("oxlintConfig base", () => {
  it("loads the repo plugin, turns correctness and suspicious on at error, the other categories off, every listed rule on, type-aware, tests and configs relaxed, fixtures and reject files ignored", () => {
    expect(configOf(workspace({ name: "app" }))).toStrictEqual({
      categories: CATEGORIES,
      ignorePatterns: ["**/fixtures/**", "**/*.reject.{ts,tsx}"],
      jsPlugins: [{ name: "repo", specifier: "@workerstack/repo/lint" }],
      options: { respectEslintDisableDirectives: false, typeAware: true },
      overrides: BASE_OVERRIDES,
      plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "vitest"],
      rules: { ...REPO_RULES, ...BASE_RULES },
    });
  });
});

describe("oxlintConfig per package", () => {
  it("lets each bin of the root and every package run at import, and each ./lint export default-export and assemble its plugin", () => {
    const ws = workspace({ bin: "./bin/app.ts", exports: { "./lint": { default: "./lint/index.ts" } }, name: "app" }, [
      { dir: "packages/cli", manifest: { bin: { cli: "./bin/cli.ts", "cli-dev": "bin/dev.ts" } } },
      { dir: "packages/rules", manifest: { exports: { ".": "./index.ts", "./lint": "./cli/lint/index.ts" } } },
    ]);
    expect(configOf(ws)).toMatchObject({
      overrides: [
        ...BASE_OVERRIDES,
        {
          files: ["bin/app.ts", "packages/cli/bin/cli.ts", "packages/cli/bin/dev.ts"],
          rules: { "repo/no-module-side-effects": "off" },
        },
        {
          files: ["lint/index.ts", "packages/rules/cli/lint/index.ts"],
          rules: { "import/no-default-export": "off", "repo/index-file": "off" },
        },
      ],
    });
  });

  it("reads no override from a bin or ./lint export of another shape", () => {
    const ws = workspace({ bin: 7, exports: "./index.ts" }, [
      { dir: "a", manifest: { bin: { a: 1 }, exports: { "./lint": { import: "./lint.ts" } } } },
      { dir: "b", manifest: { bin: ["./bin/b.ts"], exports: { "./lint": 3 } } },
      { dir: "c", manifest: { bin: null, exports: null } },
    ]);
    expect(configOf(ws)).toHaveProperty("overrides", BASE_OVERRIDES);
  });
});

const REASON = "the parsed config cache lives for the process";
const APP = workspace({ bin: "./bin/app.ts", name: "app" });

it("oxlintConfig writes one override per skip after every other, turning off only the named rules for the named files", () => {
  const skips = [
    { files: ["src/cache.ts"], reason: REASON, rules: ["repo/no-module-state"] },
    { files: ["src/**/*.ts", "lib/*.ts"], reason: REASON, rules: ["eslint/max-lines", "vitest/no-disabled-tests"] },
  ];
  expect(configOf(APP, skips)).toStrictEqual(
    expect.objectContaining({
      overrides: [
        ...BASE_OVERRIDES,
        { files: ["bin/app.ts"], rules: { "repo/no-module-side-effects": "off" } },
        { files: ["src/cache.ts"], rules: { "repo/no-module-state": "off" } },
        { files: ["src/**/*.ts", "lib/*.ts"], rules: { "eslint/max-lines": "off", "vitest/no-disabled-tests": "off" } },
      ],
      rules: { ...REPO_RULES, ...BASE_RULES },
    }),
  );
});
