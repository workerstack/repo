/**
 * `bun repo env key import` through env-keys.ts's `main(argv, deps)`; argv is what follows `bun repo env`, verb
 * first. The deps shape is spelled out in `__fixtures__/env-repo.ts`. Real temp git repos and a temp HOME; every key
 * is made in the test.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  envRepo,
  envRunner,
  KEY_LABEL,
  KEY_REL,
  keysFileFor,
  KEY_FILE_MODE,
  modeOf,
  NO_KEYS_FILE,
  short,
  SPAWN,
  useEnvRepos,
  type EnvWorld,
} from "../__fixtures__/env-repo.ts";
import { newIdentity } from "../env/age.ts";
import { main } from "./env-keys.ts";

const run = envRunner(main);
const IMPORT_KEY = ["key", "import"];

useEnvRepos();

/** A repo whose keys file names a new pair, the key at no HOME yet. */
async function keyedRepo(): Promise<{ w: EnvWorld; identity: string; recipient: string }> {
  const w = await envRepo({ keyed: false, linked: false });
  const { identity, recipient } = await newIdentity();
  keysFileFor(w.repo, recipient);

  return { identity, recipient, w };
}

describe("env key import", () => {
  it("saves a pasted key that unlocks the repo's recipient, 0600", SPAWN, async () => {
    const { identity, w } = await keyedRepo();
    const got = await run(w, IMPORT_KEY, { stdin: `${identity}\n` });
    expect(got).toMatchObject({
      code: 0,
      err: "",
      out: `repo env: saved ${KEY_LABEL} (0600); it unlocks .repo/env.keys.json's recipient\n`,
    });
    const keyFile = path.join(w.home, KEY_REL);
    expect(modeOf(keyFile)).toBe(KEY_FILE_MODE);
    expect(fs.readFileSync(keyFile, "utf8").trim()).toBe(identity);
    expect(got.out).not.toContain(identity);
  });

  it("reads the key from a hidden prompt on a terminal", SPAWN, async () => {
    const { identity, w } = await keyedRepo();
    const got = await run(w, IMPORT_KEY, { tty: identity });
    expect(got.code).toBe(0);
    expect(got.prompts).toHaveLength(1);
    expect(fs.readFileSync(path.join(w.home, KEY_REL), "utf8").trim()).toBe(identity);
  });

  it("says already set up when the same key is imported again", SPAWN, async () => {
    const { identity, w } = await keyedRepo();
    await run(w, IMPORT_KEY, { stdin: `${identity}\n` });
    const got = await run(w, IMPORT_KEY, { stdin: `${identity}\n` });
    expect(got).toMatchObject({ code: 0, err: "", out: "repo env: already set up (acme)\n" });
  });
});

describe("env key import refusals", () => {
  it.each([
    [
      "another repo's key",
      async () => {
        const other = await newIdentity();

        return other.identity;
      },
    ],
    ["text that is no key", () => Promise.resolve("not an age key")],
  ])("refuses %s and saves nothing", SPAWN, async (_label, pasted) => {
    const { recipient, w } = await keyedRepo();
    const text = await pasted();
    const got = await run(w, IMPORT_KEY, { stdin: `${text}\n` });
    expect(got).toMatchObject({
      code: 1,
      err: `repo env: the pasted key does not unlock ${short(recipient)}; paste this repo's key\n`,
      out: "",
    });
    expect(fs.existsSync(path.join(w.home, KEY_REL))).toBe(false);
  });

  it("names init when the repo has no keys file", async () => {
    const w = await envRepo({ keyed: false, linked: false });
    const { identity } = await newIdentity();
    const got = await run(w, IMPORT_KEY, { stdin: `${identity}\n` });
    expect(got).toMatchObject({ code: 1, err: NO_KEYS_FILE, out: "" });
    expect(fs.existsSync(path.join(w.home, KEY_REL))).toBe(false);
  });
});
