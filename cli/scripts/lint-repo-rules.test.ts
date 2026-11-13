import { expect, it } from "vitest";

import { useTempTree } from "../__fixtures__/temp-tree.ts";
import { captureTool } from "./lint.ts";

const SLOW = 60_000;
const tree = useTempTree("workerstack-repo-rules-");

/** A public lib package whose files each break one repo rule, with lint.boundaries tagging it below ui. */
const REPO_RULES = {
  ".oxlintrc.json": JSON.stringify({
    categories: { correctness: "off" },
    jsPlugins: [{ name: "repo", specifier: "@workerstack/repo/lint" }],
    plugins: [],
    rules: {
      "repo/boundaries": ["error", { allow: { lib: [], ui: ["lib"] }, tags: { "@app/lib": "lib", "@app/ui": "ui" } }],
      "repo/config-file": "error",
      "repo/max-line-width": "error",
      "repo/no-chained-type-assertions": "error",
      "repo/no-known-value-widening": "error",
      "repo/no-object-parameters": "error",
      "repo/no-reflect-apply": "error",
      "repo/no-reflect-get": "error",
      "repo/no-runtime-typeof": "error",
      "repo/no-shape-in-symbol-names": "error",
      "repo/no-unknown-parameters": "error",
      "repo/no-unknown-returns": "error",
      "repo/no-unknown-type-aliases": "error",
      "repo/no-unsafe-dictionary-type": "error",
      "repo/no-v8-ignore": "error",
      "repo/no-widen-then-assert": "error",
      "repo/public-jsdoc": "error",
      "repo/require-readable-spacing": "error",
    },
  }),
  "package.json": '{ "name": "app", "private": true, "type": "module" }\n',
  "packages/lib/package.json": JSON.stringify({
    dependencies: { "@app/ui": "*" },
    exports: { ".": "./src/index.ts" },
    name: "@app/lib",
  }),
  // oxlint's top scope is "global" where eslint's is "module": the shadowed Reflect proves scope reads still hold
  "packages/lib/src/flow.ts": [
    "const source = { id: 1 };",
    "const widened: unknown = source;",
    "export const parsed = widened as { readonly id: number };",
    "",
    "function invoke(Reflect: { apply(): number }) { return Reflect.apply(); }",
    "",
    "export const applied = Reflect.apply(invoke, undefined, [{ apply: () => 1 }]);",
    "",
    'export const read = Reflect.get(source, "id");',
    "",
    "export const chained = source as unknown as { readonly id: string };",
    "",
    "export function takes(value: object) { return value; }",
    "",
    "export function untyped(value) { return value; }",
    "",
    "export const shaped = 1;",
    "",
    "export const field = source.shape;",
    "",
    "shaped;",
    "",
    "export type Bag = Record<string, unknown>;",
    "",
    "export const bag: Bag = {};",
    "",
    "export type Mapped = { [K in string] };",
    "",
    "export type Index<T> = Record<string, T>;",
    "",
    "export type Bare = Index;",
    "",
    "export type Branded = Record<string, { brand? }>;",
    "",
    "export type Raw = unknown;",
    "",
    "export type Load = () => unknown;",
    "",
    "export type Wait = () => Promise;",
    "",
    "export interface Loader { load(); save(): Promise<string> }",
    "",
    "export function parse(value: unknown, cause: unknown) { return [value, cause]; }",
    "",
  ].join("\n"),
  "packages/lib/src/index.ts": [
    'import { b } from "@app/ui";',
    'import pad from "left-pad";',
    "",
    "/** A value wide enough to pass the print width. */",
    `export const wide = "${"x".repeat(98)}";`,
    "",
    "// v8 ignore next",
    "export const bare: unknown[] = [b, pad];",
    "",
    "/** The sizes a caller picks from. */",
    "export enum Size {",
    "  Small,",
    "}",
    "",
  ].join("\n"),
  // the one planted widening, then a class property, a return, an arrow and a call that each hold a null child
  "packages/lib/src/known.ts": [
    'const OS_NAMES: Record<string, string> = { linux: "Linux" };',
    "class Registry { field; }",
    "function guard(value) { return; }",
    "guard(() => OS_NAMES, Registry);\n",
  ].join("\n\n"),
  // a predicate's typeof passes; a function with no return type, null under oxlint, reports its bare typeof
  "packages/lib/src/probe.ts":
    'export function isText(value): value is string { return typeof value === "string"; }\n\n' +
    "export function kind(value) { return typeof value; }\n",
  // a statement straight after a binding, with no blank line between them
  "packages/lib/src/spacing.ts": "function first() {\n  const a = 1;\n  return a;\n}\n",
  // oxc refuses an index signature without a type before any JS plugin sees it, so it holds no null to crash on
  "packages/lib/src/untyped.ts": "export type Untyped = { [key: string] };\n",
  "packages/lib/vite.config.ts": "const plugins = [];\n\nexport default { plugins };\n",
  "packages/ui/package.json": JSON.stringify({ name: "@app/ui" }),
};

const FLOW = "packages/lib/src/flow.ts";

/** What no-known-value-widening reports for a known value written into the `target` type on `subject`. */
function widening(target: string, subject: string): string {
  return (
    `repo(no-known-value-widening) The explicit ${target} type on ${subject} discards known type evidence. ` +
    "Keep inference, validate with `satisfies`, or use a named owner contract."
  );
}

