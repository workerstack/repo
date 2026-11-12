/**
 * `bun repo env ls` and `get` through env-values.ts's `main(argv, deps)`; argv is what follows `bun repo env`, verb
 * first. The deps shape is spelled out in `__fixtures__/env-repo.ts`. Real temp git repos whose env files import
 * `@workerstack/repo/env` through a link to this checkout; every value is a fake made in the test.
 */
import { describe, expect, it } from "vitest";

import {
  cells,
  ENV_REL,
  envFile,
  envRepo,
  envRunner,
  fakeSecret,
  KEY_LABEL,
  shop,
  SPAWN,
  useEnvRepos,
} from "../__fixtures__/env-repo.ts";
import { newIdentity } from "../env/age.ts";
import { main } from "./env-values.ts";

const run = envRunner(main);
const GET_STRIPE = ["get", "STRIPE_SECRET_KEY", "--scope", "prod"];

useEnvRepos();

describe("env ls", () => {
  it("lists each key with its scope, kind, file and the tracked files that import the file and name it", async () => {
    const w = await envRepo(shop(fakeSecret()));
    const got = await run(w, ["ls"]);
    expect(got.code).toBe(0);
    expect(got.err).toBe("");
    const lines = got.out.split("\n");
    expect(lines.pop()).toBe("");
    expect(lines.map(cells)).toStrictEqual([
      ["KEY", "SCOPE", "KIND", "FILE", "USED BY"],
      ["APEX_DOMAIN", "global", "plain", ENV_REL, "projects/shop/deploy.ts"],
      ["STRIPE_SECRET_KEY", "prod", "sealed", ENV_REL, "projects/shop/deploy.ts, projects/shop/seed.ts"],
    ]);
    // Every column starts where its header does.
    const [header = "", ...rows] = lines;
    const starts = cells(header).map((cell) => header.indexOf(cell));

    for (const row of rows) {
      const parts = cells(row);
      expect(parts.map((cell, index) => row.indexOf(cell, starts[index]))).toStrictEqual(starts);
    }
  });

  it("needs no key and prints no value", async () => {
    const secret = fakeSecret();
    const w = await envRepo({ ...shop(secret), homeKey: null });
    const got = await run(w, ["ls"]);
    expect(got.code).toBe(0);
    expect(got.out).not.toContain(secret);
    expect(got.out).not.toContain("acme.io");
  });
});

describe("env get", () => {
  it("masks a sealed value: its first 10 characters, then …••••", SPAWN, async () => {
    const secret = fakeSecret();
    const w = await envRepo(shop(secret));
    const got = await run(w, GET_STRIPE);
    expect(got).toMatchObject({ code: 0, err: "", out: `${secret.slice(0, 10)}…••••\n` });
  });

  it("prints the whole value with --reveal", SPAWN, async () => {
    const secret = fakeSecret();
    const w = await envRepo(shop(secret));
    const got = await run(w, [...GET_STRIPE, "--reveal"]);
    expect(got).toMatchObject({ code: 0, err: "", out: `${secret}\n` });
  });

  it("reads a scope's merged view, global included", async () => {
    const w = await envRepo(shop(fakeSecret()));
    const got = await run(w, ["get", "APEX_DOMAIN", "--scope", "prod", "--reveal"]);
    expect(got).toMatchObject({ code: 0, err: "", out: "acme.io\n" });
  });

  it.each([
    ["abcdefghijk", "••••"],
    ["abcdefghijkl", "abcdefghij…••••"],
  ])("masks %s, a plain value, as %s", async (value, masked) => {
    const blocks = ["  local: {},", `  dev: { NOTE: ${JSON.stringify(value)} },`, "  prod: {},"];
    const w = await envRepo({ files: { [ENV_REL]: envFile(blocks) } });
    const got = await run(w, ["get", "NOTE", "--scope", "dev"]);
    expect(got).toMatchObject({ code: 0, err: "", out: `${masked}\n` });
  });
});

describe("env get, no key that opens it", () => {
  it("names key import when no key is at home", SPAWN, async () => {
    const w = await envRepo({ ...shop(fakeSecret()), homeKey: null });
    const got = await run(w, GET_STRIPE);
    expect(got).toMatchObject({
      code: 1,
      err: `repo env: STRIPE_SECRET_KEY is sealed and no key is at ${KEY_LABEL}; run \`bun repo env key import\`\n`,
      out: "",
    });
  });

  it("names key import with this repo's key when the key at home is another", SPAWN, async () => {
    const w = await envRepo({ ...shop(fakeSecret()), homeKey: await newIdentity() });
    const got = await run(w, GET_STRIPE);
    expect(got).toMatchObject({
      code: 1,
      err:
        `repo env: STRIPE_SECRET_KEY is sealed for another key than ${KEY_LABEL}; ` +
        "run `bun repo env key import` with this repo's key\n",
      out: "",
    });
  });
});
