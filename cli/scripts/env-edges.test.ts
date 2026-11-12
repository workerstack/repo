/**
 * The edges of `bun repo env` through env-command.ts's `main(argv, deps)`: the block layouts set edits, the files it
 * refuses to edit, the env files get reads, and the argv no verb takes. The deps shape is spelled out in
 * `__fixtures__/env-repo.ts`; real temp git repos link `@workerstack/repo` to this checkout, every value a fake.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  envOf as envFile,
  envRepo,
  envRunner,
  IMPORT,
  read as readAt,
  SPAWN,
  useEnvRepos,
  type EnvGot,
  type EnvWorld,
  type RunOptions,
} from "../__fixtures__/env-repo.ts";
import { main } from "./env-command.ts";
import { main as editMain } from "./env-edit.ts";
import { main as valuesMain } from "./env-values.ts";

const ENV_REL = "env.ts";
const runCommand = envRunner(main);

useEnvRepos();

/** A repo `acme` with its key pair, holding `files` at its root. */
function world(files: Record<string, string>): Promise<EnvWorld> {
  return envRepo({ files });
}

/** Runs `argv` in `w.repo` with `fake-value` piped and `env` as the process variables. */
function env(w: EnvWorld, argv: string[], extra: Pick<RunOptions, "env"> = {}): Promise<EnvGot> {
  return runCommand(w, argv, { ...extra, stdin: "fake-value\n" });
}

function read(w: EnvWorld): string {
  return readAt(w, ENV_REL);
}

const PLAIN = ["set", "NEW", "--scope", "prod", "--plain"];
const SEALED = ["set", "NEW", "--scope", "prod"];

describe("env set, block layouts", () => {
  it.each([
    ["an empty multiline block", "{\n  }", '{\n    NEW: "fake-value",\n  }'],
    ["a last value without a comma", '{\n    A: "1"\n  }', '{\n    A: "1",\n    NEW: "fake-value",\n  }'],
    ["a close brace on the last value's line", '{\n    A: "1" }', '{\n    A: "1",\n    NEW: "fake-value", }'],
  ])("adds to %s in its layout", SPAWN, async (_label, block, after) => {
    const w = await world({ [ENV_REL]: envFile(`{ prod: ${block} }`) });
    expect(await env(w, PLAIN)).toMatchObject({ code: 0, err: "" });
    expect(read(w)).toBe(envFile(`{ prod: ${after} }`));
  });
});

describe("env set, which config and which import", () => {
  it("writes to the child env, not the parent it names", SPAWN, async () => {
    const head = `${IMPORT}const base = defineEnv({ prod: {} });\n`;
    const w = await world({ [ENV_REL]: envFile("{ parent: base, prod: {} }", head) });
    expect(await env(w, PLAIN)).toMatchObject({ code: 0, err: "" });
    expect(read(w)).toBe(envFile('{ parent: base, prod: { NEW: "fake-value" } }', head));
  });

  it("adds sealed beside defineEnv past imports that bind no names", SPAWN, async () => {
    const w = await world({
      [ENV_REL]: envFile("{ prod: {} }", `import "node:path";\nimport * as fs from "node:fs";\n${IMPORT}`),
    });

    expect(await env(w, SEALED)).toMatchObject({ code: 0, err: "" });
    expect(read(w)).toContain('import { defineEnv, sealed } from "@workerstack/repo/env";');
  });
});

type Refusal = { label: string; text: string; argv: string[]; line: string };

describe("env set, refusals", () => {
  it.each<Refusal>([
    {
      argv: SEALED,
      label: "a file importing no defineEnv",
      line: `${ENV_REL} imports no defineEnv to add sealed beside; import sealed from @workerstack/repo/env`,
      text: envFile("{ prod: {} }", "function defineEnv(config: object): object {\n  return config;\n}\n"),
    },
    {
      argv: PLAIN,
      label: "a missing scope block",
      line: `${ENV_REL} has no prod block to write to; add \`prod: {}\``,
      text: envFile("{ dev: {} }"),
    },
    {
      argv: PLAIN,
      label: "a file that would not parse",
      line: `${ENV_REL} would not parse after the edit; nothing was written`,
      text: `${envFile("{ prod: {} }")}const broken = ;\n`,
    },
  ])("refuses $label and leaves it untouched", SPAWN, async ({ argv, line, text }) => {
    const w = await world({ [ENV_REL]: text });
    expect(await env(w, argv)).toMatchObject({ code: 1, err: `repo env: ${line}\n`, out: "" });
    expect(read(w)).toBe(text);
  });
});

