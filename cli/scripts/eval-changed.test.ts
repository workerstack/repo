import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { useGitTree } from "../__fixtures__/git-tree.ts";
import { useEvalRun } from "./__fixtures__/eval-run.ts";
import { parseArgs } from "./eval-args.ts";

const COUNT = "eval sample: 2 cases x 3 samples = 6 calls on claude-haiku-5-5";

const ESTIMATE = new RegExp(
  `^${COUNT} via (?:session, at most \\$[\\d.]+ \\(cap \\$5|api, at most \\$[\\d.]+ \\(cap \\$1)\\.00\\)$`,
  "mv",
);

const NEEDS_BASE = "eval: --changed needs a git base, such as main\n";
const SOLO = "export default { cases: [{ id: 'a', input: 'x', pass: () => true, source: 's' }], system: 's' };\n";
const tree = useGitTree("eval-changed-main-");
const { run, state } = useEvalRun();

/** Git's answer when the eval's own folder changed. */
function folderChanged(): string[] {
  return ["README.md", "evals/sample/eval.ts"];
}

/** Whether the runs left a runs dir in the state dir. */
function wroteRuns(): boolean {
  return fs.existsSync(path.join(state(), "runs"));
}

it("takes the base after --changed as its value, not as a second name", () => {
  expect(parseArgs(["sample", "--changed", "main"])).toStrictEqual({
    args: { cap: 5, changed: "main", isDryRun: false, name: "sample", via: "session" },
    ok: true,
  });
});

it.each([[["sample", "--changed"]], [["sample", "--changed", "--dry-run"]], [["sample", "--changed", ""]]])(
  "refuses %j with the needs-a-base line, exit 4",
  async (argv) => {
    expect(await run(argv)).toMatchObject({ code: 4, err: NEEDS_BASE, out: "" });
  },
);

it("prints the changed path before the full estimate when the eval's folder changed", async () => {
  const result = await run(["sample", "--changed", "main", "--dry-run"], { changedSince: folderChanged });

  expect(result.code).toBe(0);
  expect(result.out.split("\n")[0]).toBe("eval sample: evals/sample/eval.ts changed since main");
  expect(result.out).toMatch(ESTIMATE);
});

it("prints the no-match line and exits 0 without reading the key or writing a summary", async () => {
  const result = await run(["sample", "--changed", "main"], { changedSince: () => ["evals/other/eval.ts"] });

  expect(result).toStrictEqual({
    claudeCalls: 0,
    code: 0,
    err: "",
    fetches: 0,
    keyReads: 0,
    out: "eval sample: nothing it reads changed since main\n",
  });
  expect(wroteRuns()).toBe(false);
});

it("refuses a base git cannot diff against, exit 1", async () => {
  const result = await run(["sample", "--changed", "nope"], { changedSince: () => null });

  expect(result).toMatchObject({ code: 1, err: 'eval: --changed: git cannot diff against "nope"\n', keyReads: 0 });
});

it("takes --via with --changed and runs a changed eval on the session", async () => {
  const result = await run(["sample", "--changed", "main", "--via", "session"], { changedSince: folderChanged });

  expect(result).toMatchObject({ claudeCalls: 6, code: 0, fetches: 0, keyReads: 0 });
  expect(result.out.split("\n")[0]).toBe("eval sample: evals/sample/eval.ts changed since main");
});

it("reads git by default: a committed eval with nothing since HEAD runs nothing", async () => {
  const dir = tree.repoWith({ "evals/solo/eval.ts": SOLO });
  execFileSync("git", ["-c", "user.email=a@example.com", "-c", "user.name=a", "commit", "-qm", "x"], { cwd: dir });
  const result = await run(["solo", "--changed", "HEAD", "--dry-run"], { root: dir });

  expect(result).toMatchObject({ code: 0, err: "", out: "eval solo: nothing it reads changed since HEAD\n" });
});
