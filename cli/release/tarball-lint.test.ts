import { afterEach, describe, expect, it } from "vitest";
import { removePlanted } from "../fixtures/planted-repo.ts";
import { cleanManifest, CLEAN_FILES, fixtureTarball } from "./fixtures/tarball.ts";
import { tarballLint } from "./tarball-lint.ts";

const TIMEOUT = 120_000;
afterEach(removePlanted);

const BOTH = {
  import: { types: "./index.d.ts", default: "./index.js" },
  require: { types: "./index.d.cts", default: "./index.cjs" },
};
const BOTH_FILES = {
  ...CLEAN_FILES,
  "index.d.cts": "export declare const a: number;\n",
  "index.cjs": "exports.a = 1;\n",
};
/** An ESM package whose top-level `types` exists but whose `exports` lists no types: untyped under bundler and node16. */
const attwOnly = (lines: string[]): string[] => lines.filter((line) => line.startsWith("attw: "));
const untypedExports = () =>
  fixtureTarball(cleanManifest({ types: "./types/index.d.ts", exports: { ".": "./index.js" } }), {
    "index.js": CLEAN_FILES["index.js"] ?? "",
    "types/index.d.ts": CLEAN_FILES["index.d.ts"] ?? "",
  });

describe("tarballLint", () => {
  it("passes a clean ESM package", { timeout: TIMEOUT }, async () => {
    expect(await tarballLint(fixtureTarball(cleanManifest()))).toStrictEqual([]);
  });

  it("fails a publint error with its formatted message", { timeout: TIMEOUT }, async () => {
    const tarball = fixtureTarball(cleanManifest(), { "index.d.ts": CLEAN_FILES["index.d.ts"] ?? "" });
    const got = await tarballLint(tarball);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatch(/^publint: .*index\.js/);
  });

  it("runs no attw check on a package that ships no types", { timeout: TIMEOUT }, async () => {
    const got = await tarballLint(fixtureTarball(cleanManifest(), { "index.js": CLEAN_FILES["index.js"] ?? "" }));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatch(/^publint: /);
  });

  it("fails a publint suggestion too", { timeout: TIMEOUT }, async () => {
    const repository = { type: "git", url: "https://github.com/acme/fx.git" };
    const got = await tarballLint(fixtureTarball(cleanManifest({ repository })));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatch(/^publint: pkg\.repository\.url/);
  });
});

describe("tarballLint attw", () => {
  it("fails an attw problem under bundler and node16 from ESM", { timeout: TIMEOUT }, async () => {
    const got = attwOnly(await tarballLint(untypedExports()));
    expect(got).toStrictEqual([
      expect.stringMatching(/^attw: \. under node16 \(from ESM\): .*\(UntypedResolution\)$/),
      expect.stringMatching(/^attw: \. under bundler: .*\(UntypedResolution\)$/),
    ]);
  });

  it("ignores node10 and node16-cjs for an ESM-only package", { timeout: TIMEOUT }, async () => {
    const exports = { ".": CLEAN_ESM(), "./sub": CLEAN_ESM() };
    const got = await tarballLint(fixtureTarball(cleanManifest({ exports }), CLEAN_FILES));
    expect(got).toStrictEqual([]);
  });

  it("reports node10 problems once an export has require", { timeout: TIMEOUT }, async () => {
    const exports = { ".": BOTH, "./sub": BOTH };
    const got = await tarballLint(fixtureTarball(cleanManifest({ exports }), BOTH_FILES));
    expect(got).toStrictEqual([expect.stringMatching(/^attw: \.\/sub under node10: .*\(NoResolution\)$/)]);
  });

  it("reports a problem that names no entrypoint", { timeout: TIMEOUT }, async () => {
    const got = attwOnly(await tarballLint(fixtureTarball(cleanManifest({ type: undefined }), CLEAN_FILES)));
    expect(got).toStrictEqual([expect.stringMatching(/^attw: package: .*\(UnexpectedModuleSyntax\)$/)]);
  });
});

function CLEAN_ESM() {
  return { types: "./index.d.ts", default: "./index.js" };
}
