import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { KIT } from "./__fixtures__/deps-kit.ts";
import { useSurfaceOf } from "./__fixtures__/surface-kit.ts";

const surfaceOf = useSurfaceOf("type-surface-star-");

const KIT_TYPE = 'import type { Kit } from "kit";\nexport type Api = Kit;\n';
const PLAIN = "export type P = 1;\n";
const BASE = { bin: { pkg: "./bin.js" }, dependencies: { kit: "1.0.0" } };
const SRC_STAR = { "./*": "./src/*.ts" };

it("leaves out a file a null export key excludes, exactly or by pattern", () => {
  const { uses, keys } = surfaceOf({
    files: {
      "src/hidden.ts": KIT_TYPE,
      "src/internal/ok.ts": PLAIN,
      "src/internal/x.ts": KIT_TYPE,
      "src/pub.ts": PLAIN,
    },
    installed: KIT,
    manifest: {
      ...BASE,
      exports: { ...SRC_STAR, "./hidden": null, "./internal/*": null, "./internal/ok": "./src/internal/ok.ts" },
    },
  });

  expect(uses).toStrictEqual({});
  expect(keys).toStrictEqual({ "src/internal/ok.ts": "./internal/ok", "src/pub.ts": "./pub" });
});

const SWEPT = {
  "src/__fixtures__/f.ts": PLAIN,
  "src/draft.ts": PLAIN,
  "src/pub.spec.ts": PLAIN,
  "src/pub.test.ts": PLAIN,
  "src/pub.ts": PLAIN,
};

it("expands a * export only over the files npm packs, or without files over all but tests and fixtures", () => {
  const listed = surfaceOf({
    files: SWEPT,
    manifest: { ...BASE, exports: SRC_STAR, files: ["./src/*.ts", "src/__fixtures__/", 1, "!src/draft.ts"] },
  });

  const unlisted = surfaceOf({ files: SWEPT, manifest: { ...BASE, exports: SRC_STAR } });

  expect(listed.keys).toStrictEqual({
    "src/__fixtures__/f.ts": "./__fixtures__/f",
    "src/pub.spec.ts": "./pub.spec",
    "src/pub.test.ts": "./pub.test",
    "src/pub.ts": "./pub",
  });
  expect(unlisted.keys).toStrictEqual({ "src/draft.ts": "./draft", "src/pub.ts": "./pub" });
});

/** The dir the unreadable-dir test locks. */
function cache(dir: string): string {
  return path.join(dir, "src", "cache");
}

/** Makes an empty dir under src that no one can read. */
function lockCache(dir: string): void {
  fs.mkdirSync(cache(dir));
  fs.chmodSync(cache(dir), 0);
}

it("skips a dir under a * export it cannot read", () => {
  const kit = { files: { "src/a.ts": PLAIN }, manifest: { ...BASE, exports: SRC_STAR } };
  const { dir, keys } = surfaceOf(kit, lockCache);

  fs.chmodSync(cache(dir), 0o755);
  expect(keys).toStrictEqual({ "src/a.ts": "./a" });
});

it("reads each file an extensionless * target matches by its own extension", () => {
  const { uses, keys } = surfaceOf({
    files: { "src/a.ts": KIT_TYPE, "src/b.json": "{}", "src/d.css": "" },
    installed: KIT,
    manifest: { ...BASE, exports: { "./*": "./src/*" } },
  });

  expect(uses).toStrictEqual({ kit: ["src/a.ts"] });
  expect(keys).toStrictEqual({ "src/a.ts": "./a.ts" });
});

it("reads a build config that reports parse errors as absent", () => {
  const { missing } = surfaceOf({
    files: { "src/a.ts": KIT_TYPE, "tsconfig.build.json": "{ nope" },
    installed: KIT,
    manifest: { ...BASE, exports: { "./*": { default: "./dist/*.js", types: "./dist/*.d.ts" } } },
  });

  expect(missing).toStrictEqual([{ cause: "unmapped", key: "./*", types: "dist/*.d.ts" }]);
});

it("lists no missing types for a * export whose matches null keys or tests all exclude", () => {
  const { keys, missing } = surfaceOf({
    files: { "src/a.test.ts": PLAIN, "src/hidden.ts": PLAIN },
    manifest: { ...BASE, exports: { ...SRC_STAR, "./hidden": null } },
  });

  expect(keys).toStrictEqual({});
  expect(missing).toStrictEqual([]);
});

it("ranks a null key against a * key as Node does: the longer base, then the longer key", () => {
  const { uses, keys } = surfaceOf({
    files: {
      "src/a.internal.ts": KIT_TYPE,
      "src/a.ts": PLAIN,
      "src/internal/pub/x.ts": PLAIN,
      "src/internal/y.ts": KIT_TYPE,
    },
    installed: KIT,
    manifest: {
      ...BASE,
      exports: {
        ...SRC_STAR,
        "./*.internal": null,
        "./internal/*": null,
        "./internal/pub/*": "./src/internal/pub/*.ts",
      },
    },
  });

  expect(uses).toStrictEqual({});
  expect(keys).toStrictEqual({ "src/a.ts": "./a", "src/internal/pub/x.ts": "./internal/pub/x" });
});

it("reads a key whose every condition is null as an exclusion", () => {
  const { uses, keys } = surfaceOf({
    files: { "src/a.ts": KIT_TYPE, "src/b.ts": PLAIN },
    installed: KIT,
    manifest: { ...BASE, exports: { ...SRC_STAR, "./a": { default: null, types: null } } },
  });

  expect(uses).toStrictEqual({});
  expect(keys).toStrictEqual({ "src/b.ts": "./b" });
});

it("reads a files entry with a leading slash from the package root, as npm does", () => {
  const manifest = { ...BASE, exports: SRC_STAR, files: ["/src"] };
  const { keys } = surfaceOf({ files: { "src/pub.ts": PLAIN }, manifest });

  expect(keys).toStrictEqual({ "src/pub.ts": "./pub" });
});
