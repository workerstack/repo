import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, expect, it } from "vitest";

import { removeTree } from "./remove-tree.ts";
import { ownerProgram, posix, type SharedSources } from "./ts-program.ts";

const SLOW = 60_000;
const root = posix(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-ts-program-"))));

afterAll(() => removeTree(root));

it("spells a windows path with forward slashes, as typescript names its files", () => {
  expect(posix("C:\\pkg\\src\\a.ts")).toBe("C:/pkg/src/a.ts");
});

it("leaves a forward-slash path as it is", () => {
  expect(posix("/pkg/src/a.ts")).toBe("/pkg/src/a.ts");
});

it("opens a program that leaves out a root file missing on disk and shares the one it read", { timeout: SLOW }, () => {
  const present = path.posix.join(root, "a.ts");
  const missing = path.posix.join(root, "gone.ts");
  fs.writeFileSync(present, "export const a = 1;\n");
  const shared: SharedSources = new Map();
  const opened = ownerProgram({ dir: null, root, shared }, [present, missing]);

  if (!opened.ok) throw new Error(opened.error.join("\n"));
  const names = opened.value.program.getSourceFiles().map((file) => file.fileName);

  expect(names).toContain(present);
  expect(names).not.toContain(missing);
  expect(opened.value.widen([present]).getSourceFile(present)).toBe(opened.value.program.getSourceFile(present));
});
