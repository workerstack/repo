import { describe, expect, it } from "vitest";
import type { LintSkip } from "../config.ts";
import { oxlintConfig } from "./oxlint-config.ts";
import type { PackageJson, Workspace } from "./workspace.ts";

const workspace = (manifest: PackageJson, packages: Workspace["packages"] = []): Workspace => ({
  root: "/repo",
  manifest,
  packages,
});
const configOf = (ws: Workspace, skips: readonly LintSkip[] = []): unknown => {
  const built = oxlintConfig(ws, skips);
  if (!built.ok) throw new Error(built.errors.join("\n"));
  return JSON.parse(built.value);
};

const SIZE = { skipBlankLines: true, skipComments: true };
const OFF = Object.fromEntries(
  ["correctness", "suspicious", "pedantic", "perf", "style", "restriction", "nursery"].map((name) => [name, "off"]),
);
const REPO_RULES = {
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
};
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
  "typescript/switch-exhaustiveness-check": "error",
};
const TEST_OVERRIDE = {
  files: ["**/*.{test,spec}.{ts,tsx}", "**/*.e2e.{ts,tsx}"],
  rules: {
    "repo/no-module-side-effects": "off",
    "repo/no-module-state": "off",
    "vitest/expect-expect": "error",
    "vitest/no-conditional-tests": "error",
    "vitest/no-focused-tests": "error",
    "vitest/no-disabled-tests": "error",
    "vitest/warn-todo": "error",
    "eslint/no-console": "off",
  },
};
const CONFIG_OVERRIDE = {
  files: ["**/*.config.ts"],
  rules: { "import/no-default-export": "off", "repo/no-module-side-effects": "off" },
};

describe("oxlintConfig base", () => {
  it("loads the repo plugin, turns every rule on at error, all categories off, type-aware, tests and configs relaxed", () => {
    expect(configOf(workspace({ name: "app" }))).toEqual({
      plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "vitest"],
      jsPlugins: [{ name: "repo", specifier: "@workerstack/repo/lint" }],
      categories: OFF,
      options: { typeAware: true, respectEslintDisableDirectives: false },
      ignorePatterns: ["**/fixtures/**"],
      rules: { ...REPO_RULES, ...BASE_RULES },
      overrides: [TEST_OVERRIDE, CONFIG_OVERRIDE],
    });
  });
});

describe("oxlintConfig per package", () => {
  it("lets each bin of the root and every package run at import, and each ./lint export default-export and assemble its plugin", () => {
    const ws = workspace({ name: "app", bin: "./bin/app.ts", exports: { "./lint": { default: "./lint/index.ts" } } }, [
      { dir: "packages/cli", manifest: { bin: { cli: "./bin/cli.ts", "cli-dev": "bin/dev.ts" } } },
      { dir: "packages/rules", manifest: { exports: { ".": "./index.ts", "./lint": "./cli/lint/index.ts" } } },
    ]);
    expect(configOf(ws)).toMatchObject({
      overrides: [
        TEST_OVERRIDE,
        CONFIG_OVERRIDE,
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
    expect(configOf(ws)).toHaveProperty("overrides", [TEST_OVERRIDE, CONFIG_OVERRIDE]);
  });
});

const REASON = "the parsed config cache lives for the process";
const APP = workspace({ name: "app", bin: "./bin/app.ts" });

it("oxlintConfig writes one override per skip after every other, turning off only the named rules for the named files", () => {
  const skips = [
    { files: ["src/cache.ts"], rules: ["repo/no-module-state"], reason: REASON },
    { files: ["src/**/*.ts", "lib/*.ts"], rules: ["eslint/max-lines", "vitest/no-disabled-tests"], reason: REASON },
  ];
  expect(configOf(APP, skips)).toEqual(
    expect.objectContaining({
      rules: { ...REPO_RULES, ...BASE_RULES },
      overrides: [
        TEST_OVERRIDE,
        CONFIG_OVERRIDE,
        { files: ["bin/app.ts"], rules: { "repo/no-module-side-effects": "off" } },
        { files: ["src/cache.ts"], rules: { "repo/no-module-state": "off" } },
        { files: ["src/**/*.ts", "lib/*.ts"], rules: { "eslint/max-lines": "off", "vitest/no-disabled-tests": "off" } },
      ],
    }),
  );
});

it("oxlintConfig refuses a rule the generated config does not run, naming the entry", () => {
  const skips = [
    { files: ["src/a.ts"], rules: ["repo/no-module-state"], reason: REASON },
    { files: ["src/b.ts"], rules: ["eslint/no-console", "repo/no-modul-state"], reason: REASON },
    { files: ["src/c.ts"], rules: ["no-module-state"], reason: REASON },
  ];
  expect(oxlintConfig(APP, skips)).toEqual({
    ok: false,
    errors: [
      'workerstack.config.ts: lint.skip[1].rules: "repo/no-modul-state" is not a rule the generated config runs',
      'workerstack.config.ts: lint.skip[2].rules: "no-module-state" is not a rule the generated config runs',
    ],
  });
});
