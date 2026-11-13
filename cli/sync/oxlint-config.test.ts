import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { LintSkip } from "../config.ts";
import { type Json, readJson } from "../json.ts";
import { oxlintConfig } from "./oxlint-config.ts";
import type { PackageJson, Workspace } from "./workspace.ts";

function workspace(manifest: PackageJson, packages: Workspace["packages"] = []): Workspace {
  return {
    manifest,
    packages,
    root: "/repo",
  };
}

function configOf(ws: Workspace, skips: readonly LintSkip[] = []): Json {
  const built = oxlintConfig(ws, { skip: skips });

  if (!built.ok) throw new Error(built.errors.join("\n"));

  return readJson(z.json(), built.value);
}

const SIZE = { skipBlankLines: true, skipComments: true };

const CATEGORIES = Object.fromEntries(
  ["correctness", "suspicious", "pedantic", "perf", "style", "restriction", "nursery"].map((name) => [
    name,
    name === "correctness" || name === "suspicious" ? "error" : "off",
  ]),
);

/** Every rule the base sets to a bare "error". */
const ERROR_RULES = [
  "repo/as-needs-reason repo/boundaries repo/class-file repo/config-file repo/deprecated-replacement repo/entry-file",
  "repo/env-in-config repo/filename-matches-export repo/index-file repo/max-line-width repo/member-ordering",
  "repo/naming-convention repo/native-path-separator repo/no-block-comment repo/no-boolean-param",
  "repo/no-chained-type-assertions repo/no-commented-out-code repo/no-known-value-widening repo/no-module-mocking",
  "repo/no-module-side-effects repo/no-module-state repo/no-object-parameters repo/no-reflect-apply",
  "repo/no-reflect-get repo/no-runtime-typeof",
  "repo/no-shape-in-symbol-names repo/no-side-effect-import repo/no-unknown-parameters repo/no-unknown-returns",
  "repo/no-unknown-type-aliases repo/no-unsafe-dictionary-type repo/no-v8-ignore",
  "repo/no-widen-then-assert repo/public-jsdoc repo/require-readable-spacing",
  "repo/skip-on-platform repo/todo-needs-id repo/types-file unicorn/prefer-node-protocol oxc/no-accumulating-spread",
  "eslint/no-shadow eslint/no-else-return eslint/no-nested-ternary eslint/no-param-reassign eslint/no-await-in-loop",
  "eslint/require-await eslint/no-console import/no-cycle import/no-default-export typescript/no-explicit-any",
  "typescript/no-non-null-assertion typescript/no-floating-promises typescript/no-unnecessary-condition",
  "typescript/no-unsafe-argument typescript/no-unsafe-assignment typescript/no-unsafe-member-access",
  "typescript/no-unsafe-return typescript/no-unsafe-call typescript/switch-exhaustiveness-check",
  "typescript/prefer-nullish-coalescing typescript/consistent-type-imports eslint/prefer-template",
  "eslint/no-lonely-if unicorn/switch-case-braces unicorn/no-negated-condition unicorn/no-lonely-if",
  "unicorn/no-array-reduce unicorn/no-array-for-each unicorn/no-await-expression-member",
  "unicorn/prefer-string-replace-all",
]
  .join(" ")
  .split(" ");

/** The rules the base opts out of, which the config writes as "off". */
const REJECTED = [
  "eslint/one-var eslint/id-length typescript/prefer-readonly-parameter-types",
  "typescript/explicit-function-return-type unicorn/no-null eslint/no-ternary vitest/prefer-expect-assertions",
  "vitest/require-test-timeout eslint/no-magic-numbers typescript/prefer-optional-chain",
  "eslint/no-negated-condition typescript/no-unsafe-type-assertion",
]
  .join(" ")
  .split(" ");

