import { expect, it } from "vitest";
import { oxlintConfig } from "./oxlint-config.ts";

const REASON = "the parsed config cache lives for the process";
const APP = { root: "/repo", manifest: { name: "app", bin: "./bin/app.ts" }, packages: [] };

it("oxlintConfig refuses a rule the generated config does not run, naming the entry", () => {
  const skips = [
    { files: ["src/a.ts"], rules: ["repo/no-module-state"], reason: REASON },
    { files: ["src/b.ts"], rules: ["eslint/no-console", "repo/no-modul-state"], reason: REASON },
    { files: ["src/c.ts"], rules: ["no-module-state"], reason: REASON },
  ];
  expect(oxlintConfig(APP, skips)).toStrictEqual({
    ok: false,
    errors: [
      'workerstack.config.ts: lint.skip[1].rules: "repo/no-modul-state" is not a rule the generated config runs',
      'workerstack.config.ts: lint.skip[2].rules: "no-module-state" is not a rule the generated config runs',
    ],
  });
});

it("oxlintConfig refuses a skip of a rule the base turns off", () => {
  const skips = [{ files: ["src/a.ts"], rules: ["typescript/no-unsafe-type-assertion"], reason: REASON }];
  expect(oxlintConfig(APP, skips)).toStrictEqual({
    ok: false,
    errors: [
      'workerstack.config.ts: lint.skip[0].rules: "typescript/no-unsafe-type-assertion" is not a rule the generated config runs',
    ],
  });
});

it("oxlintConfig refuses a skip of a restriction rule, which no category the base runs lists", () => {
  const skips = [{ files: ["src/a.ts"], rules: ["unicorn/no-array-for-each"], reason: REASON }];
  expect(oxlintConfig(APP, skips)).toStrictEqual({
    ok: false,
    errors: [
      'workerstack.config.ts: lint.skip[0].rules: "unicorn/no-array-for-each" is not a rule the generated config runs',
    ],
  });
});
