import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { folderMap } from "./folder-map.ts";
import { mapRepos } from "./fixtures/folder-map-kit.ts";

const { repo, map, track } = mapRepos();

it("folderMap core lists folders that hold code, never files", () => {
  const text = map({
    "src/a.ts": "",
    "src/lib/b.ts": "",
    "docs/guide.md": "",
  });
  expect(text).toBe("src/\n  lib/\n");
});

it("folderMap core skips dot dirs, generated, static, and test-data segments", () => {
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

it("folderMap core maps cli/scripts, skipping its fixtures and dot dirs", () => {
  const text = map({
    "src/a.ts": "",
    "cli/scripts/a.mjs": "",
    "cli/scripts/fixtures/x.mjs": "",
    ".hidden/other/x.mjs": "",
  });
  expect(text).toBe("cli/scripts/\nsrc/\n");
});

it("folderMap core drops gitignored folders", () => {
  const text = map({
    ".gitignore": "out/\n",
    "src/a.ts": "",
    "out/b.ts": "",
  });
  expect(text).toBe("src/\n");
});

it("folderMap core collapses single-child chains", () => {
  expect(map({ "a/b/c/x.ts": "", "a/b/c/d/y.ts": "" })).toBe("a/b/c/\n  d/\n");
});

it("folderMap core anchors package rows with name and full path, and does not collapse through them", () => {
  const text = map({
    "packages/web/package.json": JSON.stringify({ name: "@x/web" }),
    "packages/web/src/a.ts": "",
    "packages/api/go.mod": "module example.com/api\n",
    "packages/api/main.go": "",
  });
  expect(text).toBe(
    ["packages/", "  api/  # example.com/api  packages/api", "  web/  # @x/web  packages/web", "    src/", ""].join(
      "\n",
    ),
  );
});

it("folderMap core folds plain leaf dirs at foldAt without folding structured siblings", () => {
  const files: Record<string, string> = { "src/dtos/core/deep/x.ts": "" };
  for (let i = 0; i < 12; i++) files[`src/dtos/t${String(i).padStart(2, "0")}/x.ts`] = "";
  const text = map(files);
  expect(text).toBe(["src/dtos/", "  (12 leaf dirs: t00, t01, t02, t03, t04, t05, …)", "  core/deep/", ""].join("\n"));
});

it("folderMap core renders brackets, parens, and spaces verbatim", () => {
  const text = map({
    "app/(dash)/[orgId]/page.tsx": "",
    "app/[[...slug]]/page.tsx": "",
    "app/my dir/x.ts": "",
  });
  expect(text).toBe("app/\n  (dash)/[orgId]/\n  [[...slug]]/\n  my dir/\n");
});

it("folderMap core is deterministic", () => {
  const files = { "b/x.ts": "", "a/y.ts": "", "a/c/z.ts": "" };
  const root = repo(files);
  expect(folderMap({ root })?.text).toBe(folderMap({ root })?.text);
  expect(folderMap({ root })?.text).toBe("a/\n  c/\nb/\n");
});

it("folderMap core scopes to a dir with package paths kept repo-relative", () => {
  const root = repo({
    "apps/web/package.json": JSON.stringify({ name: "web" }),
    "apps/web/src/a.ts": "",
    "apps/web/src/ui/b.ts": "",
    "libs/x.ts": "",
  });
  expect(folderMap({ root, dir: "apps" })?.text).toBe("web/  # web  apps/web\n  src/\n    ui/\n");
});

it("folderMap core scopes correctly when root is an alias path git reports differently", () => {
  // Same mismatch as Windows 8.3 short paths: git prints the real path.
  const root = repo({ "apps/web/src/a.ts": "", "libs/x.ts": "" });
  const link = path.join(track(fs.mkdtempSync(path.join(os.tmpdir(), "folder-map-link-"))), "repo");
  fs.symlinkSync(root, link, "junction");
  expect(folderMap({ root: link, dir: "apps" })?.text).toBe("web/src/\n");
});

it("folderMap core returns an empty map for a missing scope dir", () => {
  const root = repo({ "src/a.ts": "" });
  expect(folderMap({ root, dir: "nope" })).toStrictEqual({ text: "", rows: 0, tokens: 0, depth: 0 });
});

it("folderMap core returns null outside a git repo", () => {
  const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), "folder-map-nogit-")));
  expect(folderMap({ root: dir })).toBeNull();
});
