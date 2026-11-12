import type { TSESLint } from "@typescript-eslint/utils";
import { expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { boundaries } from "./boundaries.ts";

/** Packages that declare each other, so only the tags can refuse an import between them. */
const MANIFESTS: Record<string, string> = {
  "package.json": JSON.stringify({ name: "@app/root" }),
  "packages/core/package.json": JSON.stringify({ dependencies: { "@app/lib": "*" }, name: "@app/core" }),
  "packages/lib/package.json": JSON.stringify({
    dependencies: { "@app/core": "*", "@app/ui": "*", zod: "4" },
    name: "@app/lib",
  }),
  "packages/tools/package.json": JSON.stringify({ dependencies: { "@app/web": "*" }, name: "@app/tools" }),
  "packages/ui/package.json": JSON.stringify({ dependencies: { "@app/lib": "*", "@app/web": "*" }, name: "@app/ui" }),
  "packages/web/package.json": JSON.stringify({ dependencies: { "@app/lib": "*", "@app/ui": "*" }, name: "@app/web" }),
};

/** Usage's tags, with a second lib package for the same-tag case; `@app/tools` carries none. */
const TAGS = {
  allow: { app: ["ui", "lib"], lib: [], ui: ["lib"] },
  tags: { "@app/core": "lib", "@app/lib": "lib", "@app/ui": "ui", "@app/web": "app" },
};

const OPTIONS = [TAGS];
const LIB = "packages/lib/src/lib.ts";

const LIB_TO_UI =
  '"@app/ui" is a ui package, and a lib package may import only lib; move what it needs into a package lib may ' +
  'import, or add "ui" to lint.boundaries.allow.lib in workerstack.config.ts';

/** Options as a test passes them: any list, since a case may hand over options that are not tags. */
type Options = TSESLint.RuleContext<string, readonly unknown[]>["options"];

/** What the rule reports for `code` at `file`, under `options`. */
function messagesOf(file: string, code: string, options: Options = OPTIONS): string[] {
  return reportsOf(boundaries, { ...MANIFESTS, [file]: code }, options).map((report) => report.message);
}

it.each([
  'import { b } from "@app/ui";',
  'import type { B } from "@app/ui/sub";',
  'export const load = () => import("@app/ui");',
  'export * from "@app/ui";',
])("a lib package importing a ui one fails with the tags it may import: %j", (code) => {
  expect(messagesOf(LIB, code)).toStrictEqual([LIB_TO_UI]);
});

it('an app package importing a ui one names every tag it may import, after "an"', () => {
  const options = [{ ...OPTIONS[0], allow: { app: ["lib"], lib: [], ui: ["lib"] } }];
  expect(messagesOf("packages/web/src/a.ts", 'import { b } from "@app/ui";', options)).toStrictEqual([
    '"@app/ui" is a ui package, and an app package may import only app or lib; move what it needs into a package app ' +
      'may import, or add "ui" to lint.boundaries.allow.app in workerstack.config.ts',
  ]);
});

it.each([
  ["packages/ui/src/a.ts", 'import { l } from "@app/lib";'],
  ["packages/web/src/a.ts", 'import { u } from "@app/ui";\nimport type { L } from "@app/lib";'],
  [LIB, 'import { c } from "@app/core";'],
  ["packages/tools/src/a.ts", 'import { w } from "@app/web";'],
  [LIB, 'import { z } from "zod";'],
])("%s passes an import its tag allows, its own tag, or an untagged side: %j", (file, code) => {
  expect(messagesOf(file, code)).toStrictEqual([]);
});

it("without options the rule judges no tag", () => {
  expect(messagesOf(LIB, 'import { b } from "@app/ui";', [])).toStrictEqual([]);
});

it("a tag with no allow entry may import only its own tag", () => {
  expect(messagesOf(LIB, 'import { b } from "@app/ui";', [{ ...OPTIONS[0], allow: {} }])).toStrictEqual([LIB_TO_UI]);
});

it("a package with no name is not judged by tag", () => {
  const anon = {
    "packages/anon/a.ts": 'import { b } from "@app/ui";',
    "packages/anon/package.json": JSON.stringify({ dependencies: { "@app/ui": "*" } }),
  };

  expect(reportsOf(boundaries, { ...MANIFESTS, ...anon }, OPTIONS)).toStrictEqual([]);
});

it("options that are not tags and allow lists are refused before the rule runs", () => {
  const options = [{ allow: { lib: [1] }, tags: TAGS.tags }];
  expect(() => messagesOf(LIB, 'import { b } from "@app/ui";', options)).toThrow(/repo\/rule/);
});
