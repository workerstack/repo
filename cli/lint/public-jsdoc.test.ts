import { expect, it } from "vitest";
import { reportsOf } from "../../dev/rule-harness.ts";
import { publicJsdoc } from "./public-jsdoc.ts";

const ASK = "say what a caller needs and the type does not";
const MISSING = `has no JSDoc: add a /** */ block that says what a caller needs and the type does not`;

/** What the rule reports over a package whose "." entry is `src/index.ts` holding `code`, beside `extra` files. */
function messagesOf(code: string, extra: Record<string, string> = {}, manifest: object = {}): string[] {
  const files = {
    "package.json": JSON.stringify({ name: "p", exports: { ".": "./src/index.ts" }, ...manifest }),
    "src/index.ts": code,
    ...extra,
  };
  return reportsOf(publicJsdoc, files).map((report) => report.message);
}
const about = (label: string, text: string, entry = ".") => `\`${label}\` is public through "${entry}" and ${text}`;

type Fault = { name: string; code: string; message: string };
const FAULTS: Fault[] = [
  {
    name: "a name with no words in its doc",
    code: "/** ... */\nexport const dots: string = '';",
    message: about("dots", `its JSDoc only restates the name: ${ASK}`),
  },
  { name: "missing", code: "export const PACKS: string[] = [];", message: about("PACKS", MISSING) },
  { name: "empty", code: "/** */\nexport const A: string = '';", message: about("A", `its JSDoc is empty: ${ASK}`) },
  {
    name: "restating the name",
    code: "/** The pack. */\nexport type Pack = string;",
    message: about("Pack", `its JSDoc only restates the name: ${ASK}`),
  },
  {
    name: "restating a camel-case name",
    code: "/** Pack options. */\nexport type PackOptions = string;",
    message: about("PackOptions", `its JSDoc only restates the name: ${ASK}`),
  },
  {
    name: "inferred const",
    code: "/** Counts what callers hold. */\nexport const total = compute();\ndeclare function compute(): number;",
    message: about("total", "its type is inferred, so its shape goes unchecked: write the type out"),
  },
  {
    name: "inferred function",
    code: "/** Runs every job in order. */\nexport function run() { return 1; }",
    message: about("run", "its type is inferred, so its shape goes unchecked: write the type out"),
  },
  {
    name: "same line as code",
    code: "const x = 1; /** Holds a count. */ export const y: number = x;",
    message: about(
      "y",
      "its JSDoc shares a line with the code before it, so editors do not show it: put it on its own line",
    ),
  },
];

it.each(FAULTS)("reports $name with its text", ({ code, message }) => {
  expect(messagesOf(code)).toStrictEqual([message]);
});

const REFERENCES = ["plan 60", "slice 4", "roadmap 12", "D7"];

it.each(REFERENCES)("reports a doc that cites %s", (reference) => {
  const code = `/** Runs the jobs, see ${reference}. */\nexport const jobs: number = 1;`;
  const tail = "which ships to consumers: say it in their terms";
  expect(messagesOf(code)).toStrictEqual([
    about("jobs", `its JSDoc cites an internal reference (${reference}), ${tail}`),
  ]);
});

const UNKNOWN = [
  { code: "const a = 1;\nexport = a;", form: "`export =`" },
  { code: "export namespace N { export const a = 1; }", form: "a namespace" },
  { code: '/** Names the module in full. */\nexport import a = require("./b.ts");', form: "an `import x = require()`" },
  { code: "const o = { a: 1 };\nexport const { a } = o;", form: "a destructured export" },
  { code: 'export * from "./missing.ts";', form: "`./missing.ts`" },
];

it.each(UNKNOWN)("fails closed on $form", ({ code, form }) => {
  const message = `cannot follow ${form} here, so what it exposes goes unchecked: write it as a plain export`;
  expect(messagesOf(code)).toStrictEqual([message]);
});

it("passes a documented export, and docs with tags", () => {
  const code = [
    "/** Lists the packs a repo turns on, in sync order. */",
    "export const PACKS: string[] = [];",
    "/**",
    " * Runs every job in order.",
    " * @param jobs the names to run",
    " */",
    "export function run(jobs: string[]): void {}",
    "/** The result of a run, with what failed. */",
    "export interface Result {\n/** Names of the jobs that failed. */\nfailed: string[] }",
  ].join("\n");
  expect(messagesOf(code)).toStrictEqual([]);
});

it("ignores an export no entry reaches, a body-only helper and a private package", () => {
  const extra = { "src/other.ts": "export const loose = 1;\nexport function inferred() { return 1; }" };
  expect(messagesOf("/** Holds a documented count. */\nexport const a: number = 1;", extra)).toStrictEqual([]);
  expect(messagesOf("export const a = 1;", {}, { private: true })).toStrictEqual([]);
});

it("ignores a file outside any package and one whose package has no exports", () => {
  expect(reportsOf(publicJsdoc, { "src/a.ts": "export const a = 1;" })).toStrictEqual([]);
  expect(messagesOf("export const a = 1;", {}, { exports: undefined })).toStrictEqual([]);
});

it("passes over an export list and reports an unknown form once, in the file that has it", () => {
  const extra = {
    "src/deep.ts": "/** Holds the other jobs count. */\nexport const other: number = 1;",
    "src/bad.ts": "const a = 1;\nexport = a;",
  };
  const own = "/** Holds the count of jobs. */\nexport const count: number = 1;\n";
  const code = `${own}export { other } from "./deep.ts";\nexport * from "./bad.ts";`;
  const message = "cannot follow `export =` here, so what it exposes goes unchecked: write it as a plain export";
  expect(messagesOf(code, extra)).toStrictEqual([message]);
});

it("reports the entry of a declaration reached through a re-export", () => {
  const extra = { "src/deep.ts": "export const deep: number = 1;" };
  const code = 'export { deep } from "./deep.ts";';
  expect(messagesOf(code, extra)).toStrictEqual([about("deep", MISSING)]);
});

it("accepts a literal, a cast, a satisfies and a typed function as a stated type", () => {
  const doc = "/** Holds a value callers read. */\n";
  const code = [
    `${doc}export const a = 1;`,
    `${doc}export const b = -1 + 2;`,
    `${doc}export const c = \`x\`;`,
    `${doc}export const d = (1) as number;`,
    `${doc}export const e = 1 satisfies number;`,
    `${doc}export const h = (1);`,
    `${doc}export const f = (): number => 1;`,
    `${doc}export const g = function (): number { return 1; };`,
  ].join("\n");
  expect(messagesOf(code)).toStrictEqual([]);
});

it("reports an inferred const whose initializer is not a stated type", () => {
  const doc = "/** Holds a value callers read. */\n";
  const code = [
    `${doc}export const a = \`x\${1}\`;`,
    `${doc}export const b = (c) => c;`,
    `${doc}export const d = 1 + e;`,
  ];
  const messages = messagesOf(code.join("\ndeclare const e: number;\n"));
  expect(messages.length).toBe(3);
});
