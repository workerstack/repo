import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { useTempTree } from "../__fixtures__/temp-tree.ts";
import { buildTasks, main, run } from "./vscode-tasks.ts";

const tempRoot = useTempTree("repo-tasks-edges-");

afterEach(() => vi.restoreAllMocks());

describe("vscode-tasks edges", () => {
  it("treats a package.json that is not an object as no package", () => {
    const root = tempRoot({ "package.json": "[1, 2]" });
    expect(buildTasks(root, []).tasks).toStrictEqual([]);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(run(root)).toBe(1);
    expect(err.mock.calls[0]?.[0]).toMatch(/^tasks: cannot read .*package\.json/);
  });

  it("sorts generated tasks by label across root and workspace scripts", () => {
    const root = tempRoot({
      "package.json": JSON.stringify({ scripts: { alpha: "x", zed: "x" }, workspaces: ["pkgs/*"] }),
      "pkgs/a/package.json": JSON.stringify({ name: "mid", scripts: { go: "x" } }),
    });

    expect(buildTasks(root, []).tasks.map((t) => t.label)).toStrictEqual(["alpha", "mid:go", "zed"]);
  });

  it("reports the parse error text of a broken tasks.json", () => {
    const root = tempRoot({ ".vscode/tasks.json": "{ nope", "package.json": "{}" });
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(run(root)).toBe(1);
    expect(err.mock.calls[0]?.[0]).toContain(`cannot parse ${path.join(root, ".vscode/tasks.json")}`);
  });

  it("main writes tasks for the checkout of the working directory", () => {
    const root = tempRoot({ "package.json": JSON.stringify({ scripts: { test: "x" } }) });
    const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process, "cwd").mockReturnValue(root);
    expect(main()).toBe(0);
    expect(log.mock.calls[0]?.[0]).toContain("1 generated");
    expect(fs.existsSync(path.join(root, ".vscode/tasks.json"))).toBe(true);
  });
});
