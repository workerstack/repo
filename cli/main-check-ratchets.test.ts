import fs from "node:fs";

import { expect, it, vi } from "vitest";

const fakes = await vi.hoisted(() => import("./fixtures/main-mocks.ts").then((mocks) => mocks.mockedGithubFakes()));
import { commitMain, writeConfigs } from "./fixtures/check-repo.ts";
import { useMainCheckRepo } from "./fixtures/main-check-repo.ts";
import { start } from "./main.ts";

const { repo } = useMainCheckRepo(fakes);

it("fails a floor lower than main's", { timeout: 60_000 }, async () => {
  writeConfigs(repo);
  repo.write("coverage-floors.json", { "src/a.ts": { branches: 80, functions: 90, statements: 90 } });
  repo.put("src/a.ts", "export const a = 1;\n");
  commitMain(repo);
  repo.write("coverage-floors.json", { "src/a.ts": { branches: 70, functions: 90, statements: 90 } });
  await start();
  expect(repo.besidesKnip()).toBe(
    "repo check: coverage-floors.json: src/a.ts branches 70 is below main's 80; floors only rise\n",
  );
  expect(process.exitCode).toBe(1);
});

it("fails an it.fails case that known-failures.json does not list", { timeout: 60_000 }, async () => {
  writeConfigs(repo);
  repo.put("src/a.test.ts", 'it.fails("parses times", () => {});\n');
  await start();
  expect(repo.besidesKnip()).toBe(
    'repo check: src/a.test.ts:1: it.fails("parses times") is not in known-failures.json; list it or fix it\n',
  );
  expect(process.exitCode).toBe(1);
});

it("reads no test files outside a git checkout", async () => {
  writeConfigs(repo);
  fs.rmSync(`${repo.dir()}/.git`, { force: true, recursive: true });
  await start();
  expect(repo.besidesKnip()).toBe("");
  expect(process.exitCode).toBe(0);
});
