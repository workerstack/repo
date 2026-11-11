import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { rejectionProblems, rejections } from "./check-rejections.ts";

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Each program parses the default lib, over a second on a fast machine. */
const SLOW = 60_000;

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A temp root holding `files`, a value that is not a string written as JSON. */
function plant(files: Record<string, string | object>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "check-rejections-")));
  temps.push(root);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}

/** A package at `dir`: a `tsconfig.json` on this checkout's base that excludes reject files, and its strict sibling. */
function pkg(dir: string, compilerOptions: object = {}): Record<string, object> {
  const exclude = ["**/*.reject.ts", "**/*.reject.tsx"];
  return {
    [path.posix.join(dir, "tsconfig.json")]: {
      extends: path.join(pkgRoot, "tsconfig", "base.json"),
      compilerOptions,
      include: ["src"],
      exclude,
    },
    [path.posix.join(dir, "tsconfig.src.json")]: {
      extends: ["./tsconfig.json", path.join(pkgRoot, "tsconfig", "strict.json")],
      exclude,
    },
  };
}

/** The problems of every planted file. */
function problemsOf(files: Record<string, string | object>): string[] {
  return rejectionProblems(plant(files), Object.keys(files));
}

it("applies each mark from the next code line to the end of its block", () => {
  const source = [
    "// rejects: first",
    "",
    "// a note",
    "const a = (",
    "\t1",
    ")",
    "",
    "const b = 2",
    "// rejects: second",
    "const c = 3",
  ].join("\n");
  expect(rejections(source)).toStrictEqual([
    { end: 6, line: 4, text: "first" },
    { end: 10, line: 10, text: "second" },
  ]);
});

it("reads a mark written as a block comment and skips block prose", () => {
  const source = [
    "/* A rejection file: prose first,",
    "   over two lines. */",
    "",
    "/* rejects: first */",
    'export const a: number = "x"',
    "",
    "/* a note, not a mark */",
    "/* rejects: second */",
    "export const b = { }.nope",
  ].join("\n");
  expect(rejections(source)).toStrictEqual([
    { end: 5, line: 5, text: "first" },
    { end: 9, line: 9, text: "second" },
  ]);
});

const WIDE_USER = "export type UserId = string;\nexport function load(id: UserId): UserId {\n  return id;\n}\n";
const USER_REJECT = [
  "// src/user.reject.ts — excluded from tsconfig.json and tsconfig.src.json",
  'import { load } from "./user.ts";',
  "/* rejects: Argument of type 'string' is not assignable to parameter of type 'UserId' */",
  'load("u1");',
  "",
  'lod("u2");',
  "",
  '/* rejects: import("/home/me/app/src/user") */',
  "load(1);",
  "",
].join("\n");

it("prints each Usage problem on its statement's line", { timeout: SLOW }, () => {
  expect(problemsOf({ ...pkg("."), "src/user.ts": WIDE_USER, "src/user.reject.ts": USER_REJECT })).toStrictEqual([
    "src/user.reject.ts: line 4 compiles; it must reject: Argument of type 'string' is not assignable to parameter of type 'UserId'",
    "src/user.reject.ts: line 6 fails unmarked: TS2552: Cannot find name 'lod'. Did you mean 'load'?",
    "src/user.reject.ts: line 9's mark quotes an absolute import path, which differs per checkout: mark the text before it",
  ]);
});

it("passes a file that rejects exactly what it marks, under the owner's strict options", { timeout: SLOW }, () => {
  const branded = WIDE_USER.replace("= string;", '= string & { readonly brand: "UserId" };');
  const source = [
    'import { load } from "./user.ts";',
    "/* rejects: Argument of type 'string' is not assignable to parameter of type 'UserId' */",
    'load("u1");',
    "",
    "export type Opt = { a?: number };",
    "/* rejects: with 'exactOptionalPropertyTypes: true' */",
    "export const opt: Opt = { a: undefined };",
    "",
    "/* rejects: Type 'unknown' is not assignable to type 'number' */",
    'export const parsed: number = JSON.parse("1");',
    "",
  ].join("\n");
  expect(problemsOf({ ...pkg("."), "src/user.ts": branded, "src/user.reject.ts": source })).toStrictEqual([]);
});

