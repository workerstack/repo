import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ratchetProblems } from "./check-ratchets.ts";
import { removePlanted, repoOnMain, write } from "./fixtures/planted-repo.ts";

afterEach(removePlanted);

const FILE = "mutation-floors.json";
const main = { [FILE]: { ".": 89, "packages/a": 70 }, "packages/a/package.json": "{}\n" };
const paths = { mutationFloors: FILE };

it("fails a lowered floor, naming the package and both numbers", () => {
  const dir = repoOnMain(main);
  write(dir, { [FILE]: { ".": 80, "packages/a": 70 } });
  expect(ratchetProblems(dir, paths)).toEqual([`${FILE} lowers . from 89 to 80 against main; floors only rise`]);
});

it("passes an unchanged, raised or added floor", () => {
  const dir = repoOnMain(main);
  write(dir, { [FILE]: { ".": 90, "packages/a": 70, "packages/b": 1 } });
  expect(ratchetProblems(dir, paths)).toEqual([]);
});

it("fails a dropped floor while its package dir exists, and passes one dropped with its package", () => {
  const dir = repoOnMain(main);
  write(dir, { [FILE]: { ".": 89 } });
  expect(ratchetProblems(dir, paths)).toEqual([`${FILE} drops packages/a from 70; floors only rise`]);
  fs.rmSync(path.join(dir, "packages/a"), { recursive: true });
  expect(ratchetProblems(dir, paths)).toEqual([]);
});

it("reads the default path when none is given, and ignores a floors file main lacks", () => {
  const dir = repoOnMain(main);
  write(dir, { [FILE]: { ".": 1, "packages/a": 70 } });
  expect(ratchetProblems(dir)).toEqual([`${FILE} lowers . from 89 to 1 against main; floors only rise`]);
  const fresh = repoOnMain({ "a.txt": "a\n" });
  write(fresh, { [FILE]: { ".": 1 } });
  expect(ratchetProblems(fresh, paths)).toEqual([]);
});

it("treats a floors file of the wrong shape as having no floors", () => {
  const dir = repoOnMain(main);
  write(dir, { [FILE]: "[]\n" });
  expect(ratchetProblems(dir, paths)).toEqual([
    `${FILE} drops . from 89; floors only rise`,
    `${FILE} drops packages/a from 70; floors only rise`,
  ]);
});
