import { expect, it } from "vitest";

import type { LintSkip } from "../config.ts";
import { oxlintConfig } from "./oxlint-config.ts";
import { OFF_RULES } from "./oxlint-rules.ts";
import type { Workspace } from "./workspace.ts";

type Config = { overrides: unknown[]; rules: Record<string, unknown> };

const REASON = "the parsed config cache lives for the process";
const APP: Workspace = { manifest: { bin: "./bin/app.ts", name: "app" }, packages: [], root: "/repo" };

function configOf(skips: readonly LintSkip[] = []): Config {
  const built = oxlintConfig(APP, { skip: skips });
  if (!built.ok) throw new Error(built.errors.join("\n"));
  return JSON.parse(built.value) /* the config sync writes */ as Config;
}

it("oxlintConfig leaves script rules out of a skip's override, writing none for an entry of only them", () => {
  const skips = [
    { files: ["src/retry.ts"], reason: REASON, rules: ["repo/magic-number", "repo/magic-string"] },
    { files: ["src/user.ts"], reason: REASON, rules: ["repo/guard-rejects"] },
    { files: ["src/cache.ts"], reason: REASON, rules: ["repo/magic-number", "repo/no-module-state"] },
  ];
  expect(configOf(skips).overrides).toStrictEqual([
    ...configOf().overrides,
    { files: ["src/cache.ts"], rules: { "repo/no-module-state": "off" } },
  ]);
});

it("oxlintConfig accepts a skip of a rule an opt-out category turns on", () => {
  const skips = [{ files: ["src/a.ts"], reason: REASON, rules: ["unicorn/no-array-sort"] }];
  expect(configOf(skips).overrides).toStrictEqual([
    ...configOf().overrides,
    { files: ["src/a.ts"], rules: { "unicorn/no-array-sort": "off" } },
  ]);
});

it("oxlintConfig turns eslint/no-negated-condition off with a reason, as unicorn/no-negated-condition owns it", () => {
  expect(OFF_RULES).toHaveProperty("eslint/no-negated-condition");
  expect(configOf().rules).toMatchObject({
    "eslint/no-negated-condition": "off",
    "unicorn/no-negated-condition": "error",
  });
});
