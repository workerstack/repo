/**
 * `bun repo env migrate [--dry-run]` through env-command.ts's `main(argv, deps)` (deps spelled out in
 * `__fixtures__/env-repo.ts`), over the consumer of a fake `@acme/script-env` in `__fixtures__/script-env/tree.ts`: a
 * parent and a child createScriptEnv file, a helper-site file, and the package's defining file and test, which it
 * skips. Every secret is a fake made per test and is compared by sha256, never printed.
 *
 * The report, on stdout: a line per file, parents first, as `<rel>: <n> values; seal <a> secret() and <b> plain
 * credential(s) (<keys>); keep <k> plain[; left <s> spread in <block>]` (a zero part left out), then a line per helper
 * site `<rel>:<line> secretKeysOf → sealedKeys` or `<rel>:<line> unwrapSecrets → dropped`.
 */
import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { cipherOf, envRunner, IMPORT_SEALED, opened, read, SPAWN, useEnvRepos } from "../__fixtures__/env-repo.ts";
import {
  CHILD_HEAD,
  CHILD_REL,
  DEFINES_REL,
  FIXTURE_REL,
  HELPER_REL,
  hashesOf,
  hashOf,
  PARENT_REL,
  scriptRepo,
  scriptSecrets,
  sealedAt,
  TEST_REL,
} from "../__fixtures__/script-env/tree.ts";
import { main } from "./env-command.ts";

const run = envRunner(main);

