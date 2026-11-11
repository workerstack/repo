/** The walk ends on a cycle and fails closed on every form it cannot follow, rather than passing it in silence. */
import { afterEach, expect, it } from "vitest";

import { removePlanted } from "../fixtures/planted-repo.ts";
import { namesIn, unknownIn, withEntries } from "../fixtures/surface-package.ts";

afterEach(removePlanted);

const ENTRY = { ".": "./src/index.ts" };

it("ends on a cycle of types", () => {
  const root = withEntries(
    { ".": "./src/a.ts" },
    {
      "src/a.ts": 'import type { B } from "./b.ts";\nexport type A = { b: B };\n',
      "src/b.ts": 'import type { A } from "./a.ts";\nexport type B = { a: A };\n',
    },
  );
  expect(namesIn(root)).toStrictEqual({ "src/a.ts": ["A"], "src/b.ts": ["B"] });
});

it("ends on a cycle of star re-exports and of namespace re-exports", () => {
  const root = withEntries(
    { ".": "./src/a.ts" },
    {
      "src/a.ts": 'export * from "./b.ts";\nexport const fromA = 1;\n',
      "src/b.ts": 'export * from "./a.ts";\nexport * as self from "./b.ts";\nexport const fromB = 1;\n',
    },
  );
  expect(namesIn(root)).toStrictEqual({ "src/a.ts": ["fromA"], "src/b.ts": ["fromB"] });
});

it("ends on a re-export that names itself", () => {
  const root = withEntries({ ".": "./src/a.ts" }, { "src/a.ts": 'export { x } from "./a.ts";\n' });
  expect(unknownIn(root)).toStrictEqual([{ file: "src/a.ts", form: "x", line: 1 }]);
});

type Closed = { name: string; code: string; form: string; line: number };

const CLOSED: Closed[] = [
  { code: "const a = 1;\nexport = a;\n", form: "TSExportAssignment", line: 2, name: "export =" },
  { code: "export namespace N { export const a = 1; }\n", form: "TSModuleDeclaration", line: 1, name: "a namespace" },
  {
    code: 'export import a = require("./other.ts");\n',
    form: "TSImportEqualsDeclaration",
    line: 1,
    name: "an import-equals",
  },
  {
    code: "const o = { a: 1 };\nexport const { a } = o;\n",
    form: "ObjectPattern",
    line: 2,
    name: "a destructured export",
  },
  { code: "\nexport default 1 + 1;\n", form: "BinaryExpression", line: 2, name: "an export of an expression" },
  {
    code: 'export { gone } from "./other.ts";\n',
    form: "gone",
    line: 1,
    name: "a re-export of a name nobody declares",
  },
  { code: 'export { a } from "./missing.ts";\n', form: "./missing.ts", line: 1, name: "a re-export of a missing file" },
  {
    code: 'export * as ns from "./missing.ts";\n',
    form: "./missing.ts",
    line: 1,
    name: "a namespace re-export of a missing file",
  },
  {
    code: 'export * from "./missing.ts";\n',
    form: "./missing.ts",
    line: 1,
    name: "a star re-export of a missing file",
  },
  { code: "export { nothing };\n", form: "nothing", line: 1, name: "an export of a name nothing declares" },
  {
    code: 'export { default } from "./other.ts";\n',
    form: "default",
    line: 1,
    name: "a default that nothing declares",
  },
  { code: 'export { gone } from "./wide.ts";\n', form: "gone", line: 1, name: "a name behind a star of a package" },
  { code: 'export * from "./star.ts";\n', form: "ghost", line: 1, name: "a star that leads to a missing name" },
];

it.each(CLOSED)("fails closed on $name at an entry", ({ code, form, line }) => {
  const root = withEntries(ENTRY, {
    "src/index.ts": code,
    "src/other.ts": "export {};\n",
    "src/star.ts": 'export { ghost } from "./other.ts";\n',
    "src/wide.ts": 'export * from "zod";\n',
  });
  expect(unknownIn(root)).toStrictEqual([{ file: "src/index.ts", form, line }]);
});

it("reports a form once however many entries and stars reach its file", () => {
  const root = withEntries(
    { ".": "./src/index.ts", "./bad": "./src/bad.ts" },
    {
      "src/bad.ts": "const a = 1;\nexport = a;\n",
      "src/index.ts": 'export * from "./bad.ts";\nexport * from "./bad.ts";\n',
    },
  );
  expect(unknownIn(root)).toStrictEqual([{ file: "src/bad.ts", form: "TSExportAssignment", line: 2 }]);
});

it("fails closed on an entry that names no file or a directory", () => {
  const root = withEntries({ ".": "./src/gone.ts", "./dir": "./src/dir.ts" }, { "src/dir.ts/keep": "" });
  expect(unknownIn(root)).toStrictEqual([
    { file: "src/gone.ts", form: "src/gone.ts", line: 1 },
    { file: "src/dir.ts", form: "src/dir.ts", line: 1 },
  ]);
});
