import path from "node:path";

import { expect, it } from "vitest";

import { ctx, doc } from "./__fixtures__/docs-example-root.ts";
import { exampleTools, fence, tempRoot } from "./__fixtures__/docs-fixture.ts";
import { checkExamples } from "./docs-examples.ts";

function failing(result: { code: number; stdout?: string; stderr?: string }) {
  return exampleTools((call) => (call.tool === "bun" ? result : {}));
}

it("runs only the run blocks, and names the thrown error with the exit code", () => {
  const stderr = "1 | throw new Error('boom')\n\nError: boom\n    at x.ts:1";
  const fake = failing({ code: 1, stderr });
  const blocks = doc(fence("ts", "const a = 1;"), "", fence("ts run", "throw new Error('boom');"));
  expect(checkExamples(ctx(tempRoot()), blocks, fake.tools)).toStrictEqual([
    "references/auth.md:6: example 2 fails to run (exit 1): Error: boom",
  ]);
  expect(fake.calls.filter((call) => call.tool === "bun")).toHaveLength(1);
});

it("falls back to the last output line when nothing looks like an error", () => {
  const fake = failing({ code: 3, stdout: "a\nb\n" });
  expect(checkExamples(ctx(tempRoot()), doc(fence("ts run", "process.exit(3);")), fake.tools)).toStrictEqual([
    "references/auth.md:2: example 1 fails to run (exit 3): b",
  ]);
});

it("falls back to a note when the run printed nothing", () => {
  const fake = failing({ code: 3 });
  expect(checkExamples(ctx(tempRoot()), doc(fence("ts run", "process.exit(3);")), fake.tools)).toStrictEqual([
    "references/auth.md:2: example 1 fails to run (exit 3): no output",
  ]);
});

it("builds the doc root first when an example imports its own name and it has a build script", () => {
  const fake = exampleTools();
  const root = tempRoot();
  const blocks = doc(fence("ts", 'import "@ws/a/vitest";'));
  expect(checkExamples(ctx(root, { build: true }), blocks, fake.tools)).toStrictEqual([]);
  expect(fake.calls.map((call) => [call.tool, call.args[0], call.cwd])).toStrictEqual([
    ["bun", "run", root],
    ["tsc", "--pretty", path.join(root, ".repo/scratch/docs")],
  ]);
});

it("does not build when no example imports the name or there is no build script", () => {
  const fake = exampleTools();
  checkExamples(ctx(tempRoot(), { build: true }), doc(fence("ts", "const a = 1;")), fake.tools);
  checkExamples(ctx(tempRoot()), doc(fence("ts", 'import "@ws/a";')), fake.tools);
  expect(fake.calls.map((call) => call.tool)).toStrictEqual(["tsc", "tsc"]);
});

it("stops at a failed build and says why", () => {
  const fake = exampleTools(() => ({ code: 1, stderr: "error: no bundle" }));
  const blocks = doc(fence("ts", 'import "@ws/a";'));
  expect(checkExamples(ctx(tempRoot(), { build: true, dir: "packages/a" }), blocks, fake.tools)).toStrictEqual([
    "bun run build failed in packages/a (exit 1), so its examples were not checked: error: no bundle",
  ]);
  expect(fake.calls).toHaveLength(1);
});
