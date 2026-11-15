import { afterEach, expect, it } from "vitest";

import { plant, put, removeTemps } from "./__fixtures__/commit-repo.ts";
import { main } from "./commit-msg.ts";

/** `repo commit-msg` and `--range` on a planted repo whose config lists one co-author. */
afterEach(removeTemps);

/** `repo commit-msg` at `root` with `args`, and what it printed. */
async function run(root: string, ...args: string[]) {
  const err: string[] = [];
  const code = await main(args, { cwd: root, stderr: (text) => err.push(text), stdin: () => "" });

  return { code, stderr: err.join("") };
}

const ADA = "Ada Lovelace <ada@example.com>";
const LISTED = `chore: tidy x\n\nCo-Authored-By: ${ADA}\n`;
const EVE = "Eve <eve@x.io>";
const UNLISTED = `chore: tidy y\n\nCo-authored-by: ${EVE}\n`;
const FIX = "add it to commit.coAuthors in repo.config.ts, or remove the line";
const NOT_LISTED = `the co-author "${EVE}" is not listed; ${FIX}`;

/** A planted repo whose config lists Ada, its base commit as `from`. */
function listingAda() {
  const { base, commit, root } = plant(`export default { commit: { coAuthors: [${JSON.stringify(ADA)}] } }\n`);

  return { commit, from: base, root };
}

it("passes a listed co-author and refuses an unlisted one in a range, reading commit.coAuthors", async () => {
  const { root, commit, from } = listingAda();
  const pass = commit({ "x.ts": "x\n" }, LISTED);
  expect(await run(root, "--range", `${from}..${pass}`)).toStrictEqual({ code: 0, stderr: "" });

  const fail = commit({ "y.ts": "y\n" }, UNLISTED);
  expect(await run(root, "--range", `${pass}..${fail}`)).toStrictEqual({
    code: 1,
    stderr: `commit-msg: ${fail.slice(0, 7)} chore: tidy y: ${NOT_LISTED}\n`,
  });
});

it("gives the same verdicts from the commit-msg hook on the same messages", async () => {
  const { root } = listingAda();
  put(root, { "listed.txt": LISTED, "unlisted.txt": UNLISTED });
  expect(await run(root, "listed.txt")).toStrictEqual({ code: 0, stderr: "" });
  expect(await run(root, "unlisted.txt")).toStrictEqual({
    code: 1,
    stderr: `commit-msg: the message was refused\n  - ${NOT_LISTED}\n`,
  });
});
