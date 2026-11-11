import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { aliasOf } from "../../dev/test-paths";
import { gitRepo, must, orchestrateKit, plantLesson, plantSource, replyOf } from "./__fixtures__/orchestrate-kit.ts";
import { VALID_PLAN } from "./__fixtures__/persist-bodies.ts";

const kit = orchestrateKit();
/** A plan whose first leaf edits `file`, so the save cites the lessons that match it. */
function touching(file: string) {
  return VALID_PLAN.replace("1.1 [ ] read the gitignore if it exists", `1.1 [ ] edit ${file}`);
}
function savedPath(run: ReturnType<typeof kit.writeAs>) {
  return must(replyOf(run)).hookSpecificOutput.updatedInput.file_path;
}

it("saves a plan aimed at a subdir's .tmp/repo at the root, with its approval", () => {
  const { r } = gitRepo(kit);
  const a = path.join(r, "packages/a");
  const saved = savedPath(kit.writeAs({ cwd: a, sid: "s1" }, path.join(a, ".tmp/repo/plans/x.md"), VALID_PLAN));
  expect(path.dirname(saved)).toBe(path.join(r, ".tmp/repo/plans"));
  expect(fs.readFileSync(path.join(r, ".tmp/repo/sessions/s1/approvals.txt"), "utf8")).toContain(saved);
  expect(fs.existsSync(path.join(a, ".tmp"))).toBe(false);
});

it("saves a worktree session's plan at the main checkout", () => {
  const { r, w } = gitRepo(kit);
  const at = { cwd: w, env: { CLAUDE_PROJECT_DIR: w }, sid: "s2" };
  const saved = savedPath(kit.writeAs(at, path.join(w, ".tmp/repo/plans/x.md"), VALID_PLAN));
  expect(path.dirname(saved)).toBe(path.join(r, ".tmp/repo/plans"));
  expect(fs.existsSync(path.join(w, ".tmp"))).toBe(false);
});

it("checks a worktree plan's lesson citations against the worktree's lessons", () => {
  const { w } = gitRepo(kit);
  plantSource(w);
  plantLesson(w);
  const at = { cwd: w, env: { CLAUDE_PROJECT_DIR: w }, sid: "s3" };
  const out = kit.writeAs(at, path.join(w, ".tmp/repo/plans/x.md"), touching(path.join(w, "src/a.ts")));
  const res = must(replyOf(out)).hookSpecificOutput;
  expect(res.permissionDecision).toBe("deny");
  expect(res.permissionDecisionReason).toContain(".repo/lessons/plan-forks.md");
});

it("saves, checks and notices through an alias of the repo as through its real path", () => {
  const { r, w } = gitRepo(kit);
  const alias = aliasOf(r);
  plantSource(w);
  const at = { cwd: alias, env: { CLAUDE_PROJECT_DIR: alias }, sid: "s5" };
  const file = savedPath(kit.writeAs(at, path.join(alias, ".tmp/repo/plans/x.md"), VALID_PLAN));
  expect(path.dirname(file)).toBe(path.join(r, ".tmp/repo/plans"));
  expect(fs.readFileSync(path.join(r, ".tmp/repo/sessions/s5/approvals.txt"), "utf8")).toContain(file);
  // The lesson lives in the worktree that holds the file; the main checkout takes no lesson writes.
  plantLesson(w);
  const viaAlias = path.join(alias, ".worktrees/w/src/a.ts");
  const cited = must(replyOf(kit.writeAs(at, path.join(alias, ".tmp/repo/plans/y.md"), touching(viaAlias))));
  expect(cited.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(cited.hookSpecificOutput.permissionDecisionReason).toContain(".repo/lessons/plan-forks.md");
  const notice = kit.writeAs({ ...at, sid: "s6" }, viaAlias, "y\n");
  expect(notice.stdout).toContain("Recorded lessons match src/a.ts");
});
