import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { useTempTree } from "./__fixtures__/temp-tree.ts";
import { buildOutputs } from "./build-outputs.ts";
import { withTsApi } from "./ts-api.ts";
import { posix } from "./ts-program.ts";

const tree = useTempTree("build-outputs-");

/** What the build config in `dir` emits, as dir-relative outputs mapped to dir-relative sources. */
async function outputsIn(dir: string): Promise<Record<string, string> | undefined> {
  const real = posix(fs.realpathSync(dir));
  const outputs = await withTsApi(real, (run) => buildOutputs(run, real));

  if (outputs === undefined) return undefined;

  return Object.fromEntries(
    [...outputs].map(([output, source]) => [posix(path.relative(real, output)), posix(path.relative(real, source))]),
  );
}

/** The compiler options a test build config sets over `declaration: true`. */
type Options = Readonly<Record<string, boolean | string>>;

/** A build config of `options`, over `files` when given. */
function config(options: Options, files?: readonly string[]): string {
  return JSON.stringify({
    compilerOptions: { declaration: true, ...options },
    ...(files === undefined ? {} : { files }),
  });
}

it("maps each output a build config emits to its source, both in typescript's slash spelling", async () => {
  const dir = tree({
    "src/a.ts": "export const a = 1;\n",
    "tsconfig.build.json": config({ outDir: "lib", rootDir: "src" }),
  });

  expect(await outputsIn(dir)).toStrictEqual({ "lib/a.d.ts": "src/a.ts", "lib/a.js": "src/a.ts" });
});

it("names each module kind's script and declaration, a tsx kept as jsx under preserve", async () => {
  const dir = tree({
    "src/a.tsx": "export const a = 1;\n",
    "src/b.mts": "export const b = 1;\n",
    "src/c.cts": "export const c = 1;\n",
    "tsconfig.build.json": config({ jsx: "preserve", outDir: "lib", rootDir: "src" }),
  });

  expect(await outputsIn(dir)).toStrictEqual({
    "lib/a.d.ts": "src/a.tsx",
    "lib/a.jsx": "src/a.tsx",
    "lib/b.d.mts": "src/b.mts",
    "lib/b.mjs": "src/b.mts",
    "lib/c.cjs": "src/c.cts",
    "lib/c.d.cts": "src/c.cts",
  });
});

it("emits a tsx as js under any other jsx setting", async () => {
  const dir = tree({
    "src/a.tsx": "export const a = 1;\n",
    "tsconfig.build.json": config({ jsx: "react-jsx", outDir: "lib", rootDir: "src" }),
  });

  expect(await outputsIn(dir)).toStrictEqual({ "lib/a.d.ts": "src/a.tsx", "lib/a.js": "src/a.tsx" });
});

it("keeps a script source's own extension and copies json with no declaration", async () => {
  const dir = tree({
    "src/a.jsx": "export const a = 1;\n",
    "src/b.mjs": "export const b = 1;\n",
    "src/c.cjs": "exports.c = 1;\n",
    "src/d.json": "{}\n",
    "tsconfig.build.json": config(
      { allowJs: true, jsx: "preserve", outDir: "lib", resolveJsonModule: true, rootDir: "src" },
      ["src/a.jsx", "src/b.mjs", "src/c.cjs", "src/d.json"],
    ),
  });

  expect(await outputsIn(dir)).toStrictEqual({
    "lib/a.d.ts": "src/a.jsx",
    "lib/a.jsx": "src/a.jsx",
    "lib/b.d.mts": "src/b.mjs",
    "lib/b.mjs": "src/b.mjs",
    "lib/c.cjs": "src/c.cjs",
    "lib/c.d.cts": "src/c.cjs",
    "lib/d.json": "src/d.json",
  });
});

it("puts declarations in declarationDir, and roots outputs at the config's dir with no rootDir", async () => {
  const dir = tree({
    "a.ts": "export const a = 1;\n",
    "tsconfig.build.json": config({ declarationDir: "types", outDir: "lib" }),
  });

  expect(await outputsIn(dir)).toStrictEqual({ "lib/a.js": "a.ts", "types/a.d.ts": "a.ts" });
});

