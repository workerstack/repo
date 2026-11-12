import { describe, expect, expectTypeOf, it } from "vitest";

import { fakeIo, sealedOf } from "./__fixtures__/fake-io.ts";
import { createEnv, sealedValue } from "./define.ts";
import type { EnvIo } from "./define.ts";

const grandparent = createEnv(
  { dev: { G_DEV: "g-dev" }, global: { G: "g", SHARED_GLOBAL: "grandparent" }, local: {}, prod: {} },
  fakeIo().io,
);

const parent = createEnv(
  {
    dev: { ENV_VS_GLOBAL: "parent-dev", P_DEV: "p-dev", SITE: "parent-dev" },
    global: { P: "p", SHARED_GLOBAL: "parent" },
    local: { SITE: "parent-local" },
    parent: grandparent,
    prod: {},
  },
  fakeIo().io,
);

const child = createEnv(
  {
    dev: { SITE: "child-dev" },
    global: { ENV_VS_GLOBAL: "child-global", SHARED_GLOBAL: "child" },
    local: {},
    parent,
    prod: { SITE: "child-prod" },
  } as const,
  fakeIo().io,
);

describe("createEnv merging", () => {
  it("merges global into every scope and carries every ancestor's keys", () => {
    expect(child.dev).toMatchObject({ G: "g", G_DEV: "g-dev", P: "p", P_DEV: "p-dev" });
    expect(child.prod).toMatchObject({ G: "g", P: "p" });
  });

  it("lets a child scope value win over its parent's", () => {
    expect(child.dev.SITE).toBe("child-dev");
    expect(child.local.SITE).toBe("parent-local");
    expect(child.prod.SITE).toBe("child-prod");
  });

  // A scope view merges the parent's scope view after the child's global, and that view ends with its own
  // parent's view: the farthest ancestor's global wins a global collision in a scope.
  it("lets a child global win in .global, but an ancestor's scope view win in a scope", () => {
    expect(child.global.SHARED_GLOBAL).toBe("child");
    expect(child.dev.SHARED_GLOBAL).toBe("grandparent");
    expect(child.dev.ENV_VS_GLOBAL).toBe("parent-dev");
    expect(child.local.ENV_VS_GLOBAL).toBe("child-global");
  });

  it("types each scope with every ancestor's keys", () => {
    expectTypeOf(child.dev).toHaveProperty("G_DEV");
    expectTypeOf(child.dev).toHaveProperty("P_DEV");
    expectTypeOf(child.dev.SITE).toEqualTypeOf<"child-dev">();
    expectTypeOf(child.global).not.toHaveProperty("P_DEV");
  });
});

const sealedParent = createEnv(
  { dev: {}, global: { ACCOUNT_ID: "a1", ACCOUNT_TOKEN: sealedOf("acct") }, local: {}, prod: {} },
  fakeIo().io,
);

/** A child of `sealedParent`: dev and prod seal JWT_SECRET, local and prod set a key plainly. */
function sealedChild(io: EnvIo) {
  return createEnv(
    {
      dev: { JWT_SECRET: sealedOf("jwt-dev"), SITE: "dev.example.com" },
      local: { JWT_SECRET: "jwt-local", SITE: "localhost" },
      parent: sealedParent,
      prod: { ACCOUNT_TOKEN: "acct-plain", JWT_SECRET: sealedOf("jwt-prod"), SITE: "example.com" },
    },
    io,
  );
}

/** An `EnvIo` with no key: every reveal throws. */
const NO_KEY: EnvIo = {
  reveal: () => {
    throw new Error("repo env: no key");
  },
  source: () => ({}),
};

describe("createEnv sealed reads", () => {
  it("reads every sealed value back as its revealed string", () => {
    const env = sealedChild(fakeIo().io);
    const jwt: string = env.dev.JWT_SECRET;
    expect(jwt).toBe("jwt-dev");
    expect(env.prod.JWT_SECRET).toBe("jwt-prod");
    expect(env.dev.ACCOUNT_TOKEN).toBe("acct");
  });

  it("reveals every sealed value of the tree in one call, on the first sealed read", () => {
    const { calls, io } = fakeIo();
    const env = sealedChild(io);
    expect(calls).toStrictEqual([]);
    expect([env.dev.JWT_SECRET, env.prod.JWT_SECRET, env.local.ACCOUNT_TOKEN]).toStrictEqual([
      "jwt-dev",
      "jwt-prod",
      "acct",
    ]);
    expect(calls).toHaveLength(1);
    expect(new Set(calls[0])).toStrictEqual(new Set(["acct", "jwt-dev", "jwt-prod"].map((text) => btoa(text))));
  });
});

describe("createEnv reveal per instance", () => {
  it("reveals again for another env instance", () => {
    const { calls, io } = fakeIo();
    expect(sealedChild(io).dev.JWT_SECRET).toBe("jwt-dev");
    expect(sealedChild(io).dev.JWT_SECRET).toBe("jwt-dev");
    expect(calls).toHaveLength(2);
  });

  it("reads plain values with no reveal, so a plain read needs no key", () => {
    const env = sealedChild(NO_KEY);
    expect([env.local.JWT_SECRET, env.prod.ACCOUNT_ID, env.prod.ACCOUNT_TOKEN]).toStrictEqual([
      "jwt-local",
      "a1",
      "acct-plain",
    ]);
    expect(() => env.dev.JWT_SECRET).toThrow("repo env: no key");
  });
});

describe("createEnv sealed keys", () => {
  it("names the sealed keys per scope, a parent's included, and a scope that sets a key plainly is not one", () => {
    const env = sealedChild(fakeIo().io);
    const dev = [...env.sealedKeys("dev")].toSorted((a, b) => a.localeCompare(b));
    expect(dev).toStrictEqual(["ACCOUNT_TOKEN", "JWT_SECRET"]);
    expect([...env.sealedKeys("local")]).toStrictEqual(["ACCOUNT_TOKEN"]);
    expect([...env.sealedKeys("prod")]).toStrictEqual(["JWT_SECRET"]);
  });

  it("types a sealed value as a string", () => {
    const env = sealedChild(fakeIo().io);
    expectTypeOf(env.dev.JWT_SECRET).toEqualTypeOf<string>();
    expectTypeOf(env.global.ACCOUNT_TOKEN).toEqualTypeOf<string>();
  });

  it("types the sealed keys as the tagged names", () => {
    const env = createEnv({ dev: {}, global: { NPM_TOKEN: sealedOf("npm") }, local: {}, prod: {} }, fakeIo().io);
    expectTypeOf(env.sealedKeys("prod")).toEqualTypeOf<ReadonlySet<"NPM_TOKEN">>();
  });
});

describe("sealedValue", () => {
  it("refuses an empty cipher", () => {
    expect(() => sealedValue("")).toThrow(/^repo env: /u);
  });

  it("refuses a cipher that is not base64", () => {
    expect(() => sealedValue("not base64!")).toThrow(/^repo env: /u);
  });
});