it("names the errors of a marked line that fails without its text", { timeout: SLOW }, () => {
  const source = "/* rejects: Property 'nope' does not exist */\nexport const wrong: number = \"two\";\n";
  expect(problemsOf({ ...pkg("."), "src/a.reject.ts": source })).toStrictEqual([
    `src/a.reject.ts: line 2 fails without "Property 'nope' does not exist": TS2322: Type 'string' is not assignable to type 'number'.`,
  ]);
});

it("covers a statement the formatter wrapped through the line before the next blank line", { timeout: SLOW }, () => {
  const source = [
    "/* rejects: Type 'string' is not assignable to type 'number' */",
    "export const list: number[] = [",
    "  1,",
    '  "two",',
    "];",
    "",
    "export const after: number = 3;",
    "",
  ].join("\n");
  expect(problemsOf({ ...pkg("."), "src/a.reject.ts": source })).toStrictEqual([]);
});

it("reports a syntax error as such, never as a marked line that compiles", { timeout: SLOW }, () => {
  const source = "/* rejects: anything */\nexport const a: number = ;\n";
  expect(problemsOf({ ...pkg("."), "src/a.reject.ts": source })).toStrictEqual([
    "src/a.reject.ts: line 2 does not parse, so nothing in the file was type-checked: TS1109: Expression expected.",
  ]);
});

it("checks a .tsx reject file with its owner's jsx option and ambient types", { timeout: SLOW }, () => {
  const jsx =
    "declare namespace JSX {\n  interface Element {}\n  interface IntrinsicElements {\n    div: { id?: string };\n  }\n}\n";
  const source = [
    "/* rejects: Type 'number' is not assignable to type 'string' */",
    "export const el: JSX.Element = <div id={1} />;",
    "",
    "/* rejects: anything */",
    'export const ok: JSX.Element = <div id="a" />;',
    "",
  ].join("\n");
  const files = { ...pkg(".", { jsx: "preserve" }), "src/jsx.d.ts": jsx, "src/view.reject.tsx": source };
  expect(problemsOf(files)).toStrictEqual(["src/view.reject.tsx: line 5 compiles; it must reject: anything"]);
});

it("checks each package's reject files under that package's own options", { timeout: SLOW }, () => {
  const source = [
    "export type Opt = { a?: number };",
    "/* rejects: with 'exactOptionalPropertyTypes: true' */",
    "export const opt: Opt = { a: undefined };",
    "",
  ].join("\n");
  const loose = pkg("packages/loose");
  loose["packages/loose/tsconfig.src.json"] = { extends: "./tsconfig.json" };
  const files = {
    ...pkg("packages/strict"),
    ...loose,
    "packages/strict/src/a.reject.ts": source,
    "packages/loose/src/a.reject.ts": source,
  };
  expect(problemsOf(files)).toStrictEqual([
    "packages/loose/src/a.reject.ts: line 3 compiles; it must reject: with 'exactOptionalPropertyTypes: true'",
  ]);
});

it(
  "falls back to tsconfig.json without a strict sibling, and to strict defaults with no tsconfig",
  { timeout: SLOW },
  () => {
    const source = [
      "export type Opt = { a?: number };",
      "/* rejects: with 'exactOptionalPropertyTypes: true' */",
      "export const opt: Opt = { a: undefined };",
      "",
    ].join("\n");
    const runtime = pkg("packages/runtime");
    delete runtime["packages/runtime/tsconfig.src.json"];
    const bare = "/* rejects: Type 'string' is not assignable to type 'number' */\nexport const n: number = 'x';\n";
    expect(
      problemsOf({ ...runtime, "packages/runtime/src/a.reject.ts": source, "scratch/a.reject.ts": bare }),
    ).toStrictEqual([
      "packages/runtime/src/a.reject.ts: line 3 compiles; it must reject: with 'exactOptionalPropertyTypes: true'",
    ]);
  },
);

it("skips a listed reject file that no longer exists", { timeout: SLOW }, () => {
  expect(rejectionProblems(plant(pkg(".")), ["src/gone.reject.ts"])).toStrictEqual([]);
});

it("names a tsconfig.src.json it cannot read", () => {
  const files = { "tsconfig.json": "{}", "tsconfig.src.json": '{ "include": ["src"]\n', "src/a.reject.ts": "" };
  expect(problemsOf(files)).toStrictEqual(["tsconfig.src.json: '}' expected."]);
});

it("ignores files that are not reject files", () => {
  expect(problemsOf({ ...pkg("."), "src/a.ts": "export const a: number = 'x';\n" })).toStrictEqual([]);
});
