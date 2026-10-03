import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULTS, folderMap, loadMapConfig } from "./folder-map.mjs";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

/** Temp git repo; untracked unignored files count, so no commit is needed. */
function repo(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "folder-map-"));
  tmpDirs.push(root);
  spawnSync("git", ["init", "-q"], { cwd: root });
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return root;
}

function map(files: Record<string, string>, opts = {}) {
  const out = folderMap({ root: repo(files), ...opts });
  if (!out) throw new Error("expected a map");
  return out.text;
}

describe("folderMap core", () => {
  it("lists folders that hold code, never files", () => {
    const text = map({
      "src/a.ts": "",
      "src/lib/b.ts": "",
      "docs/guide.md": "",
    });
    expect(text).toBe("src/\n  lib/\n");
  });

  it("skips dot dirs, generated, static, and test-data segments", () => {
    const text = map({
      "src/a.ts": "",
      ".github/x.js": "",
      "src/_gen/x.ts": "",
      "dist/x.js": "",
      "public/x.js": "",
      "src/__fixtures__/x.ts": "",
      "vendor/x.go": "",
    });
    expect(text).toBe("src/\n");
  });

  it("drops gitignored folders", () => {
    const text = map({
      ".gitignore": "out/\n",
      "src/a.ts": "",
      "out/b.ts": "",
    });
    expect(text).toBe("src/\n");
  });

  it("collapses single-child chains", () => {
    expect(map({ "a/b/c/x.ts": "", "a/b/c/d/y.ts": "" })).toBe("a/b/c/\n  d/\n");
  });

  it("anchors package rows with name and full path, and does not collapse through them", () => {
    const text = map({
      "packages/web/package.json": JSON.stringify({ name: "@x/web" }),
      "packages/web/src/a.ts": "",
      "packages/api/go.mod": "module example.com/api\n",
      "packages/api/main.go": "",
    });
    expect(text).toBe(
      [
        "packages/",
        "  api/  # example.com/api  packages/api",
        "  web/  # @x/web  packages/web",
        "    src/",
        "",
      ].join("\n"),
    );
  });

  it("folds plain leaf dirs at foldAt without folding structured siblings", () => {
    const files: Record<string, string> = { "src/dtos/core/deep/x.ts": "" };
    for (let i = 0; i < 12; i++) files[`src/dtos/t${String(i).padStart(2, "0")}/x.ts`] = "";
    const text = map(files);
    expect(text).toBe(
      [
        "src/dtos/",
        "  (12 leaf dirs: t00, t01, t02, t03, t04, t05, …)",
        "  core/deep/",
        "",
      ].join("\n"),
    );
  });

  it("renders brackets, parens, and spaces verbatim", () => {
    const text = map({
      "app/(dash)/[orgId]/page.tsx": "",
      "app/[[...slug]]/page.tsx": "",
      "app/my dir/x.ts": "",
    });
    expect(text).toBe("app/\n  (dash)/[orgId]/\n  [[...slug]]/\n  my dir/\n");
  });

  it("is deterministic", () => {
    const files = { "b/x.ts": "", "a/y.ts": "", "a/c/z.ts": "" };
    const root = repo(files);
    expect(folderMap({ root })?.text).toBe(folderMap({ root })?.text);
    expect(folderMap({ root })?.text).toBe("a/\n  c/\nb/\n");
  });

  it("scopes to a dir with package paths kept repo-relative", () => {
    const root = repo({
      "apps/web/package.json": JSON.stringify({ name: "web" }),
      "apps/web/src/a.ts": "",
      "apps/web/src/ui/b.ts": "",
      "libs/x.ts": "",
    });
    expect(folderMap({ root, dir: "apps" })?.text).toBe(
      "web/  # web  apps/web\n  src/\n    ui/\n",
    );
  });

  it("scopes correctly when root is an alias path git reports differently", () => {
    // Same mismatch as Windows 8.3 short paths: git prints the real path.
    const root = repo({ "apps/web/src/a.ts": "", "libs/x.ts": "" });
    const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "folder-map-link-")), "repo");
    tmpDirs.push(path.dirname(link));
    fs.symlinkSync(root, link, "junction");
    expect(folderMap({ root: link, dir: "apps" })?.text).toBe("web/src/\n");
  });

  it("returns an empty map for a missing scope dir", () => {
    const root = repo({ "src/a.ts": "" });
    expect(folderMap({ root, dir: "nope" })).toEqual({ text: "", rows: 0, tokens: 0 });
  });

  it("returns null outside a git repo", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "folder-map-nogit-"));
    tmpDirs.push(dir);
    expect(folderMap({ root: dir })).toBeNull();
  });
});

