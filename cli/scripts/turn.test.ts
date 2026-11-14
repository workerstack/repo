import { afterEach, expect, it } from "vitest";

import {
  ANSWER,
  ANSWER_TEST,
  cleanTemps,
  consumer,
  read,
  SLOW,
  srcConfig,
  staged,
  TSCONFIG,
  turn,
  write,
} from "./__fixtures__/turn-repo.ts";

afterEach(cleanTemps);

it("a clean tree has no changes", { timeout: SLOW }, async () => {
  expect(await turn(consumer({}), [])).toStrictEqual({ code: 0, err: "", out: "turn: no changes\n" });
});

it(
  "the working tree: formats, lints, typechecks the root, runs no tests and leaves the index alone",
  { timeout: SLOW },
  async () => {
    const root = consumer({
      "tsconfig.json": TSCONFIG,
      ...srcConfig(),
      "src/answer.test.ts": ANSWER_TEST,
      "src/answer.ts": ANSWER,
    });

    write(root, {
      "src/answer.ts": "export const answer: number = 40+2\n",
      "src/other.ts": "export const other = 1;\n",
    });
    expect(await turn(root, [])).toStrictEqual({
      code: 0,
      err: "",
      out: "turn: 2 files · fmt 1 fixed · comments ok · lint ok · typecheck .\n",
    });
    expect(read(root, "src/answer.ts")).toBe("export const answer: number = 40 + 2;\n");
    expect(staged(root)).toStrictEqual([]);
  },
);

it(
  "a magic number over the baseline fails lint with its line and fix; a lint.skip lets its file through",
  { timeout: SLOW },
  async () => {
    const skip = { files: ["src/retry.ts"], reason: "retry tuning lives here", rules: ["repo/magic-number"] };

    const root = consumer({
      "repo.config.ts": `export default ${JSON.stringify({ lint: { skip: [skip] }, packs: ["standards"] })};\n`,
      "src/retry.ts": "export const retry = 1;\n",
      "src/wait.ts": "export const wait = 1;\n",
    });

    write(root, {
      "src/retry.ts": "export function retry(): number {\n  return 3;\n}\n",
      "src/wait.ts": "export function wait(): number {\n  return 5000;\n}\n",
    });
    const result = await turn(root, [], { tsc: () => ({ code: 0, stderr: "", stdout: "" }), vitest: () => null });
    expect(result.out).toMatch(/^turn: 2 files · fmt ok · comments ok · lint 1 over baseline · /);
    expect(result.err).toBe(
      [
        "src/wait.ts:2:10: error repo(magic-number): 5000 names nothing; give it a named const",
        "repo turn: src/wait.ts has 1 repo(magic-number), the baseline allows 0; fix the new one",
        "",
      ].join("\n"),
    );
    expect(result.code).toBe(1);
  },
);

it("refuses unknown flags and a repo without the standards pack", { timeout: SLOW }, async () => {
  const root = consumer({});
  expect(await turn(root, ["--nope"])).toStrictEqual({
    code: 1,
    err:
      "repo turn: unknown flag --nope; use repo turn [<path>], or repo precommit for the index " +
      "(bun repo sync updates an old pre-commit hook)\n",
    out: "",
  });
  write(root, { "repo.config.ts": 'export default { packs: ["docs"] };\n' });
  const off = await turn(root, []);
  expect(off.err).toBe('repo turn: the standards pack is off; add "standards" to packs in repo.config.ts\n');
});
