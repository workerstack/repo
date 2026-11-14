import { expect, it } from "vitest";

import { recursiveRemoves } from "./recursive-removes.ts";
import { scanTree } from "./source-scan.ts";

/** The one module that may remove recursively: the rest go through it. */
const REMOVE_TREE = "cli/remove-tree.ts";

it("finds a member, a bare and a split-line recursive remove, and no text in a string or comment", () => {
  const source = [
    'import fs from "node:fs";',
    "fs.rmSync(dir, { force: true, recursive: true });",
    "await rm(dir, { recursive: true });",
    "fs.promises.rm(",
    "  dir,",
    "  { recursive: true },",
    ");",
    'const text = "fs.rmSync(dir, { recursive: true })";',
    "// fs.rmSync(dir, { recursive: true });",
    "fs.rmSync(file, { force: true });",
    "fs.mkdirSync(dir, { recursive: true });",
  ].join("\n");

  expect(recursiveRemoves("x.ts", source)).toStrictEqual([2, 3, 4]);
});

it("finds no recursive remove outside cli/remove-tree.ts; use removeTree, or removeTemps in a test", () => {
  expect(scanTree((rel, source) => (rel === REMOVE_TREE ? [] : recursiveRemoves(rel, source)))).toStrictEqual([]);
});
