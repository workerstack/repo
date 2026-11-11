import { expect, it } from "vitest";
import { folderMap } from "./folder-map.ts";
import { mapRepos } from "./fixtures/folder-map-kit.ts";

const { repo, map } = mapRepos();

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

const deep: Record<string, string> = { "a/x.ts": "", "a/b/x.ts": "", "z/x.ts": "", "z/y/x.ts": "" };
for (let i = 0; i < 8; i++) deep[`a/b/component-${i}/x.ts`] = "";

it("folderMap depth uses the deepest uniform depth that fits the budget", () => {
  expect(map(deep)).toContain("    component-7/\n");
  // 40 chars fits two levels everywhere, so every package stops at depth 2.
  const out = folderMap({ root: repo(deep), budget: 10 });
  expect(out?.text).toBe("a/\n  b/  …\nz/\n  y/\n");
  expect(out?.depth).toBe(2);
  expect(out?.text.length).toBeLessThanOrEqual(40);
});

it("folderMap depth lets maxChars lower the limit below the budget", () => {
  const out = folderMap({ root: repo(deep), budget: 1e6, maxChars: 40 });
  expect(out?.text).toBe("a/\n  b/  …\nz/\n  y/\n");
});

it("folderMap depth caps depth per package, counted from the package root", () => {
  const files = {
    "pkgs/p/package.json": JSON.stringify({ name: "p" }),
    "pkgs/p/x.ts": "",
    ...chain("pkgs/p", 4),
  };
  expect(map(files, { depthCap: 2 })).toBe(["pkgs/p/  # p  pkgs/p", "  d0/", "    d1/  …", ""].join("\n"));
});

it("folderMap depth keeps nested packages reachable past the cap", () => {
  const files = {
    "top/x.ts": "",
    "top/mid/x.ts": "",
    "top/mid/deep/x.ts": "",
    "top/mid/deep/pkg/package.json": JSON.stringify({ name: "pkg" }),
    "top/mid/deep/pkg/src/a.ts": "",
    "top/other/x.ts": "",
    "top/other/sub/x.ts": "",
  };
  expect(map(files, { depthCap: 1 })).toBe(
    ["top/", "  mid/", "    deep/", "      pkg/  # pkg  top/mid/deep/pkg", "        src/", "  other/  …", ""].join(
      "\n",
    ),
  );
});
