/**
 * `bun repo env set` of a sealed value through env-edit.ts's `main(argv, deps)`; argv is what follows `bun repo env`,
 * verb first. The deps shape is spelled out in `__fixtures__/env-repo.ts`. Real temp git repos whose env files import
 * `@workerstack/repo/env` through a link to this checkout; every value is a fake made in the test, and a sealed one is
 * checked by revealing the file's cipher with the test's own key.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  cipherOf,
  ENV_REL,
  envRepo,
  envRunner,
  fakeSecret,
  IMPORT_SEALED,
  opened,
  plant,
  read,
  shopEnv,
  SPAWN,
  useEnvRepos,
  withoutCipher,
} from "../__fixtures__/env-repo.ts";
import { seal } from "../env/age.ts";
import { main } from "./env-edit.ts";

const run = envRunner(main);
const STRIPE = "STRIPE_SECRET_KEY";

useEnvRepos();

describe("env set, sealed", () => {
  it("appends a sealed value to the scope block, adds the sealed import, keeps the rest", SPAWN, async () => {
    const w = await envRepo({ files: { [ENV_REL]: shopEnv([]) } });
    const value = fakeSecret();
    const got = await run(w, ["set", STRIPE, "--scope", "prod"], { stdin: `${value}\n` });
    expect(got).toMatchObject({ code: 0, err: "", out: `repo env: sealed prod.${STRIPE} in ${ENV_REL}\n` });
    const text = read(w);
    expect(withoutCipher(text, STRIPE)).toBe(shopEnv([`    ${STRIPE}: sealed("CIPHER"),`], IMPORT_SEALED));
    // The trailing newline of the piped value is dropped.
    expect(await opened(w, cipherOf(text, STRIPE))).toBe(value);
    expect(text).not.toContain(value);
    expect(`${got.out}${got.err}`).not.toContain(value);
  });

  it("replaces a sealed value in place, the import left as it is", SPAWN, async () => {
    const w = await envRepo();
    const old = await seal(fakeSecret(), String(w.key?.recipient));
    const before = shopEnv([`    ${STRIPE}: sealed("${old}"),`], IMPORT_SEALED);
    plant(w, { [ENV_REL]: before });
    const value = fakeSecret();
    const got = await run(w, ["set", STRIPE, "--scope", "prod"], { stdin: value });
    expect(got.code).toBe(0);
    const cipher = cipherOf(read(w), STRIPE);
    expect(cipher).not.toBe(old);
    expect(read(w)).toBe(before.replace(old, cipher));
    expect(await opened(w, cipher)).toBe(value);
  });
});

describe("env set, sealed, from a terminal", () => {
  it("reads the value from a hidden prompt on a terminal", SPAWN, async () => {
    const w = await envRepo({ files: { [ENV_REL]: shopEnv([]) } });
    const value = fakeSecret();
    const got = await run(w, ["set", STRIPE, "--scope", "dev"], { tty: value });
    expect(got).toMatchObject({ code: 0, out: `repo env: sealed dev.${STRIPE} in ${ENV_REL}\n` });
    expect(await opened(w, cipherOf(read(w), STRIPE))).toBe(value);
  });

  it("leaves no temp file beside the env file", SPAWN, async () => {
    const w = await envRepo({ files: { [ENV_REL]: shopEnv([]) } });
    await run(w, ["set", STRIPE, "--scope", "prod"], { stdin: fakeSecret() });
    expect(fs.readdirSync(path.join(w.repo, "projects/shop"))).toStrictEqual(["env.ts"]);
  });
});
