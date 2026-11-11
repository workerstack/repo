import { expect, it } from "vitest";

import { loadConfig } from "./config.ts";
import {
  AGENTS,
  CI,
  COMMIT,
  COVERAGE,
  KNIP,
  LINT,
  NIGHTLY,
  linkPackage,
  refusal,
  repo,
  useConfigKit,
} from "./fixtures/config-kit.ts";

useConfigKit();

const SKIP = {
  files: ["src/cache.ts"],
  reason: "the parsed config cache lives for the process",
  rules: ["repo/no-module-state"],
};
const NO_REASON = "say why the rules are off, in three words or more";
/** A config with the agents and standards packs, or `packs`, and one `lint.skip` entry. */
const skipConfig = (skip: unknown, packs = '["agents", "standards"]') =>
  `export default { packs: ${packs}, lint: { skip: [${JSON.stringify(skip)}] } }\n`;

it("lint.skip: Usage's config resolves to its skip entries", async () => {
  const lint = `  lint: {\n    skip: [${JSON.stringify(SKIP)}],\n  },\n`;
  const usage = `export default defineConfig({\n  packs: ["agents", "standards"],\n${lint}});\n`;
  const root = repo(`import { defineConfig } from "@workerstack/repo";\n\n${usage}`);
  linkPackage(root);
  expect(await loadConfig(root)).toEqual({
    config: {
      agents: AGENTS,
      ci: CI,
      commit: COMMIT,
      coverage: COVERAGE,
      knip: KNIP,
      lint: { skip: [SKIP] },
      nightly: NIGHTLY,
      packs: ["agents", "standards"],
      tdd: false,
    },
    ok: true,
  });
});

it("lint.skip: defaults to no skips, with lint omitted or empty, the default packs included", async () => {
  const empty = { config: { ci: CI, coverage: COVERAGE, knip: KNIP, lint: LINT }, ok: true };
  expect(await loadConfig(repo('export default { packs: ["standards"], lint: {} }\n'))).toMatchObject(empty);
  expect(await loadConfig(repo('export default { packs: ["standards"] }\n'))).toMatchObject(empty);
  expect(await loadConfig(repo("export default { lint: { skip: [] } }\n"))).toMatchObject(empty);
});

it("lint.skip: refuses an entry without a reason, or with a reason under three words", async () => {
  const { reason: _, ...noReason } = SKIP;
  expect(await loadConfig(repo(skipConfig(noReason)))).toStrictEqual(refusal(`lint.skip[0].reason: ${NO_REASON}`));
  const short = skipConfig({ ...SKIP, reason: "cache state" });
  expect(await loadConfig(repo(short))).toStrictEqual(refusal(`lint.skip[0].reason: ${NO_REASON}`));
});

it("lint.skip: refuses an entry with no files or no rules", async () => {
  expect(await loadConfig(repo(skipConfig({ ...SKIP, files: [] })))).toStrictEqual(
    refusal("lint.skip[0].files: list at least one file glob"),
  );
  expect(await loadConfig(repo(skipConfig({ ...SKIP, rules: [] })))).toStrictEqual(
    refusal('lint.skip[0].rules: list at least one rule, like "repo/no-module-state"'),
  );
});

it("lint.skip: refuses an unknown key in an entry and under lint", async () => {
  expect(await loadConfig(repo(skipConfig({ ...SKIP, rule: "x" })))).toStrictEqual(
    refusal('lint.skip[0]: unknown key "rule"'),
  );
  const misspelt = 'export default { packs: ["standards"], lint: { skips: [] } }\n';
  expect(await loadConfig(repo(misspelt))).toStrictEqual(refusal('lint: unknown key "skips"'));
});

it.each(['["docs"]', "[]"])("lint.skip: refuses lint without the standards pack (packs %s)", async (list) => {
  expect(await loadConfig(repo(skipConfig(SKIP, list)))).toStrictEqual(
    refusal('lint: set only with the standards pack; add "standards" to packs or delete lint'),
  );
});

/** A standards config whose `lint.tailwind.entryPoint` is `entryPoint`. */
function tailwindConfig(entryPoint: unknown): string {
  return `export default { packs: ["standards"], lint: { tailwind: { entryPoint: ${JSON.stringify(entryPoint)} } } }\n`;
}

it("lint.tailwind: Usage's entryPoint resolves as written", async () => {
  expect(await loadConfig(repo(tailwindConfig("apps/web/src/app.css")))).toMatchObject({
    config: { lint: { skip: [], tailwind: { entryPoint: "apps/web/src/app.css" } } },
    ok: true,
  });
});

it.each(["/srv/app.css", "../app.css", "src/../../app.css", "src/app.scss", "", 7])(
  "lint.tailwind.entryPoint: refuses %j",
  async (entryPoint) => {
    expect(await loadConfig(repo(tailwindConfig(entryPoint)))).toStrictEqual(
      refusal("lint.tailwind.entryPoint: must be a repo-relative path to a .css file"),
    );
  },
);
