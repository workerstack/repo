import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkWorkspace } from "./check-workspace.ts";
import { readWorkspace } from "./sync/workspace.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const ROOT = { private: true, workspaces: ["packages/*"], catalog: { zod: "^4.0.0", vitest: "^4.0.0" } };
const LOCK_OK = JSON.stringify({ packages: { zod: ["zod@4.1.12", "", {}, "x"] } });

/** Writes the manifests and the lock text into a temp repo, reads it as `repo check` does and returns the lines. */
function lines(files: Record<string, object>, lock?: string, extra: Record<string, string> = {}): string[] {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-check-workspace-"));
  temps.push(root);
  const all: Record<string, string> = { ...extra };
  for (const [rel, content] of Object.entries(files)) all[rel] = JSON.stringify(content);
  if (lock !== undefined) all["bun.lock"] = lock;
  for (const [rel, content] of Object.entries(all)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  const result = readWorkspace(root);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return checkWorkspace(root, result.workspace);
}

const MANIFEST = "package.json";
const pkg = (name: string, rest: object): Record<string, object> => ({
  [MANIFEST]: ROOT,
  [`packages/${name}/${MANIFEST}`]: { name, ...rest },
});

describe("checkWorkspace catalog rules", () => {
  it("gives a clean workspace no lines", () => {
    const files = pkg("b", {
      dependencies: { zod: "catalog:", a: "workspace:*" },
      devDependencies: { vitest: "catalog:" },
      peerDependencies: { react: "^19.0.0" },
    });
    expect(lines(files, LOCK_OK)).toEqual([]);
  });

  it("names a dependency written as a range", () => {
    const files = pkg("b", { dependencies: { zod: "3.24.1" }, devDependencies: { vitest: "^4" } });
    expect(lines(files, LOCK_OK)).toEqual([
      'packages/b/package.json: "zod" is "3.24.1", not from the catalog; add it to the root catalog and write "catalog:"',
      'packages/b/package.json: devDependency "vitest" is "^4", not from the catalog; add it to the root catalog and write "catalog:"',
    ]);
  });

  it("names an optionalDependency written as a range", () => {
    const files = pkg("b", { optionalDependencies: { fsevents: "2.0.0" } });
    expect(lines(files, LOCK_OK)).toEqual([
      'packages/b/package.json: optionalDependency "fsevents" is "2.0.0", not from the catalog; add it to the root catalog and write "catalog:"',
    ]);
  });
});

describe("checkWorkspace missing catalog entries", () => {
  it('names a "catalog:" the root catalog does not have', () => {
    const files = pkg("b", { dependencies: { lodash: "catalog:" } });
    expect(lines(files, LOCK_OK)).toEqual([
      'packages/b/package.json: "lodash" is "catalog:", but the root catalog has no "lodash"; add it there',
    ]);
  });

  it("names a named catalog that does not hold the dependency", () => {
    const files = pkg("b", { dependencies: { zod: "catalog:legacy", vitest: "catalog:nope" } });
    files[MANIFEST] = { ...ROOT, catalogs: { legacy: { other: "1.0.0" } } };
    expect(lines(files, LOCK_OK)).toEqual([
      'packages/b/package.json: "zod" is "catalog:legacy", but there is no catalog "legacy" with "zod"; add it to "catalogs"',
      'packages/b/package.json: "vitest" is "catalog:nope", but there is no catalog "nope" with "vitest"; add it to "catalogs"',
    ]);
  });

  it("resolves catalogs written top-level and under workspaces", () => {
    const files = pkg("b", { dependencies: { zod: "catalog:legacy", a: "catalog:next", v: "catalog:" } });
    files[MANIFEST] = {
      private: true,
      workspaces: { packages: ["packages/*"], catalog: { v: "1" }, catalogs: { next: { a: "1" } } },
      catalogs: { legacy: { zod: "^3" } },
    };
    expect(lines(files, LOCK_OK)).toEqual([]);
  });
});

describe("checkWorkspace root rules", () => {
  it("names each root dependency field and each stray devDependency", () => {
    const files = pkg("b", {});
    files[MANIFEST] = {
      ...ROOT,
      dependencies: { lodash: "catalog:" },
      peerDependencies: { react: "^19" },
      optionalDependencies: { fsevents: "2" },
      devDependencies: { vitest: "catalog:", "@workerstack/repo": "catalog:" },
    };
    expect(lines(files, LOCK_OK)).toEqual([
      'package.json: a workspace root has no "dependencies"; move "lodash" into the package that uses it',
      'package.json: a workspace root has no "peerDependencies"; move "react" into the package that uses it',
      'package.json: a workspace root has no "optionalDependencies"; move "fsevents" into the package that uses it',
      'package.json: the root\'s only devDependency is @workerstack/repo; move "vitest" into the package that uses it',
    ]);
  });

  it("asks for workspaces and skips the rest", () => {
    expect(lines({ [MANIFEST]: { private: true, dependencies: { a: "1" } } })).toEqual([
      'the workspace pack needs "workspaces" in package.json; add it, or drop "workspace" from packs',
    ]);
  });
});

describe("checkWorkspace lockfile", () => {
  const files = pkg("b", {});

  it("asks for a missing bun.lock", () => {
    expect(lines(files)).toEqual(["bun.lock is missing; run `bun install`"]);
  });

  it("asks for a text lockfile when only bun.lockb exists", () => {
    expect(lines(files, undefined, { "bun.lockb": "binary" })).toEqual([
      "bun.lockb is binary; run `bun install --save-text-lockfile` and delete bun.lockb",
    ]);
  });

  it("names a bun.lock that does not parse, with the parser message", () => {
    const [line] = lines(files, "{ nope");
    expect(line).toMatch(/^bun\.lock does not parse \(.+\); run `bun install` to rewrite it$/);
  });
});

describe("checkWorkspace lock reading", () => {
  const files = pkg("b", {});

  it("skips a lock entry that is not a package record", () => {
    expect(lines(files, JSON.stringify({ packages: { odd: "x", bare: ["nover"] } }))).toEqual([]);
  });

  it("passes a lock without a package table", () => {
    expect(lines(files, "{}")).toEqual([]);
    expect(lines(files, "null")).toEqual([]);
  });

  it("reads a JSONC lock with comments and trailing commas", () => {
    expect(lines(files, '{ // c\n "packages": { "zod": ["zod@4.1.12",], }, }')).toEqual([]);
  });
});

const SCOPED_LOCK = JSON.stringify({
  packages: {
    "@x/y": ["@x/y@1.0.0"],
    "@x/y/zod": ["zod@3.24.1"],
    "a/@x/y": ["@x/y@2.0.0"],
    "a/b/@x/y": ["@x/y@3.0.0"],
    zod: ["zod@4.1.12"],
  },
});

describe("checkWorkspace one version", () => {
  const files = pkg("b", { dependencies: { zod: "catalog:" }, peerDependencies: { "@x/y": "^1" } });

  it("names a stray version in the catalog with the override fix", () => {
    const lock = JSON.stringify({
      packages: {
        zod: ["zod@4.1.12"],
        "b/zod": ["zod@3.24.1"],
        "same/zod": ["zod@4.1.12"],
        b: ["b@workspace:packages/b"],
      },
    });
    expect(lines(files, lock)).toEqual([
      'zod resolves to 3.24.1 and 4.1.12; b pulls 3.24.1; add "overrides": { "zod": "catalog:" } to the root package.json',
    ]);
  });

  it("names a stray scoped puller and a name outside the catalog, splitting scoped names at the last @", () => {
    const root = { ...ROOT, catalog: { vitest: "^4" } };
    const b = pkg("b", { dependencies: { zod: "workspace:*" }, peerDependencies: { "@x/y": "^1" } });
    expect(lines({ ...b, [MANIFEST]: root }, SCOPED_LOCK)).toEqual([
      '@x/y resolves to 1.0.0, 2.0.0 and 3.0.0; a pulls 2.0.0, a/b pulls 3.0.0; add @x/y to the root catalog, then "overrides": { "@x/y": "catalog:" }',
      'zod resolves to 3.24.1 and 4.1.12; @x/y pulls 3.24.1; add zod to the root catalog, then "overrides": { "zod": "catalog:" }',
    ]);
  });
});

describe("checkWorkspace transitive duplicates", () => {
  const files = pkg("b", { dependencies: { zod: "catalog:" } });

  it("ignores a duplicate no manifest declares", () => {
    const lock = JSON.stringify({
      packages: {
        "oxc-parser": ["oxc-parser@0.157.0"],
        "knip/oxc-parser": ["oxc-parser@0.155.0"],
        zod: ["zod@4.1.12"],
      },
    });
    expect(lines(files, lock)).toEqual([]);
  });
});
