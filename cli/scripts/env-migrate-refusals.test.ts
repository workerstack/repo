/**
 * What `bun repo env migrate` refuses through env-command.ts's `main(argv, deps)`, over the tree of
 * `__fixtures__/script-env/tree.ts` (see env-migrate.test.ts): each refusal exits 1 on one stderr line with every file
 * as it was, and a bad argument prints the usage line, exit 4. The rollback is driven by a keys file naming another
 * recipient, so the new files seal for a key HOME does not hold and the fresh child cannot read them.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  envRunner,
  keysFileFor,
  NO_KEYS_FILE,
  plant,
  SPAWN,
  USAGE,
  useEnvRepos,
  type EnvWorld,
} from "../__fixtures__/env-repo.ts";
import {
  CHILD_REL,
  hashesOf,
  OLD_IMPORT,
  scriptRepo,
  scriptSecrets,
  sealedAt,
} from "../__fixtures__/script-env/tree.ts";
import { newIdentity } from "../env/age.ts";
import { main } from "./env-command.ts";

const run = envRunner(main);
const FACTORY_REL = "projects/shop/factory.ts";
const NOT_EXPORTED = "createScriptEnv call is not an exported const; export it or migrate it by hand";

/** What migrate in `w` exits with and prints, and whether every file is as it was. */
async function migrateIn(w: EnvWorld): Promise<{ code: number; err: string; out: string; isUnchanged: boolean }> {
  const before = hashesOf(w);
  const { code, err, out } = await run(w, ["migrate"]);

  return { code, err, isUnchanged: JSON.stringify(hashesOf(w)) === JSON.stringify(before), out };
}

/** A refusal on `err` alone, every file as it was. */
function refused(err: string): { code: number; err: string; out: string; isUnchanged: boolean } {
  return { code: 1, err, isUnchanged: true, out: "" };
}

// The class of what the load threw, never its message: a message may quote a value.
const LOAD_FAILED = "repo env: could not load tools.script-env.ts before migrating (Error)\n";

useEnvRepos();

describe("env migrate, before any write", () => {
  it("refuses a repo with no keys file, naming init", SPAWN, async () => {
    const w = await scriptRepo(scriptSecrets(), { keyed: false });
    const before = hashesOf(w);
    expect(await run(w, ["migrate"])).toMatchObject({ code: 1, err: NO_KEYS_FILE, out: "" });
    expect(hashesOf(w)).toStrictEqual(before);
  });

  it("refuses when an old file throws as it loads, naming it and the class it threw", SPAWN, async () => {
    const w = await scriptRepo(scriptSecrets(), { broken: true });
    const before = hashesOf(w);
    const got = await run(w, ["migrate"]);
    expect(got).toMatchObject({ code: 1, err: LOAD_FAILED, out: "" });
    expect(hashesOf(w)).toStrictEqual(before);
  });
});

describe("env migrate, files it cannot prove or recover", () => {
  it("refuses a file with uncommitted changes, so `git restore` can always take it back", SPAWN, async () => {
    const w = await scriptRepo(scriptSecrets());
    fs.appendFileSync(path.join(w.repo, CHILD_REL), "// an edit not yet committed\n");
    expect(await migrateIn(w)).toStrictEqual(
      refused(`repo env: ${CHILD_REL} has uncommitted changes; commit or stash them first\n`),
    );
  });

  it("refuses a call bound to no exported const, before any write", SPAWN, async () => {
    const w = await scriptRepo(scriptSecrets());
    plant(w, { [FACTORY_REL]: `${OLD_IMPORT}\nexport default createScriptEnv({ local: {}, dev: {}, prod: {} });\n` });
    expect(await migrateIn(w)).toStrictEqual(refused(`repo env: ${FACTORY_REL}:3 ${NOT_EXPORTED}\n`));
  });

  it("refuses a spread where isolatedDeclarations is set, naming the file and block", SPAWN, async () => {
    const w = await scriptRepo(scriptSecrets(), { isolated: true });
    const why = "isolatedDeclarations needs each value written out";
    expect(await migrateIn(w)).toStrictEqual(refused(`repo env: ${CHILD_REL} local has a spread; ${why}\n`));
  });
});

describe("env migrate, after the writes", () => {
  it("restores every original when the migrated files cannot be read back", SPAWN, async () => {
    const secrets = scriptSecrets();
    const w = await scriptRepo(secrets);
    const other = await newIdentity();
    keysFileFor(w.repo, other.recipient);
    const before = hashesOf(w);
    const got = await run(w, ["migrate"]);
    expect(got).toMatchObject({ code: 1, out: "" });
    expect(got.err).toMatch(/^repo env: could not read the migrated files \([^\n]+\); restored 3 files\n$/u);
    expect(sealedAt(secrets).some(([, , value]) => got.err.includes(value))).toBe(false);
    // Every original byte back, and no temp file left beside any of them.
    expect(hashesOf(w)).toStrictEqual(before);
  });
});

describe("env migrate, a value that differs", () => {
  it("restores every original when a value reads otherwise from the migrated files", SPAWN, async () => {
    // The child's local spread holds the pid of the process that loads it: each read sees another value.
    const w = await scriptRepo(scriptSecrets(), { pid: true });
    expect(await migrateIn(w)).toStrictEqual(
      refused(`repo env: ${CHILD_REL} local.LOCAL_PREFIX differs after migrate; restored 3 files\n`),
    );
  });
});

describe("env migrate, usage", () => {
  it.each([[["migrate", "--force"]], [["migrate", "--dry-run", "extra"]], [["nope"]]])(
    "prints the usage line, which names migrate, for %j",
    SPAWN,
    async (argv) => {
      const w = await scriptRepo(scriptSecrets());
      expect(await run(w, argv)).toMatchObject({ code: 4, err: USAGE, out: "" });
    },
  );
});
