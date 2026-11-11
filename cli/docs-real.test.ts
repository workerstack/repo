import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { docsRun, fence, json, tempRoot } from "./__fixtures__/docs-fixture.ts";
import { docsIo, REAL_TOOLS } from "./docs-io.ts";
import { main } from "./docs.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const MANIFEST = {
  exports: { ".": "./index.ts", "./references/*": "./references/*" },
  files: ["references", "index.ts"],
  name: "@ws/a",
  private: false,
  type: "module",
  version: "1.0.0",
};
const TSCONFIG = {
  compilerOptions: {
    allowImportingTsExtensions: true,
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
    strict: true,
    target: "ES2022",
    types: [],
  },
};

/** A workspace whose package `@ws/a` has one `ts run` example and is linked into the root's install folder. */
function workspace(example: string, manifest: unknown = MANIFEST): string {
  const root = tempRoot({
    "package.json": json({ name: "mono", private: true, workspaces: ["packages/*"] }),
    "packages/a/index.ts": "export const answer = 42;\n",
    "packages/a/package.json": json(manifest),
    "packages/a/references/INDEX.md": "# A\n- [Use](use.md)\n",
    "packages/a/references/use.md": ["# Use", "", 'Import "@ws/a".', "", fence("ts run", ...example.split("\n"))].join(
      "\n",
    ),
    "packages/a/tsconfig.json": json(TSCONFIG),
  });
  fs.mkdirSync(path.join(root, "node_modules/@ws"), { recursive: true });
  fs.symlinkSync(path.join(root, "packages/a"), path.join(root, "node_modules/@ws/a"), "junction");
  return root;
}

it("type-checks and runs a package's example that imports its own name, under its own tsconfig", async () => {
  const run = docsRun(
    workspace('import { answer } from "@ws/a";\nif (answer !== 42) throw new Error("bad");'),
    REAL_TOOLS,
  );
  expect(await main(["--check"], run.io)).toBe(0);
  expect(run.err).toStrictEqual([]);
  expect(run.out).toStrictEqual(["docs ok: 2 references, 1 examples, 1 exports, tarball holds references/\n"]);
});

it("maps a real tsc error and a real thrown error to their markdown lines", async () => {
  const run = docsRun(workspace('import { answer } from "@ws/a";\nanswer.tokn;\nthrow new Error("boom");'), REAL_TOOLS);
  expect(await main(["--check"], run.io)).toBe(1);
  expect(run.err).toStrictEqual([
    expect.stringMatching(/^packages\/a\/references\/use\.md:7: example 1 fails to type-check: Property 'tokn'/),
    expect.stringMatching(/^packages\/a\/references\/use\.md:5: example 1 fails to run \(exit 1\): .*boom/),
  ]);
});

it("names the INDEX the real dry-run tarball lacks, in one line", async () => {
  const lacking = { ...MANIFEST, files: ["index.ts"] };
  const run = docsRun(workspace('import { answer } from "@ws/a";\nvoid answer;', lacking), REAL_TOOLS);
  expect(await main(["--check"], run.io)).toBe(1);
  expect(run.err).toStrictEqual([
    "packages/a/references/INDEX.md is not in the packed tarball; " +
      'add "references" to files in packages/a/package.json\n',
  ]);
});

it("builds its io from the process when none is given", async () => {
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  expect(await main(["--oops"])).toBe(2);
  expect(err).toHaveBeenCalledWith("usage: repo docs [--check]\n");
});

it("writes to the process streams and runs sync from the folder it is given", async () => {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const io = docsIo();
  io.out("hello\n");
  expect(out).toHaveBeenCalledWith("hello\n");
  expect(io.cwd).toBe(process.cwd());
  expect(io.tools).toBe(REAL_TOOLS);
  expect(await io.sync(tempRoot())).toBe(1);
  expect(err.mock.calls.join("")).toMatch(/workerstack\.config\.ts/);
});