/** The rules the base sets with options. */
const OPTION_RULES = {
  "eslint/complexity": ["error", { max: 10 }],
  "eslint/curly": ["error", "multi-or-nest", "consistent"],
  "eslint/eqeqeq": ["error", "always", { null: "ignore" }],
  "eslint/func-style": ["error", "declaration", { allowArrowFunctions: false }],
  "eslint/max-depth": ["error", { max: 4 }],
  "eslint/max-lines": ["error", { max: 200, ...SIZE }],
  "eslint/max-lines-per-function": ["error", { max: 30, ...SIZE }],
  "eslint/max-nested-callbacks": ["error", { max: 3 }],
  "eslint/max-params": ["error", { max: 3 }],
  "eslint/sort-keys": ["error", "asc", { allowLineSeparatedGroups: true, caseSensitive: true, natural: false }],
  "typescript/consistent-type-assertions": ["error", { assertionStyle: "as", objectLiteralTypeAssertions: "allow" }],
  "typescript/consistent-type-definitions": ["error", "type"],
  "typescript/strict-boolean-expressions": [
    "error",
    { allowNullableObject: false, allowNumber: false, allowString: false },
  ],
  "unicorn/no-useless-undefined": ["error", { checkArguments: false }],
  "vitest/valid-expect": ["error", { maxArgs: 2 }],
};

const BASE_RULES = {
  ...Object.fromEntries(ERROR_RULES.map((rule) => [rule, "error"])),
  ...OPTION_RULES,
  ...Object.fromEntries(REJECTED.map((rule) => [rule, "off"])),
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

/** An eval file default-exports the spec its define call builds at import, as a config does. */
const EVAL_OVERRIDE = {
  files: ["**/evals/*/eval.ts"],
  rules: { "import/no-default-export": "off", "repo/no-module-side-effects": "off" },
};

/** `ci.checks` run in key order, so the workerstack config keeps its keys where the consumer put them. */
const WORKERSTACK_OVERRIDE = { files: ["**/repo.config.ts"], rules: { "eslint/sort-keys": "off" } };
const BASE_OVERRIDES = [TEST_OVERRIDE, CONFIG_OVERRIDE, EVAL_OVERRIDE, WORKERSTACK_OVERRIDE];

describe("oxlintConfig base", () => {
  it(
    "loads the repo plugin, turns correctness and suspicious on at error, the other categories off, " +
      "every listed rule on, type-aware, tests and configs relaxed, fixtures and reject files ignored",
    () => {
      expect(configOf(workspace({ name: "app" }))).toStrictEqual({
        categories: CATEGORIES,
        ignorePatterns: ["**/__fixtures__/**", "**/*.reject.{ts,tsx}"],
        jsPlugins: [{ name: "repo", specifier: "@workerstack/repo/lint" }],
        options: { respectEslintDisableDirectives: false, typeAware: true },
        overrides: BASE_OVERRIDES,
        plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "vitest"],
        rules: BASE_RULES,
      });
    },
  );
});

/** A root and two packages that name bins and `./lint` exports. */
const BIN_AND_LINT = workspace(
  { bin: "./bin/app.ts", exports: { "./lint": { default: "./lint/index.ts" } }, name: "app" },
  [
    { dir: "packages/cli", manifest: { bin: { cli: "./bin/cli.ts", "cli-dev": "bin/dev.ts" } } },
    { dir: "packages/rules", manifest: { exports: { ".": "./index.ts", "./lint": "./cli/lint/index.ts" } } },
  ],
);

describe("oxlintConfig per package", () => {
  it(
    "lets each bin of the root and every package run at import, " +
      "and each ./lint export default-export and assemble its plugin",
    () => {
      expect(configOf(BIN_AND_LINT)).toMatchObject({
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
    },
  );

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

it(
  "oxlintConfig writes one override per skip after every other, " +
    "turning off only the named rules for the named files",
  () => {
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
          {
            files: ["src/**/*.ts", "lib/*.ts"],
            rules: { "eslint/max-lines": "off", "vitest/no-disabled-tests": "off" },
          },
        ],
        rules: BASE_RULES,
      }),
    );
  },
);

it("oxlintConfig accepts a skip of repo/duplicate-code and writes no override for it", () => {
  const skips = [
    { files: ["src/generated/**"], reason: "generated per locale from one template", rules: ["repo/duplicate-code"] },
  ];

  expect(configOf(APP, skips)).toStrictEqual(configOf(APP));
});
