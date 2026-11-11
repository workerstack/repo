import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import type * as CommandsModule from "./commands.ts";
import type * as GithubApplyModule from "./github-apply.ts";
import type * as InitModule from "./init.ts";

const fakes = await vi.hoisted(async () => {
  const kit = await import("./fixtures/main-kit.ts");
  return kit.mainFakes();
});
vi.mock(new URL("./commands.ts", import.meta.url).href, async (importOriginal) => ({
  ...(await importOriginal<typeof CommandsModule>()),
  runCommand: fakes.runCommand,
}));
vi.mock(new URL("./init.ts", import.meta.url).href, async (importOriginal) => ({
  ...(await importOriginal<typeof InitModule>()),
  init: fakes.init,
}));
vi.mock(new URL("./github-apply.ts", import.meta.url).href, async (importOriginal) => {
  const actual = await importOriginal<typeof GithubApplyModule>();
  return { ...actual, checkGithubAt: (cwd: string) => actual.checkGithubAt(cwd, { ci: false, gh: fakes.githubIo.gh }) };
});
vi.mock(new URL("./sync.ts", import.meta.url).href, () => ({ runSync: fakes.runSync }));
vi.mock(new URL("./scripts/folder-map.ts", import.meta.url).href, () => ({ mapCommand: fakes.mapCommand }));
vi.mock(new URL("./prompt.ts", import.meta.url).href, () => fakes);
import { commitMain, useCheckRepo, writeConfigs } from "./fixtures/check-repo.ts";
import { useStart } from "./fixtures/main-kit.ts";
import { start } from "./main.ts";

const written = useStart(fakes);
const repo = useCheckRepo(fakes, written);

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
  fs.rmSync(path.join(repo.dir(), ".git"), { force: true, recursive: true });
  await start();
  expect(repo.besidesKnip()).toBe("");
  expect(process.exitCode).toBe(0);
});
