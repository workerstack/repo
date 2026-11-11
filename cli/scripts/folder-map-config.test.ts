import { expect, it } from "vitest";

import { mapRepos } from "./__fixtures__/folder-map-kit.ts";
import { loadMapConfig } from "./folder-map-config.ts";
import { DEFAULTS } from "./folder-map.constants.ts";
import { folderMap } from "./folder-map.ts";

const { repo } = mapRepos();
const files = { "docs/x.md": "", "src/a.ts": "", "src/legacy/b.ts": "" };

it("folderMap config uses defaults when .repo/map.jsonc is missing", () => {
  expect(loadMapConfig(repo(files))).toStrictEqual({ ...DEFAULTS });
});

it("folderMap config applies jsonc overrides", () => {
  const root = repo({
    ...files,
    ".repo/map.jsonc": `{
        // hide legacy, force docs
        "exclude": ["src/legacy"],
        "include": ["docs"],
        "budget": 900
      }`,
  });
  expect(loadMapConfig(root).budget).toBe(900);
  expect(folderMap({ root })?.text).toBe("docs/\nsrc/\n");
});

it("folderMap config falls back to defaults on invalid jsonc and warns", () => {
  const root = repo({ ...files, ".repo/map.jsonc": "{ nope" });
  const warn: string[] = [];
  expect(loadMapConfig(root, (m: string) => warn.push(m))).toStrictEqual({ ...DEFAULTS });
  expect(warn[0]).toMatch(/\.repo\/map\.jsonc/);
});

it("folderMap config ignores each key with a bad value, warning by name, and keeps the good ones", () => {
  const root = repo({
    ...files,
    ".repo/map.jsonc": '{ "budget": -1, "exclude": [1], "include": ["docs"], "other": 1 }',
  });
  const warn: string[] = [];
  expect(loadMapConfig(root, (m: string) => warn.push(m))).toStrictEqual({ ...DEFAULTS, include: ["docs"] });
  expect(warn).toStrictEqual([
    "repo map: ignoring .repo/map.jsonc key budget",
    "repo map: ignoring .repo/map.jsonc key exclude",
  ]);
});

it("folderMap config uses defaults when the config is not an object", () => {
  const root = repo({ ...files, ".repo/map.jsonc": "[1]" });
  expect(loadMapConfig(root, () => {})).toStrictEqual({ ...DEFAULTS });
});