it("builds beside the source with no outDir, copies no json, skips a declaration or an unbuildable file", async () => {
  const dir = tree({
    "src/a.ts": "export const a = 1;\n",
    "src/b.d.ts": "export {};\n",
    "src/c.txt": "c\n",
    "src/d.json": "{}\n",
    "tsconfig.build.json": config({ resolveJsonModule: true }, ["src/a.ts", "src/b.d.ts", "src/c.txt", "src/d.json"]),
  });

  expect(await outputsIn(dir)).toStrictEqual({ "src/a.d.ts": "src/a.ts", "src/a.js": "src/a.ts" });
});

it("is undefined for a build config that does not parse, or no build config", async () => {
  expect(await outputsIn(tree({ "tsconfig.build.json": "{ nope" }))).toBeUndefined();
  expect(await outputsIn(tree({ "a.ts": "export {};\n" }))).toBeUndefined();
});

it.skipIf(process.platform === "win32")(
  "reads a dir spelled with a backslash as typescript does, never tripping its own path assertion",
  async () => {
    const root = tree({ "a\\b/tsconfig.build.json": "{ nope" });

    expect(await outputsIn(path.join(root, "a\\b"))).toBeUndefined();
  },
);

/** A solution build config: no files of its own, and `references` as given. */
function solution(references: readonly unknown[]): string {
  return JSON.stringify({ files: [], references });
}

const API = {
  "src/a.ts": "export const a = 1;\n",
  "tsconfig.api.json": config({ outDir: "lib", rootDir: "src" }, ["src/a.ts"]),
};

const WEB = {
  "web/src/w.ts": "export const w = 1;\n",
  "web/tsconfig.json": config({ outDir: "dist" }, ["src/w.ts"]),
};

it("maps the outputs of each config a solution build config references, a folder as its tsconfig.json", async () => {
  const dir = tree({
    ...API,
    ...WEB,
    "tsconfig.build.json": solution([{ path: "./tsconfig.api.json" }, { path: "./web" }]),
  });

  expect(await outputsIn(dir)).toStrictEqual({
    "lib/a.d.ts": "src/a.ts",
    "lib/a.js": "src/a.ts",
    "web/dist/src/w.d.ts": "web/src/w.ts",
    "web/dist/src/w.js": "web/src/w.ts",
  });
});

it("maps a config two others reference once, and the root's own outputs beside its references'", async () => {
  const dir = tree({
    ...API,
    ...WEB,
    "src/r.ts": "export const r = 1;\n",
    "tsconfig.build.json": JSON.stringify({
      compilerOptions: { declaration: true, outDir: "out", rootDir: "src" },
      files: ["src/r.ts"],
      references: [{ path: "./tsconfig.api.json" }, { path: "./tsconfig.mid.json" }],
    }),
    "tsconfig.mid.json": solution([{ path: "./web/tsconfig.json" }, { path: "./tsconfig.api.json" }]),
  });

  expect(await outputsIn(dir)).toStrictEqual({
    "lib/a.d.ts": "src/a.ts",
    "lib/a.js": "src/a.ts",
    "out/r.d.ts": "src/r.ts",
    "out/r.js": "src/r.ts",
    "web/dist/src/w.d.ts": "web/src/w.ts",
    "web/dist/src/w.js": "web/src/w.ts",
  });
});

/** A build config of its own `src/a.ts` into `lib`, over `references`. */
function buildOf(references: readonly unknown[]): string {
  return JSON.stringify({
    compilerOptions: { declaration: true, outDir: "lib", rootDir: "src" },
    files: ["src/a.ts"],
    references,
  });
}

const OWN = { "lib/a.d.ts": "src/a.ts", "lib/a.js": "src/a.ts" };

it("ends on a reference cycle", async () => {
  const dir = tree({
    "src/a.ts": "export const a = 1;\n",
    "tsconfig.build.json": buildOf([{ path: "./tsconfig.other.json" }]),
    "tsconfig.other.json": solution([{ path: "./tsconfig.build.json" }]),
  });

  expect(await outputsIn(dir)).toStrictEqual(OWN);
});

it("adds nothing for a reference to a missing file, a path that is no string or a bad config", async () => {
  const dir = tree({
    "broken.json": "{ nope",
    "nopath.json": JSON.stringify({ files: ["src/b.ts"], references: [{ path: 1 }] }),
    "src/a.ts": "export const a = 1;\n",
    "src/b.ts": "export const b = 1;\n",
    "tsconfig.build.json": buildOf([
      { path: "./gone.json" },
      { path: "./missing" },
      { path: "./broken.json" },
      { path: "./nopath.json" },
      "./x",
      null,
    ]),
  });

  expect(await outputsIn(dir)).toStrictEqual(OWN);
});
