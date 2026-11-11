import { afterEach, expect, it, vi } from "vitest";

import { NO_LATEST, NOT_FOUND, TIMEOUT, cleanup, world } from "./fixtures/update-world.ts";
import { main } from "./update.ts";

afterEach(cleanup);

function manifest(extra: Record<string, unknown>) {
  return { "package.json": { name: "r", ...extra } };
}

it("finds default and named catalog entries, top-level and under workspaces, and keeps ^, ~ and exact", async () => {
  const files = manifest({
    catalog: { a: "~1.0.0" },
    catalogs: { next: { b: "^1.0.0" } },
    workspaces: { catalogs: { old: { c: "1.0.0" } } },
  });
  const w = world(files, { a: "1.2.0", b: "2.0.0", c: "1.0.1" });
  expect(await main(["--check"], w.io())).toBe(0);
  expect(w.out.slice(0, 4)).toStrictEqual([
    "3 behind of 3 checked:",
    "  a  catalog              ~1.0.0 → ~1.2.0",
    "  c  catalog:old          1.0.0 → 1.0.1",
    "  b  catalog:next         ^1.0.0 → ^2.0.0  major",
  ]);
  await main([], w.io());
  expect(w.out.at(-1)).toBe(
    "updated 3: a ~1.0.0 → ~1.2.0 in the catalog, c 1.0.0 → 1.0.1 in the old catalog, " +
      "b ^1.0.0 → ^2.0.0 in the next catalog",
  );
  const root = w.read("package.json");
  expect([root.catalog, root.catalogs, root.workspaces]).toStrictEqual([
    { a: "~1.2.0" },
    { next: { b: "^2.0.0" } },
    { catalogs: { old: { c: "1.0.1" } } },
  ]);
});

it("keeps catalog users, tags, protocols and peers silent, and never asks about them", async () => {
  const files = manifest({
    dependencies: {
      f: "file:../f",
      g: "github:a/b",
      l: "latest",
      n: "npm:x@1",
      t: "next",
      u: "catalog:",
      w: "workspace:*",
    },
    peerDependencies: { p: "^1.0.0" },
  });
  const w = world(files, {});
  expect(await main(["--check"], w.io())).toBe(0);
  expect(w.out).toStrictEqual(["every dependency is on latest (0 checked)"]);
  expect(w.asked).toStrictEqual([]);
});

it("skips a 404 and a document with no latest, and lists both", async () => {
  const w = world(manifest({ dependencies: { bare: "^1.0.0", gone: "^1.0.0", ok: "1.0.0" } }), {
    bare: NO_LATEST,
    gone: NOT_FOUND,
    ok: "1.0.0",
  });
  expect(await main(["--check"], w.io())).toBe(0);
  expect(w.out).toStrictEqual([
    "every dependency is on latest (1 checked)",
    "skipped 2: bare has no latest on the registry; gone is not on the registry",
  ]);
});

it("bumps a name in one package and lists it skipped as a range in another", async () => {
  const w = world(
    {
      "package.json": { name: "r", workspaces: ["packages/*"] },
      "packages/a/package.json": { dependencies: { x: "^1.0.0" }, name: "a" },
      "packages/b/package.json": { dependencies: { x: ">=1 <2" }, name: "b" },
    },
    { x: "1.5.0" },
  );
  expect(await main(["--check"], w.io())).toBe(0);
  expect(w.out[0]).toBe("1 behind of 1 checked:");
  expect(w.out[2]).toBe('skipped 1: x in packages/b is ">=1 <2", not a plain version');
  await main([], w.io());
  expect(w.read("packages/a/package.json").dependencies).toStrictEqual({ x: "^1.5.0" });
  expect(w.read("packages/b/package.json").dependencies).toStrictEqual({ x: ">=1 <2" });
});

it("never downgrades a prerelease above latest", async () => {
  const w = world(manifest({ dependencies: { x: "^6.0.0-beta.1" } }), { x: "5.1.0" });
  expect(await main([], w.io())).toBe(0);
  expect(w.out).toStrictEqual(["every dependency is on latest (1 checked)"]);
  expect(w.read("package.json").dependencies).toStrictEqual({ x: "^6.0.0-beta.1" });
});

it("asks the registry for 8 names at a time", async () => {
  const names = Array.from({ length: 20 }, (_, i) => `p${i}`);
  const w = world(manifest({ dependencies: Object.fromEntries(names.map((n) => [n, "1.0.0"])) }), {});
  await main(["--check"], w.io());
  expect(w.asked.length).toBe(20);
  expect(w.peak).toBe(8);
});

