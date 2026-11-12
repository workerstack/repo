import { expect, it } from "vitest";

import { oxlintConfig } from "./oxlint-config.ts";

const REASON = "the parsed config cache lives for the process";
const APP = { manifest: { bin: "./bin/app.ts", name: "app" }, packages: [], root: "/repo" };

it("oxlintConfig refuses a rule the generated config does not run, naming the entry", () => {
  const skips = [
    { files: ["src/a.ts"], reason: REASON, rules: ["repo/no-module-state"] },
    { files: ["src/b.ts"], reason: REASON, rules: ["eslint/no-console", "repo/no-modul-state"] },
    { files: ["src/c.ts"], reason: REASON, rules: ["no-module-state"] },
  ];

  expect(oxlintConfig(APP, { skip: skips })).toStrictEqual({
    errors: [
      'workerstack.config.ts: lint.skip[1].rules: "repo/no-modul-state" is not a rule the generated config runs',
      'workerstack.config.ts: lint.skip[2].rules: "no-module-state" is not a rule the generated config runs',
    ],
    ok: false,
  });
});

it("oxlintConfig refuses a skip of a rule the base turns off", () => {
  const skips = [{ files: ["src/a.ts"], reason: REASON, rules: ["typescript/no-unsafe-type-assertion"] }];
  expect(oxlintConfig(APP, { skip: skips })).toStrictEqual({
    errors: [
      'workerstack.config.ts: lint.skip[0].rules: "typescript/no-unsafe-type-assertion" ' +
        "is not a rule the generated config runs",
    ],
    ok: false,
  });
});

it("oxlintConfig refuses a skip of a restriction rule, which no category the base runs lists", () => {
  const skips = [{ files: ["src/a.ts"], reason: REASON, rules: ["eslint/no-plusplus"] }];
  expect(oxlintConfig(APP, { skip: skips })).toStrictEqual({
    errors: ['workerstack.config.ts: lint.skip[0].rules: "eslint/no-plusplus" is not a rule the generated config runs'],
    ok: false,
  });
});