describe("env ls and get, edges", () => {
  it("lists quoted keys, skips computed ones and shows an unused key's users as -", SPAWN, async () => {
    const w = await world({ [ENV_REL]: envFile('{ prod: { "QUOTED": "1", ["X"]: "2" } }') });
    const got = await env(w, ["ls"]);
    expect(got).toMatchObject({ code: 0, err: "" });
    expect(got.out).toBe(`KEY     SCOPE  KIND   FILE    USED BY\nQUOTED  prod   plain  ${ENV_REL}  -\n`);
  });

  it.each<Refusal>([
    {
      argv: ["get", "A", "--scope", "dev"],
      label: "a key the scope does not hold",
      line: `A has no dev value in ${ENV_REL}`,
      text: envFile('{ prod: { A: "1" } }'),
    },
    {
      argv: ["get", "A", "--scope", "prod", "--file", ENV_REL],
      label: "a file that exports no env",
      line: `${ENV_REL} exports no defineEnv env`,
      text: "export const other = 1;\n",
    },
  ])("refuses $label", SPAWN, async ({ argv, line, text }) => {
    const w = await world({ [ENV_REL]: text });
    expect(await env(w, argv)).toMatchObject({ code: 1, err: `repo env: ${line}\n` });
  });
});

describe("env get, a broken cipher", () => {
  it("names a cipher that is not age's, not the key", SPAWN, async () => {
    const w = await world({
      [ENV_REL]: envFile('{ prod: { A: sealed("AAAA") } }', IMPORT.replace("defineEnv", "defineEnv, sealed")),
    });

    const got = await env(w, ["get", "A", "--scope", "prod"]);
    expect(got.code).toBe(1);
    expect(got.err).toMatch(/^repo env: /u);
    expect(got.err).not.toContain("another key");
  });
});

describe("env run and export, edges", () => {
  it("refuses export in a repo with no env file", SPAWN, async () => {
    const w = await world({});
    const line = "repo env: no defineEnv file in this repo; pass --file <env file>\n";
    expect(await env(w, ["export", "--scope", "prod", "--format", "dotenv"])).toMatchObject({ code: 1, err: line });
  });

  it("runs over the set process variables, the scope's values winning", SPAWN, async () => {
    const w = await world({ [ENV_REL]: envFile('{ prod: { A: "1" } }') });
    const got = await env(w, ["run", "--scope", "prod", "--", "true"], { env: { A: "0", B: "2", C: undefined } });
    expect(got).toMatchObject({ code: 0, err: "" });
    expect(got.spawned.map((child) => child.env)).toStrictEqual([{ A: "1", B: "2" }]);
  });
});

describe("env init, a keys file whose key is missing", () => {
  it("refuses, naming key import", SPAWN, async () => {
    const w = await world({});
    fs.rmSync(path.join(w.home, ".workerstack/keys/acme.key"));
    const got = await env(w, ["init"]);
    expect(got.code).toBe(1);
    expect(got.err).toBe(
      "repo env: .repo/env.keys.json names a key and none is at ~/.workerstack/keys/acme.key; " +
        "run `bun repo env key import`\n",
    );
  });
});

describe("env argv no verb takes", () => {
  it.each([[[]], [["nope"]], [["ls", "extra"]]])("prints usage for %j, exit 4", async (argv) => {
    let err = "";
    const deps = { stderr: (s: string) => (err += s) };
    expect(await main(argv, deps)).toBe(4);
    expect(await valuesMain(argv, deps)).toBe(4);
    expect(await editMain(["get", "A", "--scope", "prod"], deps)).toBe(4);
    expect(err).toMatch(/^usage: bun repo env /u);
  });
});
