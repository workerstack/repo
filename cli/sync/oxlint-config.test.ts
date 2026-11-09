import { describe, expect, it } from "vitest";
import { oxlintConfig } from "./oxlint-config.ts";
import type { PackageJson, Workspace } from "./workspace.ts";

const workspace = (manifest: PackageJson, packages: Workspace["packages"] = []): Workspace => ({
  root: "/repo",
  manifest,
  packages,
});
const configOf = (ws: Workspace): unknown => JSON.parse(oxlintConfig(ws));

const SIZE = { skipBlankLines: true, skipComments: true };
const OFF = Object.fromEntries(
  ["correctness", "suspicious", "pedantic", "perf", "style", "restriction", "nursery"].map((name) => [name, "off"]),
);
const REPO_RULES = {
  "repo/boundaries": "error",
  "repo/no-module-side-effects": "error",
  "repo/no-module-state": "error",
  "repo/no-side-effect-import": "error",
  "repo/no-v8-ignore": "error",
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
  it("lets each bin of the root and every package run at import, and each ./lint export default-export", () => {
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
        { files: ["lint/index.ts", "packages/rules/cli/lint/index.ts"], rules: { "import/no-default-export": "off" } },
      ],
    });
  });

  it("reads no override from a bin or ./lint export of another shape", () => {
    const ws = workspace({ bin: 7, exports: "./index.ts" }, [
      { dir: "a", manifest: { bin: { a: 1 }, exports: { "./lint": { import: "./lint.ts" } } } },
      { dir: "b", manifest: { bin: ["./bin/b.ts"], exports: { "./lint": 3 } } },
      { dir: "c", manifest: { bin: null, exports: null } },
    ]);
    expect(configOf(ws)).toMatchObject({ overrides: [TEST_OVERRIDE, CONFIG_OVERRIDE] });
    expect((configOf(ws) as { overrides: unknown[] }).overrides).toHaveLength(2);
  });
});
