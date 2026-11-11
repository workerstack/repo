import { expect, it } from "vitest";

import { exportFindings, isPublic, specifiersOf } from "./docs-exports.ts";

/** An `exports` condition map. Conditions resolve in order, so `types` stays before `default`. */
const conditions = (types: string, runtime: string) => ({
  types,

  default: runtime,
});

const manifest = {
  exports: {
    ".": "./cli/config.ts",
    "./lint": "./cli/lint/index.ts",
    "./package.json": "./package.json",
    "./references/*": "./references/*",
    "./tsconfig/*": "./tsconfig/*.json",
  },
  name: "@workerstack/repo",
  private: false,
};

it("derives a specifier per export but package.json and references", () => {
  expect(specifiersOf(manifest.name, manifest.exports)).toStrictEqual([
    { prefix: false, shown: "@workerstack/repo", text: "@workerstack/repo" },
    { prefix: false, shown: "@workerstack/repo/lint", text: "@workerstack/repo/lint" },
    { prefix: true, shown: "@workerstack/repo/tsconfig/*", text: "@workerstack/repo/tsconfig/" },
  ]);
});

it("names the exports no reference holds quoted or in a code span", () => {
  const docs = 'import x from "@workerstack/repo"; see `@workerstack/repo/tsconfig/bun`; "@workerstack/repo/linter"';
  expect(exportFindings("", manifest, docs)).toStrictEqual({
    checked: 3,
    findings: ["@workerstack/repo/lint is exported but no reference names it; document it in references/"],
  });
});

it("prefixes a package's paths with its folder and asks for the references export", () => {
  const pkg = { exports: { ".": "./a.ts", "./x": "./x.ts" }, name: "@ws/a" };
  expect(exportFindings("packages/a", pkg, "'@ws/a' and `@ws/a/x`")).toStrictEqual({
    checked: 2,
    findings: [`packages/a/package.json has no "./references/*" export; add "./references/*": "./references/*"`],
  });
  expect(exportFindings("packages/a", pkg, "").findings[0]).toBe(
    "@ws/a is exported but no reference names it; document it in packages/a/references/",
  );
});

it("reads a string, a list or a bare condition map as the . export, and none as nothing", () => {
  expect(specifiersOf("p", "./index.js").map((one) => one.shown)).toStrictEqual(["p"]);
  expect(specifiersOf("p", conditions("./a.d.ts", "./a.js")).map((one) => one.shown)).toStrictEqual(["p"]);
  expect(specifiersOf("p", ["./a.js"]).map((one) => one.shown)).toStrictEqual(["p"]);
  expect(specifiersOf("p", undefined)).toStrictEqual([]);
});

it("asks a nameless manifest without exports for the references export", () => {
  expect(exportFindings("", {}, "").findings).toStrictEqual([
    `package.json has no "./references/*" export; add "./references/*": "./references/*"`,
  ]);
});

it("calls a manifest public only with private: false", () => {
  expect(isPublic({ private: false })).toBe(true);
  expect(isPublic({ private: true })).toBe(false);
  expect(isPublic({})).toBe(false);
});