/** What the TypeScript compiler reports on `file` with isolatedDeclarations and a declaration emit. */
function isolatedDiagnostics(file: string): string[] {
  const program = ts.createProgram([file], {
    allowImportingTsExtensions: true,
    declaration: true,
    emitDeclarationOnly: true,
    isolatedDeclarations: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    types: [],
  });

  const diagnostics = ts.getPreEmitDiagnostics(program, program.getSourceFile(file));

  return diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

const DRY_RUN = ["migrate", "--dry-run"];

useEnvRepos();

const REPORT = [
  "repo env: would migrate 2 files and 2 helper sites (nothing written):",
  `  ${PARENT_REL}: 6 values; seal 1 plain credential (STRIPE_SECRET_KEY); keep 5 plain`,
  `  ${CHILD_REL}: 5 values; seal 2 secret() and 1 plain credential (MAIL_API_KEY); keep 2 plain; ` +
    "left 1 spread in local",
  `  ${HELPER_REL}:5 secretKeysOf → sealedKeys`,
  `  ${HELPER_REL}:6 unwrapSecrets → dropped`,
  `repo env: skipped ${DEFINES_REL} (defines createScriptEnv), ${TEST_REL} (test)`,
  "",
].join("\n");

const MIGRATED = [
  "repo env: migrated 2 files and 2 helper sites; global, local, dev and prod values match createScriptEnv",
  "repo env: export refuses PRICE_TEMPLATE (it holds `$`); pass it with `bun repo env run`",
  "repo env: the 4 sealed values are still in git history; rotate them",
  "",
].join("\n");

describe("env migrate --dry-run", () => {
  it("reports each file, parents first, each helper site and each skip, and writes nothing", SPAWN, async () => {
    const w = await scriptRepo(scriptSecrets());
    const before = hashesOf(w);
    expect(await run(w, DRY_RUN)).toMatchObject({ code: 0, err: "", out: REPORT });
    expect(hashesOf(w)).toStrictEqual(before);
  });
});

describe("env migrate --dry-run, a fixture", () => {
  it("skips a __fixtures__ file that calls createScriptEnv, naming it a fixture", SPAWN, async () => {
    const w = await scriptRepo(scriptSecrets(), { fixture: true });
    const before = hashesOf(w);
    const out = REPORT.replace(`${TEST_REL} (test)\n`, `${TEST_REL} (test), ${FIXTURE_REL} (fixture)\n`);
    expect(await run(w, DRY_RUN)).toMatchObject({ code: 0, err: "", out });
    expect(hashesOf(w)).toStrictEqual(before);
  });
});

describe("env migrate, the rewrite", () => {
  it("rewrites the calls and helper sites, proves parity and names the `$` key and git history", SPAWN, async () => {
    const w = await scriptRepo(scriptSecrets());
    const before = hashesOf(w);
    expect(await run(w, ["migrate"])).toMatchObject({ code: 0, err: "", out: MIGRATED });
    const child = read(w, CHILD_REL);
    expect(child.startsWith(CHILD_HEAD.replace(/^.*\n/u, IMPORT_SEALED))).toBe(true);
    expect(child).toContain('defineEnv({\n  parent: repoEnv,\n  local: { ...localVars("shop"), PORT: "8787" },\n');
    expect(read(w, PARENT_REL)).toContain('    PRICE_TEMPLATE: "$9 a month",\n');
    expect(read(w, HELPER_REL)).toContain('shopEnv.sealedKeys("prod");\nexport const vars = shopEnv.prod;\n');
    const after = hashesOf(w);
    expect([after[DEFINES_REL], after[TEST_REL]]).toStrictEqual([before[DEFINES_REL], before[TEST_REL]]);
  });
});

describe("env migrate, the sealed values", () => {
  it("seals each secret() and flagged literal to reveal as the old value, none left in clear", SPAWN, async () => {
    const secrets = scriptSecrets();
    const w = await scriptRepo(secrets);
    const got = await run(w, ["migrate"]);
    expect(got.code).toBe(0);
    const files = Object.keys(hashesOf(w)).map((rel) => read(w, rel));

    const placed = sealedAt(secrets);
    const revealed = await Promise.all(placed.map(([rel, key]) => opened(w, cipherOf(read(w, rel), key))));
    expect(revealed.map(hashOf)).toStrictEqual(placed.map(([, , value]) => hashOf(value)));
    const printed = [got.out, got.err, ...files].join("\n");
    const leaked = placed.filter(([, , value]) => printed.includes(value));
    expect(leaked.map(([rel, key]) => `${rel} ${key}`)).toStrictEqual([]);
  });
});

describe("env migrate, a rerun", () => {
  it("finds nothing to migrate and writes nothing", SPAWN, async () => {
    const w = await scriptRepo(scriptSecrets());
    const first = await run(w, ["migrate"]);
    expect(first.code).toBe(0);
    const before = hashesOf(w);
    expect(await run(w, ["migrate"])).toMatchObject({ code: 0, err: "", out: "repo env: nothing to migrate\n" });
    expect(hashesOf(w)).toStrictEqual(before);
  });
});

describe("env migrate, one sealed value", () => {
  it("names the one sealed value left in git history", SPAWN, async () => {
    const w = await scriptRepo(scriptSecrets());

    // Deleted and not staged: only the parent, with its one flagged literal, is left to migrate.
    for (const rel of [CHILD_REL, HELPER_REL]) fs.rmSync(path.join(w.repo, rel));

    const got = await run(w, ["migrate"]);
    expect(got).toMatchObject({ code: 0, err: "" });

    expect(got.out.split("\n")).toStrictEqual([
      "repo env: migrated 1 file and 0 helper sites; global, local, dev and prod values match createScriptEnv",
      MIGRATED.split("\n")[1],
      "repo env: the 1 sealed value is still in git history; rotate them",
      "",
    ]);
  });
});

describe("env migrate, helper sites alone", () => {
  it("names what moved and claims no parity when no env was there to prove", SPAWN, async () => {
    const w = await scriptRepo(scriptSecrets());

    // Deleted and not staged: only the helper sites are left to migrate.
    for (const rel of [CHILD_REL, PARENT_REL]) fs.rmSync(path.join(w.repo, rel));

    const out = "repo env: migrated 0 files and 2 helper sites\n";
    expect(await run(w, ["migrate"])).toMatchObject({ code: 0, err: "", out });
  });
});

describe("env migrate, isolatedDeclarations", () => {
  it(
    "splits the config out and types the export where the nearest tsconfig, through extends, sets it",
    SPAWN,
    async () => {
      const w = await scriptRepo(scriptSecrets(), { isolated: true, spreadless: true });
      const got = await run(w, ["migrate"]);
      expect(got).toMatchObject({ code: 0, err: "" });
      const child = read(w, CHILD_REL);
      expect(child).toContain(
        'import { defineEnv, sealed, type EnvInstance, type Sealed } from "@workerstack/repo/env";\n',
      );
      expect(child).toContain("\nconst shopEnvConfig = {\n  parent: repoEnv as typeof repoEnv,\n");
      const typed = "export const shopEnv: EnvInstance<typeof shopEnvConfig> = defineEnv(shopEnvConfig);";
      expect(child).toContain(`\n} as const;\n${typed}\n`);
      expect(read(w, PARENT_REL)).toContain("export const repoEnv = defineEnv({\n");
      expect(isolatedDiagnostics(path.join(w.repo, CHILD_REL))).toStrictEqual([]);
    },
  );
});
