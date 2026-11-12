/**
 * `bun repo env set` refusing, through env-edit.ts's `main(argv, deps)`: every refusal leaves the env file as it was.
 * The deps shape is spelled out in `__fixtures__/env-repo.ts`; real temp git repos link `@workerstack/repo` to this
 * checkout, every value a fake made in the test.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ENV_REL,
  envRepo,
  envRunner,
  fakeSecret,
  IMPORT,
  NO_KEYS_FILE,
  read,
  shopEnv,
  SPAWN,
  USAGE,
  useEnvRepos,
} from "../__fixtures__/env-repo.ts";
import { main } from "./env-edit.ts";

const run = envRunner(main);
const unkeyed = { files: { [ENV_REL]: shopEnv([]) }, keyed: false };

/** An env file whose config a function builds: no block to edit. */
const BUILT = [
  IMPORT,
  "function makeConfig() {",
  "  return { local: {}, dev: {}, prod: {} };",
  "}",
  "",
  "export const shopEnv = defineEnv(makeConfig());",
  "",
].join("\n");

useEnvRepos();

describe("env set refusals leave the file untouched", () => {
  it("names init when a sealed value has no keys file to seal for", async () => {
    const w = await envRepo(unkeyed);
    const got = await run(w, ["set", "STRIPE_SECRET_KEY", "--scope", "prod"], { stdin: fakeSecret() });
    expect(got).toMatchObject({ code: 1, err: NO_KEYS_FILE, out: "" });
    expect(read(w)).toBe(shopEnv([]));
  });

  it("refuses a config it cannot edit, on one line", SPAWN, async () => {
    const w = await envRepo({ files: { [ENV_REL]: BUILT } });
    const value = fakeSecret();
    const got = await run(w, ["set", "STRIPE_SECRET_KEY", "--scope", "prod", "--file", ENV_REL], { stdin: value });
    expect(got.code).toBe(1);
    expect(got.err).toMatch(/^repo env: [^\n]*\n$/u);
    expect(got.err).not.toContain(value);
    expect(read(w)).toBe(BUILT);
    expect(fs.readdirSync(path.join(w.repo, "projects/shop"))).toStrictEqual(["env.ts"]);
  });
});

describe("env set, a write that fails", () => {
  it("removes its temp file and leaves the env file as it was when the rename fails", SPAWN, async () => {
    const w = await envRepo(unkeyed);
    const file = path.join(w.repo, ENV_REL);
    const kept = `${file}.kept`;
    let err = "";

    function print(s: string): void {
      err += s;
    }

    const code = await main(["set", "APEX_DOMAIN", "--scope", "prod", "--plain"], {
      cwd: w.repo,
      env: {},
      home: w.home,
      isTTY: false,
      stderr: print,
      // Read after the dry edit: the env file is moved aside and a folder takes its name, so the rename fails.
      stdin: () => {
        fs.renameSync(file, kept);
        fs.mkdirSync(file);

        return Promise.resolve("acme.io\n");
      },
      stdout: print,
    });

    expect(code).toBe(1);
    expect(err).toMatch(/^repo env: [^\n]*\n$/u);
    expect(fs.readdirSync(path.dirname(file)).toSorted()).toStrictEqual(["env.ts", "env.ts.kept"]);
    expect(fs.readdirSync(file)).toStrictEqual([]);
    expect(fs.readFileSync(kept, "utf8")).toBe(shopEnv([]));
  });
});

describe("env set usage", () => {
  it.each([
    ["a scope that is none of the four", ["APEX_DOMAIN", "--scope", "staging", "--plain"]],
    ["no scope", ["APEX_DOMAIN", "--plain"]],
    ["no key", ["--scope", "prod", "--plain"]],
    ["a value in argv", ["APEX_DOMAIN", "acme.io", "--scope", "prod", "--plain"]],
  ])("prints usage for %s, exit 4", async (_label, argv) => {
    const w = await envRepo(unkeyed);
    const got = await run(w, ["set", ...argv], { stdin: "acme.io\n" });
    expect(got).toMatchObject({ code: 4, err: USAGE, out: "" });
    expect(read(w)).toBe(shopEnv([]));
  });
});
