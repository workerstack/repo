/**
 * `bun repo env set` keeping the env file's own shape, through env-edit.ts's `main(argv, deps)`: a config held in a
 * const, and the comments, quotes and indent around the edit. The deps shape is spelled out in
 * `__fixtures__/env-repo.ts`; real temp git repos link `@workerstack/repo` to this checkout, every value a fake.
 */
import { describe, expect, it } from "vitest";

import {
  cipherOf,
  ENV_REL,
  envRepo,
  envRunner,
  fakeSecret,
  IMPORT,
  IMPORT_SEALED,
  opened,
  read,
  SPAWN,
  useEnvRepos,
  withoutCipher,
} from "../__fixtures__/env-repo.ts";
import { main } from "./env-edit.ts";

const run = envRunner(main);
const SET_STRIPE = ["set", "STRIPE_SECRET_KEY", "--scope", "prod"];

/** An env file whose config is a same-file const. */
const CONST_CONFIG = [
  IMPORT,
  "const config = {",
  "  local: {},",
  "  dev: {},",
  "  prod: {",
  '    APEX_DOMAIN: "acme.com",',
  "  },",
  "} as const;",
  "",
  "export const shopEnv = defineEnv(config);",
  "",
].join("\n");

/** An env file with a comment head, single quotes, no semicolons, a four-space indent and code after the call. */
const OWN_STYLE = [
  "// Values for the shop; keep sorted.",
  "import { defineEnv } from '@workerstack/repo/env'",
  "",
  "export const shopEnv = defineEnv({",
  "    global: { CLOUDFLARE_ACCOUNT_ID: 'fake-account' },",
  "    local: {},",
  "    dev: {},",
  "    prod: {",
  "        // the public site",
  "        APEX_DOMAIN: 'acme.com',",
  "    },",
  "})",
  "",
  "export function site(): string {",
  "    return shopEnv.current.APEX_DOMAIN",
  "}",
  "",
].join("\n");

useEnvRepos();

describe("env set, the file's own shape", () => {
  it("edits a config held in a same-file const", SPAWN, async () => {
    const w = await envRepo({ files: { [ENV_REL]: CONST_CONFIG } });
    const value = fakeSecret();
    const got = await run(w, SET_STRIPE, { stdin: value });
    expect(got.code).toBe(0);
    const text = read(w);

    const want = CONST_CONFIG.replace(IMPORT, IMPORT_SEALED).replace(
      '    APEX_DOMAIN: "acme.com",\n',
      '    APEX_DOMAIN: "acme.com",\n    STRIPE_SECRET_KEY: sealed("CIPHER"),\n',
    );

    expect(withoutCipher(text, "STRIPE_SECRET_KEY")).toBe(want);
    expect(await opened(w, cipherOf(text, "STRIPE_SECRET_KEY"))).toBe(value);
  });

  it("keeps comments, quotes, layout and code around the edit, indenting as the block does", SPAWN, async () => {
    const w = await envRepo({ files: { [ENV_REL]: OWN_STYLE } });
    const got = await run(w, SET_STRIPE, { stdin: fakeSecret() });
    expect(got.code).toBe(0);

    const want = OWN_STYLE.replace("import { defineEnv } from", "import { defineEnv, sealed } from").replace(
      "        APEX_DOMAIN: 'acme.com',\n",
      "        APEX_DOMAIN: 'acme.com',\n        STRIPE_SECRET_KEY: sealed(\"CIPHER\"),\n",
    );

    expect(withoutCipher(read(w), "STRIPE_SECRET_KEY")).toBe(want);
  });
});
