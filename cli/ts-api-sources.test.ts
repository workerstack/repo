import fs from "node:fs";

import type { Project } from "typescript/unstable/async";
import { expect, it } from "vitest";

import { put, tempDir, useTempDirs } from "./sync/__fixtures__/temp-dirs.ts";
import { sourcesOf, withFiles, withTsApi } from "./ts-api.ts";
import { posix } from "./ts-program.ts";

useTempDirs();

/** The file names `sourcesOf` gives for `files`, listed in a project over them in `dir`. */
async function namesOf(project: Project, files: readonly string[]): Promise<string[]> {
  const sources = await sourcesOf(project, files);

  return sources.map((file) => file.fileName);
}

it("gives the parsed files in order and skips one deleted since it was listed", async () => {
  const dir = posix(fs.realpathSync(tempDir("ts-api-sources-")));
  put(dir, "src/a.ts", "export const a = 1;\n");
  put(dir, "src/b.ts", "export const b = 2;\n");
  const files = [`${dir}/src/b.ts`, `${dir}/src/gone.ts`, `${dir}/src/a.ts`];

  const names = await withTsApi(dir, (run) =>
    withFiles(run, { base: null, dir, files }, (project) => namesOf(project, files)),
  );

  expect(names).toStrictEqual([`${dir}/src/b.ts`, `${dir}/src/a.ts`]);
});
