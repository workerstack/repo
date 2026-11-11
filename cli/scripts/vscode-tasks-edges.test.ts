import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTasks, main, run } from "./vscode-tasks.ts";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tempRoot(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-tasks-edges-"));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

describe("vscode-tasks edges", () => {
  it("treats a package.json that is not an object as no package", () => {
    const root = tempRoot({ "package.json": "[1, 2]" });
    expect(buildTasks(root, []).tasks).toStrictEqual([]);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(run(root)).toBe(1);
    expect(err.mock.calls[0]?.[0]).toMatch(/^tasks: cannot read .*package\.json/);
  });

  it("sorts generated tasks by label across root and workspace scripts", () => {
    const root = tempRoot({
      "package.json": JSON.stringify({ workspaces: ["pkgs/*"], scripts: { zed: "x", alpha: "x" } }),
      "pkgs/a/package.json": JSON.stringify({ name: "mid", scripts: { go: "x" } }),
    });
    expect(buildTasks(root, []).tasks.map((t) => t.label)).toStrictEqual(["alpha", "mid:go", "zed"]);
  });

  it("reports the parse error text of a broken tasks.json", () => {
    const root = tempRoot({ "package.json": "{}", ".vscode/tasks.json": "{ nope" });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(run(root)).toBe(1);
    expect(err.mock.calls[0]?.[0]).toContain(`cannot parse ${path.join(root, ".vscode/tasks.json")}`);
  });

  it("main writes tasks for the checkout of the working directory", () => {
    const root = tempRoot({ "package.json": JSON.stringify({ scripts: { test: "x" } }) });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "cwd").mockReturnValue(root);
    expect(main()).toBe(0);
    expect(log.mock.calls[0]?.[0]).toContain("1 generated");
    expect(fs.existsSync(path.join(root, ".vscode/tasks.json"))).toBe(true);
  });
});
