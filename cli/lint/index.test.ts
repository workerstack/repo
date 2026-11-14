import { spawnSync } from "node:child_process";
import path from "node:path";

import { expect, it } from "vitest";
import { z } from "zod";

import plugin from "./index.ts";

/** The rule names, sorted. */
const RULE_NAMES = [
  "as-needs-reason",
  "boundaries",
  "class-file",
  "config-file",
  "deprecated-replacement",
  "entry-file",
  "env-in-config",
  "filename-matches-export",
  "index-file",
  "max-line-width",
  "member-ordering",
  "naming-convention",
  "native-path-separator",
  "no-block-comment",
  "no-boolean-param",
  "no-chained-type-assertions",
  "no-commented-out-code",
  "no-known-value-widening",
  "no-module-mocking",
  "no-module-side-effects",
  "no-module-state",
  "no-object-parameters",
  "no-reflect-apply",
  "no-reflect-get",
  "no-runtime-typeof",
  "no-shape-in-symbol-names",
  "no-side-effect-import",
  "no-unknown-parameters",
  "no-unknown-returns",
  "no-unknown-type-aliases",
  "no-unsafe-dictionary-type",
  "no-v8-ignore",
  "no-widen-then-assert",
  "public-jsdoc",
  "require-readable-spacing",
  "skip-on-platform",
  "todo-needs-id",
  "types-file",
];

it("is the plugin `repo` with the thirty-five rules the generated config turns on", () => {
  expect(plugin.meta.name).toBe("repo");
  expect(Object.keys(plugin.rules).toSorted()).toStrictEqual(RULE_NAMES);
});

/** Every module a fresh bun loads with the plugin, as absolute paths. */
function loadedWithPlugin(): string[] {
  const entry = path.join(import.meta.dirname, "index.ts");
  const script = `await import(${JSON.stringify(entry)}); console.log(JSON.stringify(Object.keys(require.cache)));`;
  const run = spawnSync("bun", ["-e", script], { encoding: "utf8" });

  return z.array(z.string()).parse(JSON.parse(run.stdout));
}

it("loads no eslint module, so a lint run does not pay for eslint", () => {
  const loaded = loadedWithPlugin();
  expect(loaded).toContain(path.join(import.meta.dirname, "index.ts"));
  expect(loaded.filter((file) => /[\\/](eslint|@eslint-community)[\\/]/.test(file))).toStrictEqual([]);
});
