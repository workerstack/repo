import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { aliasOf } from "../../dev/test-paths";
import { gitRepo, must, orchestrateKit, plantLesson, plantSource, replyOf } from "./__fixtures__/orchestrate-kit.ts";
import { VALID_LESSON } from "./__fixtures__/persist-bodies.ts";

const kit = orchestrateKit();

function outputOf(run: ReturnType<typeof kit.writeAs>) {
  return must(replyOf(run)).hookSpecificOutput;
}

it("notices the lessons of the worktree that holds a file written from the root", () => {
  const { r, w } = gitRepo(kit);
  plantSource(w);
  const lesson = plantLesson(w);

  function from(sid: string) {
    return { cwd: r, env: { CLAUDE_PROJECT_DIR: r }, sid };
  }

  const ctx = outputOf(kit.writeAs(from("n1"), path.join(w, "src/a.ts"), "y\n")).additionalContext;
  expect(ctx).toContain("Recorded lessons match src/a.ts:");
  expect(ctx).toContain(".repo/lessons/plan-forks.md (hits 1): Plan rewrites fork serials");
  // Shown once per session; another session sees it again.
  expect(kit.writeAs(from("n1"), path.join(w, "src/a.ts"), "y\n").stdout).toBe("");
  expect(kit.writeAs(from("n2"), path.join(w, "src/a.ts"), "y\n").stdout).toContain("Recorded lessons match");
  // The lesson file itself gets no notice about itself.
  expect(kit.writeAs(from("n3"), lesson, VALID_LESSON).stdout).not.toContain("Recorded lessons match");
});

it("denies a lesson Write in the main checkout and writes nothing there", () => {
  const { r } = gitRepo(kit);
  plantSource(r);
  const alias = aliasOf(r);

  for (const cwd of [r, alias]) {
    const at = { cwd, env: { CLAUDE_PROJECT_DIR: cwd }, sid: "m1" };
    const res = outputOf(kit.writeAs(at, path.join(cwd, ".repo/lessons/plan-forks.md"), VALID_LESSON));
    expect(res.permissionDecision).toBe("deny");
    expect(res.permissionDecisionReason).toBe(
      "the main checkout is shared: run bun repo worktree add <name> " +
        `and write under ${path.join(r, ".worktrees/<name>")}; ` +
        `only ${path.join(r, ".repo")}${path.sep}` +
        `{plans,plans-fast,roadmaps,roadmaps-fast,handoffs,implementations,scratch,tmp}${path.sep} is writable here`,
    );
  }

  expect(fs.existsSync(path.join(r, ".rulesync"))).toBe(false);
});

it("validates, saves and reindexes a lesson Write to a worktree sent from the root", () => {
  const { r, w } = gitRepo(kit);
  plantSource(w);
  const lesson = path.join(w, ".repo/lessons/plan-forks.md");
  const at = { cwd: r, env: { CLAUDE_PROJECT_DIR: r }, sid: "w1" };
  const bad = outputOf(kit.writeAs(at, lesson, VALID_LESSON.replace('["src/**"]', '["lib/**"]')));
  expect(bad.permissionDecision).toBe("deny");
  expect(bad.permissionDecisionReason).toMatch(/lib\/\*\* matches no file/);
  const res = outputOf(kit.writeAs(at, lesson, VALID_LESSON));
  expect(res.updatedInput.file_path).toBe(lesson);
  expect(res.updatedInput.content).toMatch(/^hits: 1$/m);
  expect(fs.readFileSync(path.join(w, ".repo/lessons/INDEX.md"), "utf8")).toContain("`plan-forks`");
  expect(fs.existsSync(path.join(r, ".rulesync"))).toBe(false);
});

it("validates a lesson Write in an unmanaged linked worktree outside the root", () => {
  const { r } = gitRepo(kit);
  const outside = path.join(fs.realpathSync(kit.temp("orch-linked-")), "linked");
  spawnSync("git", ["worktree", "add", "-q", outside, "-b", "linked"], { cwd: r });
  plantSource(outside);
  const lesson = path.join(outside, ".repo/lessons/plan-forks.md");
  const at = { cwd: outside, env: { CLAUDE_PROJECT_DIR: outside }, sid: "u1" };
  expect(outputOf(kit.writeAs(at, lesson, VALID_LESSON)).updatedInput.file_path).toBe(lesson);
  expect(fs.readFileSync(path.join(outside, ".repo/lessons/INDEX.md"), "utf8")).toContain("`plan-forks`");
  expect(fs.existsSync(path.join(r, ".rulesync"))).toBe(false);
});

it("hands a worktree lesson Write back in the worktree and indexes it there", () => {
  const { r, w } = gitRepo(kit);
  plantSource(w);
  const lesson = path.join(w, ".repo/lessons/plan-forks.md");
  const at = { cwd: w, env: { CLAUDE_PROJECT_DIR: r }, sid: "s4" };
  expect(outputOf(kit.writeAs(at, lesson, VALID_LESSON)).updatedInput.file_path).toBe(lesson);
  expect(fs.readFileSync(path.join(w, ".repo/lessons/INDEX.md"), "utf8")).toContain("`plan-forks`");
  expect(fs.existsSync(path.join(r, ".repo/lessons/INDEX.md"))).toBe(false);
});
