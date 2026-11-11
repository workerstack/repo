import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { blocksOf, checkExamples, importsName, type ExampleRoot } from "./docs-examples.ts";
import { exampleTools, fence, tempRoot } from "./fixtures/docs-fixture.ts";

const ctx = (root: string, extra: Partial<ExampleRoot> = {}): ExampleRoot => ({
  root,
  dir: "",
  name: "@ws/a",
  build: false,
  ...extra,
});
const doc = (...fences: string[]) => blocksOf("", "references/auth.md", ["# Auth", ...fences].join("\n"));
const read = (file: string) => fs.readFileSync(file, "utf8");

it("takes ts, typescript and tsx fences, numbered per file, and ignores the rest", () => {
  const text = [
    "# Doc",
    fence("ts", "const a = 1;"),
    fence("json", "{}"),
    fence("typescript run", "throw 1;"),
    fence("tsx", "export const x = <b />;"),
    fence("", "plain"),
  ].join("\n");
  const blocks = blocksOf("packages/a", "references/doc.md", text);
  expect(blocks.map(({ md, line, n, ext, run }) => ({ md, line, n, ext, run }))).toStrictEqual([
    { md: "packages/a/references/doc.md", line: 2, n: 1, ext: "ts", run: false },
    { md: "packages/a/references/doc.md", line: 8, n: 2, ext: "ts", run: true },
    { md: "packages/a/references/doc.md", line: 11, n: 3, ext: "tsx", run: false },
  ]);
  expect(blocks.map((block) => block.code)).toStrictEqual(["const a = 1;", "throw 1;", "export const x = <b />;"]);
});

it("finds the package name a block imports, quoted, with or without a subpath", () => {
  const blocks = blocksOf("", "r.md", fence("ts", 'import { x } from "@ws/a/lint";'));
  expect(importsName(blocks, "@ws/a")).toBe(true);
  expect(importsName(blocks, "@ws/b")).toBe(false);
  expect(importsName(blocks, "@ws/a/li")).toBe(false);
});

it("does nothing without examples", () => {
  const fake = exampleTools();
  expect(checkExamples(ctx(tempRoot()), [], fake.tools)).toStrictEqual([]);
  expect(fake.calls).toStrictEqual([]);
});

it("writes each block with an export and a tsconfig that extends the stock bun one", () => {
  const root = tempRoot();
  const fake = exampleTools();
  const blocks = doc(fence("ts", "const a = 1;"), fence("tsx", "const b = <i />;"));
  expect(checkExamples(ctx(root), blocks, fake.tools)).toStrictEqual([]);
  const scratch = path.join(root, ".tmp/repo/docs");
  expect(read(path.join(scratch, "references/auth.md-1.ts"))).toBe("const a = 1;\nexport {};\n");
  expect(fs.existsSync(path.join(scratch, "references/auth.md-2.tsx"))).toBe(true);
  const config = read(path.join(scratch, "tsconfig.json"));
  expect(config).toMatch(/"extends": "[^"]*\/tsconfig\/bun\.json"/);
  expect(config).toContain('"noEmit": true');
  expect(config).toMatch(/"files": \[\s*"references\/auth\.md-1\.ts",\s*"references\/auth\.md-2\.tsx"\s*\]/);
  expect(fake.calls).toStrictEqual([
    { tool: "tsc", args: ["--pretty", "false", "-p", path.join(scratch, "tsconfig.json")], cwd: scratch },
  ]);
});

it("extends the doc root's own tsconfig and runs from the package folder", () => {
  const root = tempRoot({ "packages/a/tsconfig.json": "{}" });
  const fake = exampleTools();
  const blocks = blocksOf("packages/a", "references/x.md", fence("ts run", "const a = 1;"));
  expect(checkExamples(ctx(root, { dir: "packages/a" }), blocks, fake.tools)).toStrictEqual([]);
  const scratch = path.join(root, ".tmp/repo/docs/packages/a");
  const own = path.join(root, "packages/a/tsconfig.json").replaceAll("\\", "/");
  expect(read(path.join(scratch, "tsconfig.json"))).toContain(`"extends": ${JSON.stringify(own)}`);
  expect(fake.calls[1]).toStrictEqual({
    tool: "bun",
    args: [path.join(scratch, "references/x.md-1.ts")],
    cwd: path.join(root, "packages/a"),
  });
});

it("maps each tsc error, printed with backslashes, to its markdown line", () => {
  const fake = exampleTools(() => ({
    code: 2,
    stdout: [
      "references\\auth.md-2.ts(2,7): error TS2339: Property 'tokn' does not exist on type 'Session'.",
      "  The expected type comes from here.",
      "references/auth.md-1.ts(1,1): error TS1002: Unterminated string.",
    ].join("\r\n"),
  }));
  const blocks = doc(fence("ts", "const a = 1;"), "", fence("ts", "const s = 1;", "s.tokn;"));
  expect(checkExamples(ctx(tempRoot()), blocks, fake.tools)).toStrictEqual([
    "references/auth.md:8: example 2 fails to type-check: Property 'tokn' does not exist on type 'Session'.",
    "references/auth.md:3: example 1 fails to type-check: Unterminated string.",
  ]);
});

it("reports tsc output no block owns", () => {
  const blocks = doc(fence("ts", "const a = 1;"));
  const stderr = "error TS5083: Cannot read file 'x'.\nsrc/y.ts(1,1): error TS1: bad";
  const fake = exampleTools(() => ({ code: 1, stderr }));
  expect(checkExamples(ctx(tempRoot(), { dir: "packages/a" }), blocks, fake.tools)).toStrictEqual([
    "tsc failed in packages/a: error TS5083: Cannot read file 'x'.",
    "tsc failed in packages/a: src/y.ts(1,1): error TS1: bad",
  ]);
});

it("reports a tsc failure that printed nothing", () => {
  const fake = exampleTools(() => ({ code: 1 }));
  expect(checkExamples(ctx(tempRoot()), doc(fence("ts", "const a = 1;")), fake.tools)).toStrictEqual([
    "tsc failed in .: no output",
  ]);
});
