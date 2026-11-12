import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { useTempTree } from "./__fixtures__/temp-tree.ts";
import { defineEnv, sealed } from "./env.ts";
import { newIdentity, seal } from "./env/age.ts";

const plant = useTempTree("env-sealed-");

const KEY_FILE = ".workerstack/keys/test.key";
// The real child spawns bun and decrypts with age.
const SPAWN = { timeout: 30_000 };
const NO_KEY = "repo env: WEBHOOK_KEY is sealed and no key is at ~/.workerstack/keys/";
const OTHER_KEY = "repo env: NPM_TOKEN is sealed for another key than ~/.workerstack/keys/";

/** A temp HOME holding `identity` as its one key file, set as HOME with no WORKERSTACK_ENV_KEY or REPO_ENV. */
function homeWith(identity: string): string {
  const home = plant({ [KEY_FILE]: `${identity}\n` });
  vi.stubEnv("HOME", home);
  vi.stubEnv("WORKERSTACK_ENV_KEY", undefined);
  vi.stubEnv("REPO_ENV", undefined);
  return home;
}

describe("defineEnv with sealed values", () => {
  it("decrypts two sealed values in a real child, once per env instance", SPAWN, async () => {
    const { identity, recipient } = await newIdentity();
    const config = {
      dev: {},
      global: { API_TOKEN: sealed(await seal("token-one", recipient)) },
      local: { WEBHOOK_KEY: sealed(await seal("webhook-two", recipient)) },
      prod: {},
    };
    const home = homeWith(identity);
    const env = defineEnv(config);
    expect(env.current.API_TOKEN).toBe("token-one");
    fs.rmSync(path.join(home, KEY_FILE));
    expect(env.local.WEBHOOK_KEY).toBe("webhook-two");
    expect(() => defineEnv(config).local.WEBHOOK_KEY).toThrow(NO_KEY);
  });

  it("names a key sealed for another key than the one at home", SPAWN, async () => {
    const owner = await newIdentity();
    const stranger = await newIdentity();
    homeWith(stranger.identity);
    const env = defineEnv({ dev: {}, local: {}, prod: { NPM_TOKEN: sealed(await seal("npm", owner.recipient)) } });
    expect(() => env.prod.NPM_TOKEN).toThrow(OTHER_KEY);
  });
});

describe("defineEnv decrypt failures", () => {
  it("names a sealed value the child could not decrypt, with its reason", SPAWN, async () => {
    const { identity } = await newIdentity();
    homeWith(identity);
    const env = defineEnv({ dev: {}, local: { BROKEN: sealed("AAAA") }, prod: {} });
    expect(() => env.local.BROKEN).toThrow("repo env: BROKEN could not be decrypted: ");
  });
});

describe("defineEnv with plain values and sealed refusals", () => {
  it("names the file that defined the env when the current scope lacks a key", () => {
    homeWith("");
    const env = defineEnv({ dev: {}, local: {}, prod: { APEX_DOMAIN: "example.com" } });
    const file = path.join("cli", "env-sealed.test.ts");
    expect(() => env.current.APEX_DOMAIN).toThrow(
      `repo env: APEX_DOMAIN has no local value in ${file}; add it to its local block`,
    );
  });

  it("reads a plain value with no key at all", () => {
    homeWith("");
    const env = defineEnv({ dev: {}, global: { SITE: "example.com" }, local: {}, prod: {} });
    expect(env.current.SITE).toBe("example.com");
  });

  it.each([
    ["an empty cipher", ""],
    ["a cipher that is not base64", "not base64!"],
  ])("refuses %s at definition", (_label, cipher) => {
    expect(() => sealed(cipher)).toThrow(/^repo env: /u);
  });
});
