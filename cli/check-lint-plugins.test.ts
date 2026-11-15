import { expect, it } from "vitest";

import { useTempTree } from "./__fixtures__/temp-tree.ts";
import { checkLintPlugins } from "./check-lint-plugins.ts";
import type { ResolvedLint } from "./config-resolved.types.ts";

const tree = useTempTree("repo-lint-plugins-");

const GOOD = `export default { meta: { name: "app" }, rules: { "no-x": { create() { return {}; } }, "max-y": {} } };\n`;

function lintOf(plugins: Record<string, string>, ...rules: string[][]): ResolvedLint {
  return {
    plugins,
    rules: rules.map((names) => ({ rules: Object.fromEntries(names.map((n) => [n, "error"])) })),
    skip: [],
  };
}

it("passes a plugin whose rules the config names", async () => {
  const root = tree({ "lint/app.js": GOOD });
  expect(await checkLintPlugins(root, lintOf({ app: "lint/app.js" }, ["app/no-x", "app/max-y"]))).toStrictEqual([]);
});

it("takes the registered key over the plugin's own meta.name", async () => {
  const other = `export default { meta: { name: "other" }, rules: { "no-x": {} } };\n`;
  const root = tree({ "lint/app.js": other });
  expect(await checkLintPlugins(root, lintOf({ app: "lint/app.js" }, ["app/no-x"]))).toStrictEqual([]);
});

it("refuses a path that is missing or a directory", async () => {
  const root = tree({ "lint/app.js/inner.js": GOOD });
  const lint = lintOf({ app: "lint/app.js", gone: "lint/gone.js" });
  expect(await checkLintPlugins(root, lint)).toStrictEqual([
    "lint.plugins.app: lint/app.js is no file",
    "lint.plugins.gone: lint/gone.js is no file",
  ]);
});

it("refuses a file that fails to import, with the first line of the error", async () => {
  const root = tree({ "lint/app.js": `throw new Error("boom\\nsecond line");\n`, "lint/odd.js": `throw 5;\n` });
  const lint = lintOf({ app: "lint/app.js", odd: "lint/odd.js" }, ["app/no-x", "odd/y"]);
  expect(await checkLintPlugins(root, lint)).toStrictEqual([
    "lint.plugins.app: lint/app.js failed to import: boom",
    "lint.plugins.odd: lint/odd.js failed to import: 5",
  ]);
});

it.each([
  ["no default", `export const x = 1;\n`],
  ["a default that is not an object", `export default 3;\n`],
  ["a default with no rules", `export default { meta: { name: "app" } };\n`],
  ["rules that are a list", `export default { rules: [] };\n`],
  ["rules that are null", `export default { rules: null };\n`],
  ["a null default", `export default null;\n`],
])("refuses %s, with no rule errors after it", async (_name, text) => {
  const root = tree({ "lint/app.js": text });
  expect(await checkLintPlugins(root, lintOf({ app: "lint/app.js" }, ["app/nope"]))).toStrictEqual([
    "lint.plugins.app: lint/app.js does not default-export a plugin like { meta: { name }, rules: {} }",
  ]);
});

it("refuses a rule the plugin does not export, listing the ones it has in its order", async () => {
  const root = tree({ "lint/app.js": GOOD });
  const lint = lintOf({ app: "lint/app.js" }, ["app/no-x"], ["app/max-y", "app/nope", "other/z", "bare"]);
  expect(await checkLintPlugins(root, lint)).toStrictEqual([
    'lint.rules[1].rules: "app/nope" is not a rule of lint/app.js; it has no-x, max-y',
  ]);
});

it("says a plugin with no rules has no rules", async () => {
  const root = tree({ "lint/app.js": `export default { rules: {} };\n` });
  expect(await checkLintPlugins(root, lintOf({ app: "lint/app.js" }, ["app/nope"]))).toStrictEqual([
    'lint.rules[0].rules: "app/nope" is not a rule of lint/app.js; it has no rules',
  ]);
});
