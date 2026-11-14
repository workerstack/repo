import { describe, expect, it } from "vitest";

import { useTempTree } from "../__fixtures__/temp-tree.ts";
import { devNodeRange, nodeRange } from "./node-range.ts";
import { readWorkspace, type PackageJson, type Workspace } from "./workspace.ts";

const tree = useTempTree("workerstack-node-range-");

/** A manifest declaring `range` as its engines.node, or none when `range` is undefined. */
function manifest(range: string | undefined): PackageJson {
  return range === undefined ? { name: "pkg" } : { engines: { node: range }, name: "pkg" };
}

/** A workspace whose root declares `root` and each `packages` dir declares its range. */
function workspace(root: string | undefined, packages: Record<string, string | undefined> = {}): Workspace {
  return {
    manifest: manifest(root),
    packages: Object.entries(packages).map(([dir, range]) => ({ dir, manifest: manifest(range) })),
    root: "/repo",
  };
}

/** Packages listed out of dir order, one declaring no range. */
const UNSORTED: Workspace = {
  ...workspace(undefined),
  packages: [
    { dir: "packages/web", manifest: manifest(">=22") },
    { dir: "packages/api", manifest: manifest(">=20") },
    { dir: "packages/doc", manifest: manifest(undefined) },
  ],
};

describe("nodeRange", () => {
  it("has no range when no package declares engines.node", () => {
    expect(nodeRange(workspace(undefined))).toStrictEqual({ ok: true, value: undefined });
    const bare = workspace(undefined, { "packages/api": undefined });
    expect(nodeRange(bare)).toStrictEqual({ ok: true, value: undefined });
  });

  it.each<[string, Workspace]>([
    ["the root alone", workspace(">=22", { "packages/api": undefined })],
    ["a workspace package alone", workspace(undefined, { "packages/api": ">=22", "packages/web": undefined })],
    ["the root and every package agreeing", workspace(">=22", { "packages/api": ">=22", "packages/web": ">=22" })],
  ])("reads the one range declared by %s", (_, input) => {
    expect(nodeRange(input)).toStrictEqual({ ok: true, value: ">=22" });
  });

  it("refuses two ranges, naming each declaring package with the root as `.`", () => {
    expect(nodeRange(workspace(">=22", { "packages/api": ">=20" }))).toStrictEqual({
      error: "engines.node differs across packages (. >=22, packages/api >=20); set one range in each",
      ok: false,
    });
  });

  it("lists the declaring packages sorted by dir, skipping those that declare none", () => {
    expect(nodeRange(UNSORTED)).toStrictEqual({
      error: "engines.node differs across packages (packages/api >=20, packages/web >=22); set one range in each",
      ok: false,
    });
  });
});

/** A `devEngines.runtime` value: one entry or a list. */
type Runtime = NonNullable<PackageJson["devEngines"]>["runtime"];

/** A workspace whose root names `runtime` as its devEngines.runtime and whose `packages/api` names `api`. */
function dev(runtime: Runtime, api?: Runtime): Workspace {
  const packages =
    api === undefined ? [] : [{ dir: "packages/api", manifest: { devEngines: { runtime: api }, name: "api" } }];

  return { manifest: { devEngines: { runtime }, name: "app" }, packages, root: "/repo" };
}

describe("devNodeRange", () => {
  it("reads the node entry of an object or a list, and has none for another runtime or no version", () => {
    expect(devNodeRange(dev({ name: "node", version: ">=22.12.0" }))).toStrictEqual({ ok: true, value: ">=22.12.0" });

    const list = [
      { name: "bun", version: ">=1" },
      { name: "node", version: ">=22.12.0" },
    ];

    expect(devNodeRange(dev(list))).toStrictEqual({ ok: true, value: ">=22.12.0" });
    expect(devNodeRange(dev({ name: "bun", version: ">=1" }))).toStrictEqual({ ok: true, value: undefined });
    expect(devNodeRange(dev({ name: "node" }))).toStrictEqual({ ok: true, value: undefined });
    expect(devNodeRange(workspace(">=22"))).toStrictEqual({ ok: true, value: undefined });
  });

  it("refuses two ranges, naming the field and each declaring package", () => {
    expect(devNodeRange(dev({ name: "node", version: ">=22" }, { name: "node", version: ">=24" }))).toStrictEqual({
      error: "devEngines.runtime differs across packages (. >=22, packages/api >=24); set one range in each",
      ok: false,
    });
  });

  it("reads devEngines.runtime from disk, and refuses a runtime that is not an object", () => {
    const root = tree({
      "package.json": JSON.stringify({ devEngines: { runtime: { name: "node", version: ">=22.12.0" } }, name: "app" }),
    });

    const read = readWorkspace(root);
    expect(read.ok && devNodeRange(read.workspace)).toStrictEqual({ ok: true, value: ">=22.12.0" });

    const bad = tree({ "package.json": JSON.stringify({ devEngines: { runtime: "node" }, name: "app" }) });
    expect(readWorkspace(bad).ok).toBe(false);
  });
});

describe("readWorkspace and engines.node", () => {
  it("keeps engines.node from the root and each workspace package's package.json", () => {
    const root = tree({
      "package.json": JSON.stringify({ engines: { node: ">=22" }, workspaces: ["packages/*"] }),
      "packages/api/package.json": JSON.stringify({ engines: { node: ">=20" }, name: "api" }),
    });

    const read = readWorkspace(root);

    if (!read.ok) throw new Error(read.errors.join("\n"));
    expect(read.workspace.manifest.engines).toStrictEqual({ node: ">=22" });
    expect(read.workspace.packages[0]?.manifest.engines).toStrictEqual({ node: ">=20" });
  });

  it("reads a range declared only in a workspace package from disk", () => {
    const root = tree({
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/api/package.json": JSON.stringify({ engines: { node: ">=22" }, name: "api" }),
    });

    const read = readWorkspace(root);

    if (!read.ok) throw new Error(read.errors.join("\n"));
    expect(nodeRange(read.workspace)).toStrictEqual({ ok: true, value: ">=22" });
  });
});
