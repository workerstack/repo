/**
 * `bun repo env key ci` through env-keys.ts's `main(argv, deps)`; argv is what follows `bun repo env`, verb first.
 * The deps shape is spelled out in `__fixtures__/env-repo.ts`. Real temp git repos and a temp HOME; every key is made
 * in the test, and the fake gh records what it was given.
 */
import { describe, expect, it } from "vitest";

import {
  envRepo,
  envRunner,
  KEY_LABEL,
  keyFileIn,
  keysFileFor,
  NO_KEYS_FILE,
  short,
  SPAWN,
  useEnvRepos,
  type EnvWorld,
} from "../__fixtures__/env-repo.ts";
import { newIdentity, type AgeKeyPair } from "../env/age.ts";
import { main } from "./env-keys.ts";

const DRY_RUN = "repo env: would run: gh secret set WORKERSTACK_ENV_KEY (the key on stdin)\n";
const CI = ["key", "ci"];
const run = envRunner(main);

useEnvRepos();

/** A repo whose keys file names `owner`, a new pair, with `atHome` (the owner's key by default) as HOME's acme.key. */
async function ownedRepo(atHome?: string): Promise<{ w: EnvWorld; owner: AgeKeyPair }> {
  const w = await envRepo({ keyed: false, linked: false });
  const owner = await newIdentity();
  keysFileFor(w.repo, owner.recipient);
  keyFileIn(w.home, "acme.key", atHome ?? owner.identity);

  return { owner, w };
}

describe("env key ci", () => {
  it("hands gh the one of several keys that unlocks the repo, on stdin only", SPAWN, async () => {
    const w = await envRepo({ keyed: false, linked: false });
    const stranger = await newIdentity();
    const owner = await newIdentity();
    keysFileFor(w.repo, owner.recipient);
    // Sorted first, and the match is not named for the repo: the pick goes by recipient.
    keyFileIn(w.home, "aaa.key", stranger.identity);
    keyFileIn(w.home, "zzz.key", owner.identity);
    const got = await run(w, CI);
    expect(got.code).toBe(0);
    expect(got.gh).toHaveLength(1);
    const [call] = got.gh;
    expect(call?.args).toStrictEqual(["secret", "set", "WORKERSTACK_ENV_KEY"]);
    expect(call?.input.trim()).toBe(owner.identity);
    expect(`${got.out}${got.err}`).not.toContain(owner.identity);
  });

  it("takes the key from WORKERSTACK_ENV_KEY when it is set", SPAWN, async () => {
    const w = await envRepo({ keyed: false, linked: false });
    const owner = await newIdentity();
    keysFileFor(w.repo, owner.recipient);
    const got = await run(w, CI, { env: { WORKERSTACK_ENV_KEY: owner.identity } });
    expect(got.code).toBe(0);
    expect(got.gh.map((call) => call.input.trim())).toStrictEqual([owner.identity]);
  });

  it("prints the gh call on --dry-run and runs nothing", SPAWN, async () => {
    const { w } = await ownedRepo();
    const got = await run(w, [...CI, "--dry-run"]);
    expect(got).toMatchObject({ code: 0, err: "", gh: [], out: DRY_RUN });
  });
});

describe("env key ci refusals", () => {
  it("names key import when no key unlocks the repo, and runs no gh", SPAWN, async () => {
    const stranger = await newIdentity();
    const { w } = await ownedRepo(stranger.identity);
    const got = await run(w, CI);
    expect(got.code).toBe(1);
    expect(got.err).toMatch(/^repo env: .*\n$/u);
    expect(got.err).toContain(`no key is at ${KEY_LABEL}; run \`bun repo env key import\``);
    expect(got.gh).toStrictEqual([]);
  });
});

describe("env key ci, a WORKERSTACK_ENV_KEY for another key", () => {
  it("names WORKERSTACK_ENV_KEY when it is set and does not unlock the repo", SPAWN, async () => {
    const stranger = await newIdentity();
    const { owner, w } = await ownedRepo();
    const got = await run(w, CI, { env: { WORKERSTACK_ENV_KEY: stranger.identity } });
    expect(got).toMatchObject({
      code: 1,
      err:
        `repo env: WORKERSTACK_ENV_KEY does not unlock ${short(owner.recipient)}; ` +
        "unset it or run `bun repo env key import`\n",
      gh: [],
    });
  });
});

describe("env key ci, gh and the keys file", () => {
  it("fails on one line when gh fails, the key not in it", SPAWN, async () => {
    const { owner, w } = await ownedRepo();
    const got = await run(w, CI, { ghCode: 1 });
    expect(got.code).toBe(1);
    expect(got.err).toMatch(/^repo env: [^\n]*\n$/u);
    expect(got.err).not.toContain(owner.identity);
  });

  it("names init when the repo has no keys file", async () => {
    const w = await envRepo({ keyed: false, linked: false });
    const got = await run(w, CI);
    expect(got).toMatchObject({ code: 1, err: NO_KEYS_FILE, gh: [], out: "" });
  });
});