it("asks for a scoped name encoded, on the registry the env names", async () => {
  const w = world(manifest({ dependencies: { "@s/p": "1.0.0" } }), {});
  const urls: string[] = [];
  function fetch(url: string) {
    urls.push(url);
    return Promise.resolve(Response.json({ "dist-tags": { latest: "1.0.0" }, versions: {} }));
  }
  const env = { NPM_CONFIG_REGISTRY: "https://mirror.example" };
  expect(await main(["--check"], w.io({ env, fetch }))).toBe(0);
  expect(urls).toStrictEqual(["https://mirror.example/@s%2fp"]);
});

it("reports the first of several names the registry fails on", async () => {
  const w = world(manifest({ dependencies: { a: "1.0.0", b: "1.0.0" } }), { a: TIMEOUT, b: TIMEOUT });
  expect(await main(["--check"], w.io())).toBe(1);
  expect(w.err).toStrictEqual(["repo update: registry.npmjs.org did not answer for a (timeout); nothing was written"]);
});

it("a named dependency that is only a range prints nothing and writes nothing", async () => {
  const w = world(manifest({ dependencies: { x: ">=1" } }), {});
  expect(await main(["x"], w.io())).toBe(0);
  expect(w.out).toStrictEqual([]);
  expect(w.installs).toStrictEqual([]);
});

it("reports an unreadable manifest and exits 1", async () => {
  const w = world({ "package.json": { name: 1 } }, {});
  expect(await main([], w.io())).toBe(1);
  expect(w.err[0]).toMatch(/^repo update: /);
});

it("runs on the process streams when no io is given", async () => {
  const written: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((text) => {
    written.push(String(text));
    return true;
  });
  try {
    expect(await main(["--nope"])).toBe(2);
  } finally {
    spy.mockRestore();
  }
  expect(written).toStrictEqual(["repo update: usage: repo update [--check] [<name>|@scope/*…]\n"]);
});

function scoped() {
  return world(
    {
      "package.json": {
        name: "r",
        workspaces: { catalog: { "@workerstack/repo": "^0.1.0", zod: "^3.0.0" }, packages: ["packages/*"] },
      },
      "packages/a/package.json": {
        dependencies: { "@other/x": "1.0.0", "@workerstack/references": "^0.1.1", "@workerstack/repo": "catalog:" },
        name: "a",
      },
    },
    { "@other/x": "2.0.0", "@workerstack/references": "0.1.2", "@workerstack/repo": "0.2.0", zod: "4.0.0" },
  );
}

it("bumps only the named scope across the catalog and the manifests", async () => {
  const w = scoped();
  expect(await main(["@workerstack/*"], w.io())).toBe(0);
  expect(w.out[0]).toMatch(/^updated 2: /);
  expect(w.read("package.json").workspaces).toStrictEqual({
    catalog: { "@workerstack/repo": "^0.2.0", zod: "^3.0.0" },
    packages: ["packages/*"],
  });
  expect(w.read("packages/a/package.json").dependencies).toStrictEqual({
    "@other/x": "1.0.0",
    "@workerstack/references": "^0.1.2",
    "@workerstack/repo": "catalog:",
  });
});

it("--check with a scope lists only its rows", async () => {
  const w = scoped();
  expect(await main(["--check", "@workerstack/*"], w.io())).toBe(0);
  expect(w.out[0]).toBe("2 behind of 2 checked:");
  expect(w.out.join("\n")).not.toMatch(/zod|@other/);
  expect(w.asked.toSorted()).toStrictEqual(["@workerstack/references", "@workerstack/repo"]);
});

it("a scope nothing depends on exits 1 naming it", async () => {
  const w = scoped();
  expect(await main(["@nope/*"], w.io())).toBe(1);
  expect(w.err).toStrictEqual(['repo update: nothing here depends on "@nope/*"']);
  expect(w.installs).toStrictEqual([]);
});

it("prints each current scoped name once, though several sources hold it", async () => {
  const w = world(
    {
      "package.json": { dependencies: { "@s/a": "^1.0.0", "@s/b": "^2.0.0" }, name: "r", workspaces: ["packages/*"] },
      "packages/a/package.json": { dependencies: { "@s/a": "^1.0.0" }, name: "a" },
    },
    { "@s/a": "1.0.0", "@s/b": "2.0.0" },
  );
  expect(await main(["@s/*"], w.io())).toBe(0);
  expect(w.out).toStrictEqual(["@s/a is on latest (^1.0.0)", "@s/b is on latest (^2.0.0)"]);
});

it("a star anywhere but a trailing /* after a scope matches exactly", async () => {
  const w = scoped();
  expect(await main(["@workerstack/re*"], w.io())).toBe(1);
  expect(w.err).toStrictEqual(['repo update: nothing here depends on "@workerstack/re*"']);
  expect(await main(["*"], w.io())).toBe(1);
  expect(await main(["@workerstack*/*"], w.io())).toBe(1);
});
