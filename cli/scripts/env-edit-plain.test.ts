/**
 * `bun repo env set --plain` through env-edit.ts's `main(argv, deps)`; argv is what follows `bun repo env`, verb
 * first. The deps shape is spelled out in `__fixtures__/env-repo.ts`. Real temp git repos with no key, whose env
 * files import `@workerstack/repo/env` through a link to this checkout.
 */
import { describe, expect, it } from "vitest";

import { ENV_REL, envRepo, envRunner, read, shopEnv, useEnvRepos } from "../__fixtures__/env-repo.ts";
import { main } from "./env-edit.ts";

const run = envRunner(main);
const unkeyed = { files: { [ENV_REL]: shopEnv([]) }, keyed: false };

useEnvRepos();

describe("env set --plain", () => {
  it("replaces a plain value, needing no key", async () => {
    const w = await envRepo(unkeyed);
    const got = await run(w, ["set", "APEX_DOMAIN", "--scope", "prod", "--plain"], { stdin: "acme.io\n" });
    expect(got).toMatchObject({ code: 0, err: "", out: `repo env: wrote prod.APEX_DOMAIN (plain) in ${ENV_REL}\n` });
    expect(read(w)).toBe(shopEnv([]).replace('APEX_DOMAIN: "acme.com"', 'APEX_DOMAIN: "acme.io"'));
  });

  it("writes the global block for --scope global, no sealed import added", async () => {
    const w = await envRepo(unkeyed);
    const got = await run(w, ["set", "APEX_DOMAIN", "--scope", "global", "--plain"], { stdin: "acme.io\n" });
    expect(got).toMatchObject({ code: 0, err: "", out: `repo env: wrote global.APEX_DOMAIN (plain) in ${ENV_REL}\n` });
    expect(read(w)).toBe(
      shopEnv([]).replace(
        '    CLOUDFLARE_ACCOUNT_ID: "fake-account",\n',
        '    CLOUDFLARE_ACCOUNT_ID: "fake-account",\n    APEX_DOMAIN: "acme.io",\n',
      ),
    );
  });

  it("writes a value with quotes, backslashes and newlines as a string literal that reads back", async () => {
    const w = await envRepo(unkeyed);
    const value = 'say "hi"\\there\nnext';
    const got = await run(w, ["set", "GREETING", "--scope", "prod", "--plain"], { stdin: `${value}\n` });
    expect(got.code).toBe(0);
    const literal = /GREETING: (".*"),\n/u.exec(read(w))?.[1];
    expect(JSON.parse(String(literal))).toBe(value);
  });
});
