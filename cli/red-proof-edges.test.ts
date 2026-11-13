import fs from "node:fs";
import nodePath from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { git, removePlanted } from "./__fixtures__/planted-repo.ts";
import { change } from "./__fixtures__/red-proof-change.ts";
import { PASS, plant, problemOf, stage } from "./__fixtures__/red-proof-repo.ts";
import { parseNameStatus, redProof } from "./red-proof.ts";
import { type GitRun, runGit } from "./sync/standards.ts";

/** The real runner's timeout and missing vitest, the outer repo's git env, git failing, and the diff parser. */
afterEach(removePlanted);

const A_TEST = change(["A", "a.test.ts"]);
const SLOW = { timeout: 60_000 };

function never(): never {
  throw new Error("vitest must not run");
}

const ENV_TEST = `import { expect, it } from "vitest";
const gitKeys = Object.keys(process.env).filter((k) => k.startsWith("GIT_") && !k.startsWith("GIT_CONFIG_"));
it("e", () => expect(gitKeys).toEqual([]));
`;

it("refuses with the timeout reason when vitest outlives the timeout", SLOW, () => {
  const root = plant({ "s.ts": "head\n" });
  stage(root, { "a.test.ts": PASS });
  expect(problemOf(redProof(root, A_TEST, { timeoutMs: 1 }))).toMatch(
    /^red-proof: vitest wrote no report in \. \(exit 1\): vitest did not finish within 1ms/,
  );
});

it("refuses with the reason when the package has no vitest", SLOW, () => {
  const root = plant({ "s.ts": "head\n" });
  fs.rmSync(nodePath.join(root, "node_modules"));
  stage(root, { "a.test.ts": PASS });
  expect(problemOf(redProof(root, A_TEST))).toMatch(
    /^red-proof: vitest wrote no report in \. \(exit 1\): cannot resolve vitest/,
  );
});

it("strips GIT_* from the nested run and leaves the committed repo's index alone", SLOW, () => {
  const root = plant({ "s.ts": "head\n" });
  stage(root, { "e.test.ts": ENV_TEST, "s.ts": "new\n" });

  function seen() {
    return { index: git(root, "ls-files", "-s"), status: git(root, "status", "--porcelain") };
  }

  const before = seen();
  vi.stubEnv("GIT_DIR", nodePath.join(root, ".git"));
  vi.stubEnv("GIT_INDEX_FILE", nodePath.join(root, ".git", "index"));
  const result = redProof(root, change(["A", "e.test.ts"], ["M", "s.ts"]));
  vi.unstubAllEnvs();
  expect(problemOf(result)).toContain("(e.test.ts passed)");
  expect(seen()).toStrictEqual(before);
});

function failing(word: string, status: number): GitRun {
  return (root, args, input) =>
    args.includes(word) ? { status, stderr: "fatal: nope", stdout: "" } : runGit(root, args, input);
}

it("throws naming the command when write-tree fails, leaving no dir", () => {
  const root = plant({ "s.ts": "head\n" });
  stage(root, { "a.test.ts": PASS });
  const faulty = failing("write-tree", 128);
  expect(() => redProof(root, A_TEST, { git: faulty, vitest: never })).toThrow(
    "red-proof: git write-tree failed: fatal: nope",
  );
  expect(fs.existsSync(nodePath.join(root, ".repo", "tmp", `red-proof-${process.pid}`))).toBe(false);
});

it("throws when the archive cannot be unpacked", () => {
  const root = plant({ "s.ts": "head\n" });
  stage(root, { "a.test.ts": PASS });
  const faulty = failing("archive", 0);
  expect(() => redProof(root, A_TEST, { git: faulty, vitest: never })).toThrow(/^red-proof: tar failed: /);
});

it("reads the NUL-separated name-status entries", () => {
  expect(parseNameStatus("M\0a.ts\0A\0dir/b.test.ts\0D\0c.ts\0")).toStrictEqual(
    change(["M", "a.ts"], ["A", "dir/b.test.ts"], ["D", "c.ts"]),
  );
  expect(parseNameStatus("")).toStrictEqual([]);
});
