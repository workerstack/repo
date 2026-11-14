import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { cleanTemps, consumer, git, precommit, SLOW, tempDir, turn, write } from "./__fixtures__/turn-repo.ts";
import { main as precommitMain } from "./precommit.ts";
import type { Bins } from "./turn-steps.ts";
import { main } from "./turn.ts";

/** What turn's flag refusal points to. */
const INDEX_HINT =
  "use repo turn [<path>], or repo precommit for the index (bun repo sync updates an old pre-commit hook)";

/** These consumers install nothing, so vitest is missing. */
const NO_DEPS = { deps: false };

afterEach(() => {
  vi.restoreAllMocks();
  cleanTemps();
});

it(
  "a deletion alone leaves fmt and lint nothing to run, turn runs no tests, and vitest missing skips precommit's",
  { timeout: SLOW },
  async () => {
    const root = consumer({ "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n" }, NO_DEPS);
    fs.rmSync(path.join(root, "src/a.ts"));
    expect(await turn(root, [])).toStrictEqual({
      code: 0,
      err: "",
      out: "turn: 1 file · fmt ok · comments ok · lint ok · typecheck skipped (no tsconfig.json)\n",
    });
    git(root, "add", "-A");
    const first = await precommit(root);
    expect(first.out).toBe(
      "precommit: 1 file · fmt ok · comments ok · lint ok · typecheck skipped (no tsconfig.json) · 0 related tests\n",
    );
    write(root, { "src/b.ts": "export const b = 2;\n" });
    git(root, "add", "-A");
    const second = await precommit(root);
    expect(second.out).toBe(
      "precommit: 2 files · fmt ok · comments ok · lint ok · typecheck skipped (no tsconfig.json) · " +
        "related tests skipped (no vitest in .)\n",
    );
  },
);

it("vitest failing without a test count fails precommit's related tests", { timeout: SLOW }, async () => {
  const root = consumer({ "src/a.ts": "export const a = 1;\n" }, NO_DEPS);
  write(root, { "src/a.ts": "export const a = 2;\n" });
  git(root, "add", "src/a.ts");

  const bins: Bins = {
    tsc: () => Promise.resolve({ code: 0, stderr: "", stdout: "" }),
    vitest: () => Promise.resolve({ code: 1, stderr: "Error: no config\n", stdout: "" }),
  };

  expect(await precommit(root, bins)).toStrictEqual({
    code: 1,
    err: "Error: no config\n",
    out:
      "precommit: 1 file · fmt ok · comments ok · lint ok · typecheck skipped (no tsconfig.json) · " +
      "related tests failed\n",
  });
});

it("refuses two paths, an outside path, any flag, no config, a broken config and a broken manifest", async () => {
  const root = consumer({}, NO_DEPS);

  async function refusal(argv: string[], cwd = root) {
    return (await main(argv, { cwd, stderr: (s) => errs.push(s) }), errs.pop());
  }

  const errs: string[] = [];
  expect(await refusal(["a", "b"])).toBe("repo turn: one path at most; use repo turn [<path>]\n");

  expect(await refusal(["--staged"])).toBe(`repo turn: unknown flag --staged; ${INDEX_HINT}\n`);
  expect(await refusal(["--staged", "src"])).toBe(`repo turn: unknown flag --staged; ${INDEX_HINT}\n`);
  expect(await refusal(["../elsewhere"])).toBe(`repo turn: ../elsewhere is outside ${root}\n`);
  const bare = tempDir("workerstack-turn-bare-");
  expect(await refusal([], bare)).toBe(
    `repo turn: no repo.config.ts in ${bare} or any parent; run \`bun repo init\`\n`,
  );
  write(root, { "package.json": "{" });
  expect(await refusal([])).toMatch(/^repo turn: package.json: not valid JSON/);
  write(root, { "repo.config.ts": "export default 1;\n" });
  expect(await refusal([])).toMatch(/^repo turn: repo.config.ts: /);
});

it("prints to the process's own stdout and stderr when not given others", { timeout: SLOW }, async () => {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  expect(await main(["--nope"])).toBe(1);
  expect(err).toHaveBeenCalledWith(`repo turn: unknown flag --nope; ${INDEX_HINT}\n`);
  const root = consumer({}, NO_DEPS);
  expect(await main([], { cwd: root })).toBe(0);
  expect(out).toHaveBeenCalledWith("turn: no changes\n");
  expect(await precommitMain([], { cwd: root })).toBe(0);
  expect(out).toHaveBeenCalledWith("precommit: no changes\n");
});

it("precommit refuses any argument", async () => {
  const root = consumer({}, NO_DEPS);

  const refused = { code: 1, err: "repo precommit: takes no arguments; use repo precommit\n", out: "" };
  expect(await precommit(root, undefined, ["src"])).toStrictEqual(refused);
  expect(await precommit(root, undefined, ["--staged"])).toStrictEqual(refused);
});

it("precommit run with no deps writes its refusal to the process stderr", async () => {
  const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);

  expect(await precommitMain(["src"])).toBe(1);
  expect(err).toHaveBeenCalledWith("repo precommit: takes no arguments; use repo precommit\n");
  err.mockRestore();
});

it("a failed restage fails precommit and says what to stage", { timeout: SLOW }, async () => {
  const root = consumer({ "src/a.ts": "export const a = 1;\n" }, NO_DEPS);
  write(root, { "src/a.ts": "export const a = 2;\n" });
  git(root, "add", "src/a.ts");
  const first = await precommit(root);
  expect(first.code).toBe(0);
  write(root, { "src/a.ts": "export const a = {b:1}\n" });
  git(root, "add", "src/a.ts");
  // A held index lock makes `git add` fail the way a concurrent git process would.
  fs.writeFileSync(path.join(root, ".git/index.lock"), "");
  const result = await precommit(root);
  expect(result.err).toBe("repo precommit: git add failed for src/a.ts; stage it yourself and commit again\n");
  expect(result.out).toMatch(/^precommit: 1 file · fmt 1 fixed · /);
  expect(result.code).toBe(1);
});
