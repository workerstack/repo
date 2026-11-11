import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { commit, world } from "../fixtures/release-world.ts";
import { removePlanted } from "../fixtures/planted-repo.ts";
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
  const tools: Tools = { cwd: w.work, git: spawnRunner("git"), gh: spawnRunner("gh") };
  return { w, tools };
}

it("counts a crate's own commits since a time, and not another crate's", () => {
  const { w, tools } = crates();
  expect(commitsAfter(tools, { since: OLD, dir: path.join(w.work, "a") }).map((c) => c.subject)).toStrictEqual([
    "feat!: break a",
  ]);
  expect(commitsAfter(tools, { since: OLD, dir: "b" }).map((c) => c.subject)).toStrictEqual(["fix: patch b"]);
});

it("counts nothing for commits older than the time", () => {
  const { w, tools } = crates();
  expect(commitsAfter(tools, { since: FUTURE, dir: path.join(w.work, "a") })).toStrictEqual([]);
});
