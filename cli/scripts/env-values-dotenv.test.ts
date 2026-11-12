/**
 * `bun repo env export --format dotenv` through env-values.ts's `main(argv, deps)`; argv is what follows
 * `bun repo env`, verb first. The deps shape is spelled out in `__fixtures__/env-repo.ts`. Each value is read back
 * by a bun child given the output as `--env-file`, which prints only hashes. Every value is a fake made in the test.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ENV_REL,
  envFile,
  envRepo,
  envRunner,
  fakeSecret,
  inShop,
  SPAWN,
  USAGE,
  useEnvRepos,
} from "../__fixtures__/env-repo.ts";
import { seal } from "../env/age.ts";
import { main } from "./env-values.ts";

const run = envRunner(main);
const EXPORT = ["export", "--scope", "dev", "--format", "dotenv"];

/** The child: each name it is given, with the hash of the value its env file set. */
const READ_BACK =
  "const hash = (v) => new Bun.CryptoHasher('sha256').update(v).digest('hex');" +
  "console.log(JSON.stringify(Object.fromEntries(process.argv.slice(1).map((k) => [k, hash(process.env[k] ?? '')]))))";

useEnvRepos();

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** The values as bun's `--env-file` reads `dotenv` back, hashed. */
function readBack(dir: string, dotenv: string, names: string[]): unknown {
  const file = path.join(dir, "out.env");
  fs.writeFileSync(file, dotenv);

  const child = spawnSync(process.execPath, [`--env-file=${file}`, "-e", READ_BACK, ...names], {
    encoding: "utf8",
    env: { PATH: "" },
  });

  return JSON.parse(child.stdout);
}

/** The dev values each quoting is picked for. */
const VALUES: Record<string, string> = {
  BACKSLASH: "C:\\dir\\new",
  BOTH: `it's "quoted"`,
  CR: "one\rtwo",
  JSON: '{"a":"line\\nnext"}',
  LINES: "one\ntwo",
  QUOTED: 'say "hi"',
};

describe("env export", () => {
  it("prints each value as dotenv that bun's --env-file reads back the same, sorted", SPAWN, async () => {
    const secret = fakeSecret();

    const w = await envRepo({
      files: async (key) => ({
        [ENV_REL]: envFile([
          '  global: { APEX_DOMAIN: "anyrow.io" },',
          "  local: {},",
          `  dev: { ${Object.entries(VALUES)
            .map(([name, value]) => `${name}: ${JSON.stringify(value)}, `)
            .join("")}`,
          `    STRIPE_SECRET_KEY: sealed("${await seal(secret, key.recipient)}") },`,
          "  prod: {},",
        ]),
      }),
    });

    const got = await run(w, EXPORT);
    expect(got).toMatchObject({ code: 0, err: "" });
    const all = { APEX_DOMAIN: "anyrow.io", ...VALUES, STRIPE_SECRET_KEY: secret };
    const names = Object.keys(all).toSorted();
    expect([...got.out.matchAll(/^(\w+)=/gmu)].map((match) => match[1])).toStrictEqual(names);
    const hashes = Object.fromEntries(Object.entries(all).map(([name, value]) => [name, digest(value)]));
    expect(readBack(w.repo, got.out, names)).toStrictEqual(hashes);
  });
});

describe("env export refusals", () => {
  it.each([
    ["a $, which bun expands", "pa$word"],
    ["a trailing backslash", "C:\\dir\\"],
    ["every quote", 'it\'s "a" `b`'],
    ["a ' and a \" around a carriage return", 'it\'s\r"a"'],
  ])("refuses a value with %s, naming the key and printing nothing", SPAWN, async (_label, value) => {
    const w = await envRepo({
      files: {
        [ENV_REL]: envFile(["  local: {},", `  dev: { A: "1", TRICKY: ${JSON.stringify(value)} },`, "  prod: {},"]),
      },
    });

    const got = await run(w, EXPORT);
    expect(got).toMatchObject({ code: 1, out: "" });
    expect(got.err).toMatch(/^repo env: TRICKY [^\n]*\n$/u);
    expect(got.err).not.toContain(value);
  });
});

describe("env export usage", () => {
  it.each([
    ["a format other than dotenv", ["export", "--scope", "dev", "--format", "json"]],
    ["no format", ["export", "--scope", "dev"]],
    ["no scope", ["export", "--format", "dotenv"]],
  ])("prints usage for %s, exit 4", async (_label, argv) => {
    expect(await inShop(run, argv)).toMatchObject({ code: 4, err: USAGE, out: "" });
  });
});
