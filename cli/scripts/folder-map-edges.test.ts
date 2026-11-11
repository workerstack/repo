import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { folderMap, mapCommand } from "./folder-map.ts";
import { listFiles, repoPrefix } from "./folder-map-config.ts";
import { buildTree, displayRows, rowText } from "./folder-map-tree.ts";

const tmpDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function plant(files: Record<string, string>, init = true) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "folder-map-edge-")));
  tmpDirs.push(root);
  if (init) spawnSync("git", ["init", "-q"], { cwd: root });
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

describe("git edges", () => {
  it("has no prefix and no file list outside a repo", () => {
    const root = plant({ "a.ts": "" }, false);
    expect(repoPrefix(root)).toBeNull();
    expect(listFiles(root)).toBeNull();
  });

  it("has no prefix for a file or a missing path, and none at the top", () => {
    const root = plant({ "src/a.ts": "" });
    expect(repoPrefix(path.join(root, "src/a.ts"))).toBeNull();
    expect(repoPrefix(path.join(root, "gone"))).toBeNull();
    expect(repoPrefix(root)).toBe("");
    expect(repoPrefix(path.join(root, "src"))).toBe("src");
  });

  it("maps nothing when git cannot list the files", () => {
    const root = plant({ "src/a.ts": "" });
    fs.writeFileSync(path.join(root, ".git", "index"), "not an index");
    expect(folderMap({ root })).toBeNull();
  });

  it("warns on stderr by default about a config it cannot read", () => {
    const root = plant({ "src/a.ts": "", ".repo/map.jsonc": "{ nope" });
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((s) => written.push(String(s)) > 0);
    expect(folderMap({ root })?.text).toBe("src/\n");
    expect(written[0]).toMatch(/^repo map: ignoring \.repo\/map\.jsonc: /);
  });
});

describe("package names", () => {
  const nameOf = (files: Record<string, string>, dir: string) => {
    const root = plant(files, false);
    return buildTree(root, Object.keys(files)).kids.get(dir)?.pkg;
  };

  it("reads the name of each manifest kind", () => {
    expect(nameOf({ "a/package.json": '{"name":"@x/a"}', "a/i.ts": "" }, "a")).toBe("@x/a");
    expect(nameOf({ "a/go.mod": "module example.com/a\n", "a/i.go": "" }, "a")).toBe("example.com/a");
    expect(nameOf({ "a/pyproject.toml": '[project]\nname = "pya"\n', "a/i.py": "" }, "a")).toBe("pya");
  });

  it("names a package with a manifest that holds no name as unnamed", () => {
    expect(nameOf({ "a/package.json": "{}", "a/i.ts": "" }, "a")).toBe("");
    expect(nameOf({ "a/package.json": "[1]", "a/i.ts": "" }, "a")).toBe("");
    expect(nameOf({ "a/package.json": '{"name":3}', "a/i.ts": "" }, "a")).toBe("");
    expect(nameOf({ "a/go.mod": "go 1.22\n", "a/i.go": "" }, "a")).toBe("");
    expect(nameOf({ "a/pyproject.toml": "[tool]\n", "a/i.py": "" }, "a")).toBe("");
  });

  it("names a package with an unreadable manifest as unnamed", () => {
    expect(nameOf({ "a/package.json": "{ nope", "a/i.ts": "" }, "a")).toBe("");
  });
});

describe("rows", () => {
  it("builds and renders a tree with the default options", () => {
    const root = plant({ "a/i.ts": "" }, false);
    const rows = displayRows(buildTree(root, ["a/i.ts"]));
    expect(rows.map((r) => rowText(r, 1))).toStrictEqual(["  a/"]);
  });

  it("shows a package without a name by its path alone", () => {
    const root = plant({ "a/package.json": "{}", "a/i.ts": "" }, false);
    const rows = displayRows(buildTree(root, ["a/package.json", "a/i.ts"]));
    expect(rows.map((r) => rowText(r, 0))).toStrictEqual(["a/  # a"]);
    expect(rows.map((r) => rowText(r, 0, { base: "up" }))).toStrictEqual(["a/  # up/a"]);
  });

  it("folds many leaf dirs and names the first six", () => {
    const files = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`d${i}/x.ts`, ""]));
    const root = plant(files);
    expect(folderMap({ root, foldAt: 8 })?.text).toBe("(8 leaf dirs: d0, d1, d2, d3, d4, d5, …)\n");
    expect(displayRows(buildTree(root, Object.keys(files)), { foldAt: 9 })).toHaveLength(8);
  });

  it("names every leaf dir of a short fold without an ellipsis", () => {
    const root = plant({ "a/x.ts": "", "b/x.ts": "" });
    expect(folderMap({ root, foldAt: 2 })?.text).toBe("(2 leaf dirs: a, b)\n");
  });
});

describe("maps with no code folders", () => {
  it("is an empty map, and the command says so", () => {
    const root = plant({ "docs/a.md": "" });
    expect(folderMap({ root })).toStrictEqual({ text: "", rows: 0, tokens: 0, depth: 6 });
    expect(mapCommand(root)).toBe("repo map: no code folders\n");
  });

  it("is not a map outside a repo", () => {
    expect(mapCommand(plant({}, false))).toBe("repo map: not a git repository\n");
  });

  it("maps the scoped dir the command names", () => {
    const root = plant({ "src/lib/a.ts": "", "other/b.ts": "" });
    expect(mapCommand(root, "src")).toBe("lib/\n");
  });
});