/** What no-shape-in-symbol-names reports for `shaped`, its declaration and its top-level use; `.shape` passes. */
const NAME_FINDING =
  'repo(no-shape-in-symbol-names) Rename symbol "shaped" for its domain role; "shape" describes structure rather ' +
  "than ownership.";

/**
 * What the widen, Reflect, assertion, parameter, symbol-name, dictionary and unknown rules report in flow.ts. Only
 * `Bag` is an unsafe dictionary: the planted plain alias use, mapped type, property and alias use missing a type, an
 * argument or a default hold null children under oxlint, which the dictionary rule reads without a plugin error. Only
 * `Raw` hides unknown and only `Load` returns it: `untyped`, `load()` and a bare `Promise` hold a null return type
 * or type arguments, which the unknown-returns rule reads without a plugin error. Only `parse`'s `value` takes
 * unknown: `untyped` holds a null annotation and `parse` a null return type, which the unknown-parameters rule reads
 * without a plugin error, and `cause` is its carve-out. The known-value rule reports `widened` and the two assertions
 * that write `source` into an anonymous object type.
 */
const FLOW_FINDINGS = [
  `${FLOW}:11 repo(no-chained-type-assertions) This assertion chain discards type evidence. ` +
    "Keep the original precise type, or parse untrusted input at its boundary before narrowing it.",
  `${FLOW}:11 ${widening("anonymous object", "assertion")}`,
  `${FLOW}:13 repo(no-object-parameters) Parameter \`value\` uses the broad \`object\` type. Accept a named owner ` +
    "type; parse external input at its boundary before calling this function.",
  `${FLOW}:17 ${NAME_FINDING}`,
  `${FLOW}:2 ${widening("unknown", "binding `widened`")}`,
  `${FLOW}:21 ${NAME_FINDING}`,
  `${FLOW}:23 repo(no-unsafe-dictionary-type) This dictionary's unknown value type gives callers no concrete value ` +
    "contract. Use an owner/schema-derived value type; parse external payloads before insertion.",
  `${FLOW}:3 ${widening("anonymous object", "assertion")}`,
  `${FLOW}:3 repo(no-widen-then-assert) Binding "widened" discards type evidence and later recreates it with an ` +
    "assertion. Keep the precise type from initialization through use; parse boundary input once.",
  `${FLOW}:35 repo(no-unknown-type-aliases) Type alias \`Raw\` hides \`unknown\`. Keep \`unknown\` explicit at the ` +
    "parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.",
  `${FLOW}:37 repo(no-unknown-returns) This function exposes \`unknown\` to its caller. Parse the value at its ` +
    "boundary and return a named domain type.",
  `${FLOW}:43 repo(no-unknown-parameters) Parameter \`value\` leaves input unparsed. Accept a named domain type; ` +
    "run the expected schema or parser at the I/O boundary before calling this function.",
  `${FLOW}:7 repo(no-reflect-apply) Replace \`Reflect.apply\` with a typed function call. Model dynamic dispatch ` +
    "behind a named interface.",
  `${FLOW}:9 repo(no-reflect-get) Replace \`Reflect.get\` with typed property access. Parse dynamic input into ` +
    "a named domain type before reading it.",
];

it("oxlint runs the repo plugin's rules with their options, from the linted repo's cwd", { timeout: SLOW }, () => {
  const linted = captureTool("oxlint", ["-f", "json"], tree(REPO_RULES));

  const report = JSON.parse(linted.stdout) /* oxlint -f json prints one report object */ as {
    diagnostics: { filename: string; code: string; message: string; labels: { span: { line: number } }[] }[];
  };

  const findings = report.diagnostics.map(
    ({ filename, code, message, labels }) => `${filename}:${labels[0]?.span.line} ${code} ${message}`,
  );

  const index = "packages/lib/src/index.ts";
  const missing = "has no JSDoc: add a /** */ block that says what a caller needs and the type does not";
  expect(findings.toSorted()).toStrictEqual([
    ...FLOW_FINDINGS,
    `${index}:1 repo(boundaries) "@app/ui" is a ui package, and a lib package may import only lib; move what it ` +
      'needs into a package lib may import, or add "ui" to lint.boundaries.allow.lib in repo.config.ts',
    `${index}:12 repo(public-jsdoc) \`Size.Small\` is public through "." and ${missing}`,
    `${index}:2 repo(boundaries) "left-pad" is not declared in packages/lib/package.json; add it to its dependencies`,
    `${index}:5 repo(max-line-width) this line is 121 columns, over 120; split the string with + or a join`,
    `${index}:7 repo(no-v8-ignore) coverage ignore comments hide untested code; delete the code or add a test ` +
      "that runs it",
    `${index}:8 repo(public-jsdoc) \`bare\` is public through "." and ${missing}`,
    `packages/lib/src/known.ts:1 ${widening("open dictionary", "binding `OS_NAMES`")}`,
    "packages/lib/src/probe.ts:3 repo(no-runtime-typeof) A `typeof` check narrows a representation without " +
      "establishing its contract. Parse input at its I/O boundary, then branch on the domain value.",
    "packages/lib/src/spacing.ts:3 repo(require-readable-spacing) Expected blank line before this statement.",
    "packages/lib/src/untyped.ts:1 TS(1021) An index signature must have a type annotation.",
    'packages/lib/vite.config.ts:1 repo(config-file) a config file holds only imports and exports; move "plugins" ' +
      "into a module it imports",
  ]);
  expect(linted.code).toBe(1);
});
