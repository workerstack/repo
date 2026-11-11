import { afterEach, expect, it } from "vitest";

import { removePlanted, tempDir, write } from "../fixtures/planted-repo.ts";
import { listDir } from "./list-dir.ts";

afterEach(removePlanted);

it("lists the names in a directory", () => {
  const dir = tempDir();
  write(dir, { "a.tgz": "x", "b.txt": "y" });
  expect(listDir(dir).toSorted()).toStrictEqual(["a.tgz", "b.txt"]);
});
