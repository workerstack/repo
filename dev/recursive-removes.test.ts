import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { recursiveRemoves } from "./recursive-removes.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_RE = /\.(?:ts|mts|cts|tsx)$/u;

/** The one module that may remove recursively: the rest go through it. */
const REMOVE_TREE = "cli/remove-tree.ts";

/** Every TypeScript file in the checkout, tracked or new, as a `/` path from the root. */
function sources(): string[] {
  const listed = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" });

  return listed.split("\n").filter((rel) => SOURCE_RE.test(rel) && fs.existsSync(path.join(ROOT, rel)));
}

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
  const found = sources()
    .filter((rel) => rel !== REMOVE_TREE)
    .flatMap((rel) => recursiveRemoves(rel, fs.readFileSync(path.join(ROOT, rel), "utf8")).map((n) => `${rel}:${n}`));

  expect(found).toStrictEqual([]);
});
