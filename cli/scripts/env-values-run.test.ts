/**
 * `bun repo env run` through env-values.ts's `main(argv, deps)`; argv is what follows `bun repo env`,
 * verb first. The deps shape is spelled out in `__fixtures__/env-repo.ts`; the fake spawn records each child. Real
 * temp git repos link `@workerstack/repo` to this checkout; every value is a fake made in the test.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { envRepo, envRunner, fakeSecret, shop, SPAWN, USAGE, useEnvRepos } from "../__fixtures__/env-repo.ts";
import { childEnv } from "../env.ts";
import { main } from "./env-values.ts";

const run = envRunner(main);

useEnvRepos();

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** This process's env as names and value hashes, so a change shows and no value is printed. */
function envDigest(): Record<string, string> {
  const pairs = Object.entries(childEnv()).map(([name, value]): [string, string] => [name, digest(value)]);

  return Object.fromEntries(pairs);
}

describe("env run", () => {
  it("hands the scope's values to the child's env only and passes its exit code through", SPAWN, async () => {
    const secret = fakeSecret();
    const w = await envRepo(shop(secret));
    const argv = ["run", "--scope", "prod", "--", "wrangler", "deploy", "--env", "prod"];
    const got = await run(w, argv, { childCode: 7 });
    expect(got.code).toBe(7);
    expect(got.spawned).toHaveLength(1);
    const [child] = got.spawned;
    expect(child?.command).toStrictEqual(["wrangler", "deploy", "--env", "prod"]);
    expect(child?.env).toMatchObject({ APEX_DOMAIN: "acme.io", STRIPE_SECRET_KEY: secret });
    expect(`${got.out}${got.err}`).not.toContain(secret);
  });
});

describe("env run, the env around the child", () => {
  it("leaves this process's own env as it was", SPAWN, async () => {
    const w = await envRepo(shop(fakeSecret()));
    const before = envDigest();
    const got = await run(w, ["run", "--scope", "prod", "--", "true"]);
    expect(got.code).toBe(0);
    expect(envDigest()).toStrictEqual(before);
  });

  it("keeps WORKERSTACK_ENV_KEY from the child, passing the rest of the env on", SPAWN, async () => {
    const w = await envRepo(shop(fakeSecret()));
    const env = { PATH: "/usr/bin", WORKERSTACK_ENV_KEY: String(w.key?.identity) };
    const got = await run(w, ["run", "--scope", "prod", "--", "true"], { env });
    expect(got.spawned[0]?.env).toMatchObject({ PATH: "/usr/bin" });
    expect(got.spawned[0]?.env).not.toHaveProperty("WORKERSTACK_ENV_KEY");
  });

  it("prints usage when no command follows --, exit 4", async () => {
    const w = await envRepo(shop(fakeSecret()));
    const got = await run(w, ["run", "--scope", "prod", "--"]);
    expect(got).toMatchObject({ code: 4, err: USAGE, out: "", spawned: [] });
  });
});
