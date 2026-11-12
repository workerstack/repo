import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { removePlanted } from "../__fixtures__/planted-repo.ts";
import { commit, world } from "../__fixtures__/release-world.ts";
import { spawnRunner } from "../scripts/ci-wait-run.ts";
import { commitsAfter, type Tools } from "./git.ts";

afterEach(removePlanted);

const OLD = "2000-01-01T00:00:00Z";
const FUTURE = "2099-01-01T00:00:00Z";

/** A repo whose crates a and b each have a commit. */
function crates() {
  const w = world({}, false);
  commit(w, "feat!: break a", { "a/src/lib.rs": "pub fn a() {}\n" }, false);
  commit(w, "fix: patch b", { "b/src/lib.rs": "pub fn b() {}\n" }, false);
  const tools: Tools = { cwd: w.work, gh: spawnRunner("gh"), git: spawnRunner("git") };

  return { tools, w };
}

it("counts a crate's own commits since a time, and not another crate's", () => {
  const { w, tools } = crates();
  expect(commitsAfter(tools, { dir: path.join(w.work, "a"), since: OLD }).map((c) => c.subject)).toStrictEqual([
    "feat!: break a",
  ]);
  expect(commitsAfter(tools, { dir: "b", since: OLD }).map((c) => c.subject)).toStrictEqual(["fix: patch b"]);
});

it("counts nothing for commits older than the time", () => {
  const { w, tools } = crates();
  expect(commitsAfter(tools, { dir: path.join(w.work, "a"), since: FUTURE })).toStrictEqual([]);
});
