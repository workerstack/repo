import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { removePlanted, repoOnMain, write } from "./__fixtures__/planted-repo.ts";
import { ratchetProblems } from "./check-ratchets.ts";
import { removeTree } from "./remove-tree.ts";

afterEach(removePlanted);

const FILE = "mutation-floors.json";
const main = { [FILE]: { ".": 89, "packages/a": 70 }, "packages/a/package.json": "{}\n" };
const paths = { mutationFloors: FILE };

it("fails a lowered floor, naming the package and both numbers", () => {
  const dir = repoOnMain(main);
  write(dir, { [FILE]: { ".": 80, "packages/a": 70 } });
  expect(ratchetProblems(dir, paths)).toStrictEqual([`${FILE} lowers . from 89 to 80 against main; floors only rise`]);
});

it("passes an unchanged, raised or added floor", () => {
  const dir = repoOnMain(main);
  write(dir, { [FILE]: { ".": 90, "packages/a": 70, "packages/b": 1 } });
  expect(ratchetProblems(dir, paths)).toStrictEqual([]);
});

it("fails a dropped floor while its package dir exists, and passes one dropped with its package", () => {
  const dir = repoOnMain(main);
  write(dir, { [FILE]: { ".": 89 } });
  expect(ratchetProblems(dir, paths)).toStrictEqual([`${FILE} drops packages/a from 70; floors only rise`]);
  removeTree(path.join(dir, "packages/a"));
  expect(ratchetProblems(dir, paths)).toStrictEqual([]);
});

it("reads the default path when none is given, and ignores a floors file main lacks", () => {
  const dir = repoOnMain(main);
  write(dir, { [FILE]: { ".": 1, "packages/a": 70 } });
  expect(ratchetProblems(dir)).toStrictEqual([`${FILE} lowers . from 89 to 1 against main; floors only rise`]);
  const fresh = repoOnMain({ "a.txt": "a\n" });
  write(fresh, { [FILE]: { ".": 1 } });
  expect(ratchetProblems(fresh, paths)).toStrictEqual([]);
});

it("treats a floors file of the wrong shape as having no floors", () => {
  const dir = repoOnMain(main);
  write(dir, { [FILE]: "[]\n" });
  expect(ratchetProblems(dir, paths)).toStrictEqual([
    `${FILE} drops . from 89; floors only rise`,
    `${FILE} drops packages/a from 70; floors only rise`,
  ]);
});
