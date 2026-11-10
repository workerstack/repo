import { expect, it } from "vitest";
import { exportFindings, isPublic, specifiersOf } from "./docs-exports.ts";

const manifest = {
  name: "@workerstack/repo",
  private: false,
  exports: {
    ".": "./cli/config.ts",
    "./lint": "./cli/lint/index.ts",
    "./tsconfig/*": "./tsconfig/*.json",
    "./package.json": "./package.json",
    "./references/*": "./references/*",
  },
};

it("derives a specifier per export but package.json and references", () => {
  expect(specifiersOf(manifest.name, manifest.exports)).toEqual([
    { text: "@workerstack/repo", prefix: false, shown: "@workerstack/repo" },
    { text: "@workerstack/repo/lint", prefix: false, shown: "@workerstack/repo/lint" },
    { text: "@workerstack/repo/tsconfig/", prefix: true, shown: "@workerstack/repo/tsconfig/*" },
  ]);
});

it("names the exports no reference holds quoted or in a code span", () => {
  const docs = 'import x from "@workerstack/repo"; see `@workerstack/repo/tsconfig/bun`; "@workerstack/repo/linter"';
  expect(exportFindings("", manifest, docs)).toEqual({
    findings: ["@workerstack/repo/lint is exported but no reference names it; document it in references/"],
    checked: 3,
  });
});

it("prefixes a package's paths with its folder and asks for the references export", () => {
  const pkg = { name: "@ws/a", exports: { ".": "./a.ts", "./x": "./x.ts" } };
  expect(exportFindings("packages/a", pkg, "'@ws/a' and `@ws/a/x`")).toEqual({
    findings: [`packages/a/package.json has no "./references/*" export; add "./references/*": "./references/*"`],
    checked: 2,
  });
  expect(exportFindings("packages/a", pkg, "").findings[0]).toBe(
    "@ws/a is exported but no reference names it; document it in packages/a/references/",
  );
});

it("reads a string, a list or a bare condition map as the . export, and none as nothing", () => {
  expect(specifiersOf("p", "./index.js").map((one) => one.shown)).toEqual(["p"]);
  expect(specifiersOf("p", { types: "./a.d.ts", default: "./a.js" }).map((one) => one.shown)).toEqual(["p"]);
  expect(specifiersOf("p", ["./a.js"]).map((one) => one.shown)).toEqual(["p"]);
  expect(specifiersOf("p", undefined)).toEqual([]);
});

it("asks a nameless manifest without exports for the references export", () => {
  expect(exportFindings("", {}, "").findings).toEqual([
    `package.json has no "./references/*" export; add "./references/*": "./references/*"`,
  ]);
});

it("calls a manifest public only with private: false", () => {
  expect(isPublic({ private: false })).toBe(true);
  expect(isPublic({ private: true })).toBe(false);
  expect(isPublic({})).toBe(false);
});
