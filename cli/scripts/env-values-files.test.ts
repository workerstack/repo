/**
 * Which env file a verb reads or writes, and the usage of a verb that is none, through env-command.ts's
 * `main(argv, deps)`; argv is what follows `bun repo env`, verb first. The deps shape is spelled out in
 * `__fixtures__/env-repo.ts`. Real temp git repos link `@workerstack/repo` to this checkout; every value is a fake.
 */
import { describe, expect, it } from "vitest";

import {
  envFile,
  envRepo,
  envRunner,
  fakeSecret,
  inShop,
  read,
  shop,
  SPAWN,
  twoFiles,
  USAGE,
  useEnvRepos,
  type Plant,
} from "../__fixtures__/env-repo.ts";
import { main } from "./env-command.ts";

const run = envRunner(main);
const BOTH = ["a/env.ts", "b/env.ts"];
const SET_NEW = ["set", "NEW_KEY", "--scope", "prod", "--plain"];

useEnvRepos();

describe("env file choice, set", () => {
  it("lists the env files when none declares the key, exit 1", async () => {
    const w = await envRepo(twoFiles());
    const before = BOTH.map((rel) => read(w, rel));
    const got = await run(w, SET_NEW, { stdin: "new.example\n" });
    expect(got).toMatchObject({ code: 1, err: "repo env: 2 env files: a/env.ts, b/env.ts; pass --file\n", out: "" });
    expect(BOTH.map((rel) => read(w, rel))).toStrictEqual(before);
  });

  it("writes the file --file names over the others", async () => {
    const w = await envRepo(twoFiles());
    const got = await run(w, [...SET_NEW, "--file", "b/env.ts"], { stdin: "new.example\n" });
    expect(got).toMatchObject({ code: 0, err: "", out: "repo env: wrote prod.NEW_KEY (plain) in b/env.ts\n" });
    expect(read(w, "b/env.ts")).toContain('NEW_KEY: "new.example"');
  });
});

describe("env file choice, get", () => {
  it("names --file when no defineEnv file declares the key", async () => {
    const w = await envRepo(shop(fakeSecret()));
    const got = await run(w, ["get", "STRIPE_SECRET_KEY_TYPO", "--scope", "prod"]);
    expect(got).toMatchObject({
      code: 1,
      err: "repo env: no defineEnv file declares STRIPE_SECRET_KEY_TYPO; pass --file <env file>\n",
      out: "",
    });
  });

  it("names --file when the repo has no defineEnv file", async () => {
    const w = await envRepo({ files: { "src/main.ts": "export const one = 1;\n" } });
    const got = await run(w, ["get", "APEX_DOMAIN", "--scope", "prod"]);
    expect(got).toMatchObject({
      code: 1,
      err: "repo env: no defineEnv file declares APEX_DOMAIN; pass --file <env file>\n",
      out: "",
    });
  });

  it("reads the one env file that declares the key", async () => {
    const w = await envRepo(twoFiles());
    const got = await run(w, ["get", "ONLY_B", "--scope", "prod", "--reveal"]);
    expect(got).toMatchObject({ code: 0, err: "", out: "b.example\n" });
  });
});

/** The one real env file, beside sources that only name `defineEnv(` in a string and in a comment. */
function mentions(): Plant {
  return {
    files: {
      "a/env.ts": envFile(["  local: {},", "  dev: {},", '  prod: { APEX_DOMAIN: "a.example" },']),
      "tools/comment.ts": "// Call defineEnv({ prod: {} }) in an env file.\nexport const one = 1;\n",
      "tools/hint.ts": 'export const HINT = "defineEnv({ prod: {} })";\n',
    },
  };
}

describe("env file choice, files that only name defineEnv", () => {
  it("set writes the one file that calls defineEnv", SPAWN, async () => {
    const w = await envRepo(mentions());
    const got = await run(w, SET_NEW, { stdin: "new.example\n" });
    expect(got).toMatchObject({ code: 0, err: "", out: "repo env: wrote prod.NEW_KEY (plain) in a/env.ts\n" });
  });

  it.each([
    ["run", ["run", "--scope", "prod", "--", "true"]],
    ["export", ["export", "--scope", "prod", "--format", "dotenv"]],
  ])("%s reads the one file that calls defineEnv", SPAWN, async (_label, argv) => {
    const w = await envRepo(mentions());
    const got = await run(w, argv);
    expect(got).toMatchObject({ code: 0, err: "" });
  });
});

describe("env usage", () => {
  it.each([
    ["no verb", []],
    ["an unknown verb", ["nope"]],
    ["key with no verb", ["key"]],
    ["an unknown key verb", ["key", "nope"]],
  ])("prints usage for %s, exit 4", async (_label, argv) => {
    expect(await inShop(run, argv)).toMatchObject({ code: 4, err: USAGE, out: "" });
  });
});
