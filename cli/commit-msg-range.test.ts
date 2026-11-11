import { afterEach, expect, it } from "vitest";

import { git, lines, put, removeTemps, tempDir } from "./__fixtures__/commit-repo.ts";
import { main } from "./commit-msg.ts";
import { CONFIG_FILE } from "./config.constants.ts";

/** `repo commit-msg --range` on planted repos. */
afterEach(removeTemps);

/** A repo with a base commit; `commit` adds files and commits with `message`, returning the sha. */
function plant() {
  const root = tempDir();
  git(root, "init", "-q", "-b", "main");
  function commit(files: Record<string, string | Buffer>, message: string) {
    put(root, files);
    git(root, "add", "-A");
    git(root, "commit", "-q", "--no-verify", "-m", message);
    return git(root, "rev-parse", "HEAD").trim();
  }
  const base = commit(
    { [CONFIG_FILE]: "export default {}\n", "package.json": JSON.stringify({ name: "app", private: true }) },
    "chore: base",
  );
  return { base, commit, root };
}
async function range(root: string, ...args: string[]) {
  const err: string[] = [];
  const code = await main(args, { cwd: root, stderr: (text) => err.push(text) });
  return { code, stderr: err.join("") };
}
const NEEDS_TEST = "a feat commit must include a test change (a *.test.* or *.spec.* file, or a file under e2e/)";
const HEADER = 'the header must be "type(scope)!: subject", e.g. "fix(paths): compare hook paths canonically"';
const OVER = "the commit changes 1100 lines, over the limit of 1000; add a body line saying why, or split it";
const FORCE_PUSH = "is not an ancestor of HEAD (a force push?); checking HEAD alone";
const USAGE =
  "repo commit-msg: name the commit message file as git's commit-msg hook does or pass --range <base>..<head>\n";

/** Plants a side branch merged into main with a merge commit on top. */
function merged(plantd: ReturnType<typeof plant>) {
  const { root, commit } = plantd;
  git(root, "checkout", "-q", "-b", "side");
  commit({ "s.ts": "s\n" }, "chore: side");
  git(root, "checkout", "-q", "main");
  commit({ "m.ts": "m\n" }, "chore: main");
  git(root, "merge", "-q", "--no-ff", "-m", "Merge side", "side");
}

it("passes a clean range, a lockfile-heavy commit and skips merges", async () => {
  const planted = plant();
  const { root, commit, base } = planted;
  commit({ "a.test.ts": "t\n", "a.ts": "a\n" }, "feat: add a");
  commit(
    { ".gitattributes": "gen/** linguist-generated\n", "bun.lock": lines(2000), "gen/x.ts": lines(2000) },
    "chore: lock",
  );
  merged(planted);
  expect(await range(root, "--range", `${base}..HEAD`)).toStrictEqual({ code: 0, stderr: "" });
});

it("names sha and subject of each failing commit, oldest first", async () => {
  const { root, commit, base } = plant();
  const one = commit({ "a.ts": "a\n" }, "feat: add a");
  const two = commit({ "b.ts": "b\n" }, "Bad header");
  const three = commit({ "big.ts": lines(1100) }, "chore: big");
  const four = commit({ "c.ts": "c\n" }, "chore(Nope): x");
  const result = await range(root, "--range", `${base}..HEAD`);
  expect(result.code).toBe(1);
  expect(result.stderr.split("\n")).toStrictEqual([
    `commit-msg: ${one.slice(0, 7)} feat: add a: ${NEEDS_TEST}`,
    `commit-msg: ${two.slice(0, 7)} Bad header: ${HEADER}`,
    `commit-msg: ${three.slice(0, 7)} chore: big: ${OVER}`,
    `commit-msg: ${four.slice(0, 7)} chore(Nope): x: the scope "Nope" must be lowercase kebab-case`,
    "",
  ]);
});

it("checks HEAD alone for a zero, empty, missing or non-ancestor base", async () => {
  const { root, commit, base } = plant();
  git(root, "checkout", "-q", "-b", "other");
  const other = commit({ "o.ts": "o\n" }, "chore: other");
  git(root, "checkout", "-q", "main");
  const bad = commit({ "a.ts": "a\n" }, "feat: add a");
  const problem = `commit-msg: ${bad.slice(0, 7)} feat: add a: ${NEEDS_TEST}\n`;
  expect(await range(root, "--range", `${"0".repeat(40)}..HEAD`)).toStrictEqual({ code: 1, stderr: problem });
  expect(await range(root, "--range", "..HEAD")).toStrictEqual({ code: 1, stderr: problem });
  expect(await range(root, "--range", `${other}..HEAD`)).toStrictEqual({
    code: 1,
    stderr: `commit-msg: ${other.slice(0, 7)} ${FORCE_PUSH}\n${problem}`,
  });
  const gone = await range(root, "--range", `${"1".repeat(40)}..HEAD`);
  expect(gone.stderr).toContain(`1111111 ${FORCE_PUSH}\n`);
  expect(await range(root, "--range", `${base}..`)).toStrictEqual({ code: 1, stderr: problem });
});

it("checks nothing when the head alone is a merge", async () => {
  const planted = plant();
  merged(planted);
  expect(await range(planted.root, "--range", "..HEAD")).toStrictEqual({ code: 0, stderr: "" });
});

it("refuses an unknown range and no arguments", async () => {
  const { root } = plant();
  const bads = ["nope..HEAD", "HEAD..nope", "HEAD", "a..b..c"];
  const results = await Promise.all(bads.map((bad) => range(root, "--range", bad)));
  expect(results).toStrictEqual(
    bads.map((bad) => ({ code: 1, stderr: `repo commit-msg: no commit range "${bad}"; use <base>..<head>\n` })),
  );
  expect(await range(root, "--range")).toStrictEqual({ code: 1, stderr: USAGE });
  expect(await range(root, "--range", "a..b", "c")).toStrictEqual({ code: 1, stderr: USAGE });
});

it("refuses on a config it cannot read", async () => {
  const { root, commit, base } = plant();
  commit({ [CONFIG_FILE]: "export default { commit: 5 }\n" }, "chore: x");
  const result = await range(root, "--range", `${base}..HEAD`);
  expect(result.code).toBe(1);
});