/** Dirs with their own code file at every level, so nothing collapses. */
function chain(prefix: string, depth: number) {
  const files: Record<string, string> = {};
  let p = prefix;
  for (let i = 0; i < depth; i++) {
    p = `${p}/d${i}`;
    files[`${p}/x.ts`] = "";
  }
  return files;
}

describe("folderMap budget", () => {
  it("expands breadth-first and stops at the last level that fits", () => {
    const files: Record<string, string> = { "a/x.ts": "", "a/b/x.ts": "", "z/x.ts": "", "z/y/x.ts": "" };
    for (let i = 0; i < 8; i++) files[`a/b/component-${i}/x.ts`] = "";
    expect(map(files)).toContain("    component-7/\n");
    // Room for levels 0-1 only: level 2 is cut and b/ points at it.
    const out = folderMap({ root: repo(files), budget: 10 });
    expect(out?.text).toBe("a/\n  b/  …\nz/\n  y/\n");
    expect(out!.tokens).toBeLessThanOrEqual(10);
  });

  it("caps depth per package, counted from the package root", () => {
    const files = {
      "pkgs/p/package.json": JSON.stringify({ name: "p" }),
      "pkgs/p/x.ts": "",
      ...chain("pkgs/p", 4),
    };
    expect(map(files, { depthCap: 2 })).toBe(
      ["pkgs/p/  # p  pkgs/p", "  d0/", "    d1/  …", ""].join("\n"),
    );
  });

  it("gives each top-level subtree a fair share when a level overflows", () => {
    const small = { "s/x.ts": "", "s/k/x.ts": "" };
    const big: Record<string, string> = { "b/x.ts": "" };
    for (let i = 0; i < 11; i++) big[`b/wide${i}/x.ts`] = "";
    const out = folderMap({ root: repo({ ...small, ...big }), budget: 20 });
    // s/ expands (cheap); b/ cannot fit its share, so it is cut with a pointer.
    expect(out?.text).toBe("b/  …\ns/\n  k/\n");
    expect(out!.tokens).toBeLessThanOrEqual(20);
  });
});

describe("folderMap config", () => {
  const files = { "src/a.ts": "", "src/legacy/b.ts": "", "docs/x.md": "" };

  it("uses defaults when .rulesync/grunt.map.jsonc is missing", () => {
    expect(loadMapConfig(repo(files))).toEqual({ ...DEFAULTS });
  });

  it("applies jsonc overrides", () => {
    const root = repo({
      ...files,
      ".rulesync/grunt.map.jsonc": `{
        // hide legacy, force docs
        "exclude": ["src/legacy"],
        "include": ["docs"],
        "budget": 900
      }`,
    });
    expect(loadMapConfig(root).budget).toBe(900);
    expect(folderMap({ root })?.text).toBe("docs/\nsrc/\n");
  });

  it("falls back to defaults on invalid jsonc and warns", () => {
    const root = repo({ ...files, ".rulesync/grunt.map.jsonc": "{ nope" });
    const warn: string[] = [];
    expect(loadMapConfig(root, (m: string) => warn.push(m))).toEqual({ ...DEFAULTS });
    expect(warn[0]).toMatch(/grunt\.map\.jsonc/);
  });
});
