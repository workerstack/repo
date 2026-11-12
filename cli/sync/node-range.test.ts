import { describe, expect, it } from "vitest";

import { useTempTree } from "../__fixtures__/temp-tree.ts";
import { nodeRange } from "./node-range.ts";
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
