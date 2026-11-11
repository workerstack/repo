import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { cleanTemps, consumer, git, SLOW, tempDir, turn, write } from "./__fixtures__/turn-repo.ts";
import type { Bins } from "./turn-steps.ts";
import { main } from "./turn.ts";

/** These consumers install nothing, so vitest is missing. */
const NO_DEPS = { deps: false };

afterEach(() => {
  vi.restoreAllMocks();
  cleanTemps();
});

it(
  "a deletion alone leaves fmt and lint nothing to run, and vitest missing skips the tests",
  { timeout: SLOW },
  async () => {
    const root = consumer({ "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n" }, NO_DEPS);
    fs.rmSync(path.join(root, "src/a.ts"));
    expect(await turn(root, [])).toStrictEqual({
      code: 0,
      err: "",
      out: "turn: 1 file · fmt ok · comments ok · lint ok · typecheck skipped (no tsconfig.json) · 0 related tests\n",
    });
    write(root, { "src/b.ts": "export const b = 2;\n" });
    const second = await turn(root, []);
    expect(second.out).toBe(
      "turn: 2 files · fmt ok · comments ok · lint ok · typecheck skipped (no tsconfig.json) · " +
        "related tests skipped (no vitest in .)\n",
    );
  },
);

it("vitest failing without a test count fails the related tests", { timeout: SLOW }, async () => {
  const root = consumer({ "src/a.ts": "export const a = 1;\n" }, NO_DEPS);
  write(root, { "src/a.ts": "export const a = 2;\n" });
  const bins: Bins = {
    tsc: () => ({ code: 0, stderr: "", stdout: "" }),
    vitest: () => ({ code: 1, stderr: "Error: no config\n", stdout: "" }),
  };
  expect(await turn(root, [], bins)).toStrictEqual({
    code: 1,
    err: "Error: no config\n",
    out:
      "turn: 1 file · fmt ok · comments ok · lint ok · typecheck skipped (no tsconfig.json) · " +
      "related tests failed\n",
  });
});

it("refuses two paths, a path outside the repo, no config, a broken config and a broken manifest", async () => {
  const root = consumer({}, NO_DEPS);
  async function refusal(argv: string[], cwd = root) {
    return (await main(argv, { cwd, stderr: (s) => errs.push(s) }), errs.pop());
  }
  const errs: string[] = [];
  expect(await refusal(["a", "b"])).toBe("repo turn: one path at most; use repo turn [--staged] [<path>]\n");
  expect(await refusal(["../elsewhere"])).toBe(`repo turn: ../elsewhere is outside ${root}\n`);
  const bare = tempDir("workerstack-turn-bare-");
  expect(await refusal([], bare)).toBe(
    `repo turn: no workerstack.config.ts in ${bare} or any parent; run \`bun repo init\`\n`,
  );
  write(root, { "package.json": "{" });
  expect(await refusal([])).toMatch(/^repo turn: package.json: not valid JSON/);
  write(root, { "workerstack.config.ts": "export default 1;\n" });
  expect(await refusal([])).toMatch(/^repo turn: workerstack.config.ts: /);
});

it("prints to the process's own stdout and stderr when not given others", { timeout: SLOW }, async () => {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  expect(await main(["--nope"])).toBe(1);
  expect(err).toHaveBeenCalledWith("repo turn: unknown flag --nope; use repo turn [--staged] [<path>]\n");
  expect(await main([], { cwd: consumer({}, NO_DEPS) })).toBe(0);
  expect(out).toHaveBeenCalledWith("turn: no changes\n");
});

it("a failed restage under --staged fails the turn and says what to stage", { timeout: SLOW }, async () => {
  const root = consumer({ "src/a.ts": "export const a = 1;\n" }, NO_DEPS);
  write(root, { "src/a.ts": "export const a = 2;\n" });
  git(root, "add", "src/a.ts");
  const first = await turn(root, ["--staged"]);
  expect(first.code).toBe(0);
  write(root, { "src/a.ts": "export const a = {b:1}\n" });
  git(root, "add", "src/a.ts");
  // A held index lock makes `git add` fail the way a concurrent git process would.
  fs.writeFileSync(path.join(root, ".git/index.lock"), "");
  const result = await turn(root, ["--staged"]);
  expect(result.err).toContain("repo turn: git add failed for src/a.ts; stage it yourself and commit again\n");
  expect(result.out).toMatch(/^turn: 1 file · fmt 1 fixed · /);
  expect(result.code).toBe(1);
});
