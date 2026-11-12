import { describe, expect, expectTypeOf, it } from "vitest";

import { fakeIo, sealedOf } from "./__fixtures__/fake-io.ts";
import { createEnv } from "./define.ts";

const config = {
  dev: { APEX_DOMAIN: "dev.example.com", SITE: "dev" },
  global: { ACCOUNT_ID: "a1" },
  local: { SITE: "local" },
  prod: { APEX_DOMAIN: "example.com", SITE: "prod" },
};

const REQUIRED_HOME = "repo env: process.HOME is required and unset";

describe("createEnv current", () => {
  it("reads the local scope when REPO_ENV is unset", () => {
    const env = createEnv(config, fakeIo({}).io);
    expect([env.current.SITE, env.current.ACCOUNT_ID]).toStrictEqual(["local", "a1"]);
  });

  it.each(["local", "dev", "prod"] as const)("reads the %s scope when REPO_ENV names it", (scope) => {
    expect(createEnv(config, fakeIo({ REPO_ENV: scope }).io).current.SITE).toBe(scope);
  });

  it("refuses a REPO_ENV that names no scope", () => {
    const env = createEnv(config, fakeIo({ REPO_ENV: "staging" }).io);
    expect(() => env.current.SITE).toThrow('repo env: REPO_ENV is "staging"; set it to local, dev or prod');
  });

  it("refuses a key the current scope lacks", () => {
    const env = createEnv(config, fakeIo({}).io);
    expect(() => env.current.APEX_DOMAIN).toThrow("repo env: APEX_DOMAIN has no local value in ");
  });

  it("reads a sealed value of the current scope", () => {
    const sealedProd = { dev: {}, global: {}, local: {}, prod: { KEY: sealedOf("k-prod") } };
    expect(createEnv(sealedProd, fakeIo({ REPO_ENV: "prod" }).io).current.KEY).toBe("k-prod");
  });

  it("types current with every scope's keys", () => {
    const env = createEnv(config, fakeIo({}).io);
    expectTypeOf(env.current).toHaveProperty("APEX_DOMAIN");
    expectTypeOf(env.current).toHaveProperty("SITE");
    expectTypeOf(env.current).toHaveProperty("ACCOUNT_ID");
  });
});

const withProcess = { dev: {}, local: {}, process: { CI: "optional", HOME: "required" }, prod: {} } as const;

describe("createEnv process", () => {
  it("reads declared variables from the source", () => {
    const env = createEnv(withProcess, fakeIo({ CI: "1", HOME: "/h" }).io);
    expect([env.process.HOME, env.process.CI]).toStrictEqual(["/h", "1"]);
  });

  it("leaves an unset optional variable undefined", () => {
    expect(createEnv(withProcess, fakeIo({ HOME: "/h" }).io).process.CI).toBeUndefined();
  });

  it("refuses an unset required variable", () => {
    const env = createEnv(withProcess, fakeIo({ CI: "1" }).io);
    expect(() => env.process.HOME).toThrow(REQUIRED_HOME);
  });

  it("reads the process view of another source", () => {
    const env = createEnv(withProcess, fakeIo({ HOME: "/real" }).io);
    expect(env.read({ HOME: "/h" }).HOME).toBe("/h");
    expect(env.read({ HOME: "/h" }).CI).toBeUndefined();
    expect(() => env.read({ CI: "1" }).HOME).toThrow(REQUIRED_HOME);
  });

  it("types a required variable as a string and an optional one as maybe undefined", () => {
    const env = createEnv(withProcess, fakeIo({ HOME: "/h" }).io);
    expectTypeOf(env.process.HOME).toEqualTypeOf<string>();
    expectTypeOf(env.process.CI).toEqualTypeOf<string | undefined>();
    expectTypeOf(env.process).not.toHaveProperty("PATH");
    expectTypeOf(() => env.read({}).HOME).returns.toEqualTypeOf<string>();
  });
});

describe("createEnv process keys", () => {
  it("lists an unset optional variable only when the source sets it", () => {
    const env = createEnv(withProcess, fakeIo({ HOME: "/h" }).io);
    expect(Object.keys(env.process)).toStrictEqual(["HOME"]);
    expect(Object.keys(env.read({ CI: "1", HOME: "/h" }))).toStrictEqual(["CI", "HOME"]);
    expect(env.read({ CI: "1", HOME: "/h" }).CI).toBe("1");
  });

  it("keeps a default under a spread of an unset optional variable", () => {
    const env = createEnv(withProcess, fakeIo({ HOME: "/h" }).io);
    expect({ CI: "default", ...env.read({ HOME: "/h" }) }).toStrictEqual({ CI: "default", HOME: "/h" });
  });

  it("lists an unset required variable, which throws when read", () => {
    const view = createEnv(withProcess, fakeIo({}).io).read({});
    expect(Object.keys(view)).toStrictEqual(["HOME"]);
    expect(() => view.HOME).toThrow(REQUIRED_HOME);
  });

  it("types an optional variable as an optional key", () => {
    const env = createEnv(withProcess, fakeIo({ HOME: "/h" }).io);
    expectTypeOf(env.process).toEqualTypeOf<{ readonly CI?: string | undefined; readonly HOME: string }>();
  });
});

/** What `run` returns, run as if inside a runtime with `caches` and the user agent `userAgent`. */
function asRuntime<T>(userAgent: string, run: () => T): T {
  const original: unknown = globalThis.navigator;
  Object.defineProperty(globalThis, "caches", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent } });

  try {
    return run();
  } finally {
    Reflect.deleteProperty(globalThis, "caches");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: original });
  }
}

/** An env whose local scope holds `A: "a"`, made under whatever runtime is current. */
function bareEnv() {
  return createEnv({ dev: {}, local: { A: "a" }, prod: {} }, fakeIo().io);
}

describe("createEnv script-only guard", () => {
  it("refuses to run inside a Cloudflare Worker", () => {
    expect(() => asRuntime("Cloudflare-Workers", bareEnv)).toThrow(
      "repo env: defineEnv is script-only; a Cloudflare Worker reads ctx.env",
    );
  });

  it("runs where caches exist under another user agent", () => {
    expect(asRuntime("Mozilla/5.0", bareEnv).local.A).toBe("a");
  });
});
