import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useGitTree } from "../__fixtures__/git-tree.ts";
import { changedFiles, firstChanged } from "./changed.ts";

const tree = useGitTree("eval-changed-");

function git(dir: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.email=a@example.com", "-c", "user.name=a", ...args], { cwd: dir, stdio: "ignore" });
}

/** A repo whose `main` holds a.txt and b.txt, on a branch `work` that edits more after it forks. */
function forked(): string {
  const dir = tree.repoWith({ "a.txt": "a\n", "b.txt": "b\n", "c.txt": "c\n" });
  git(dir, "commit", "-qm", "base");
  git(dir, "branch", "-M", "main");
  git(dir, "checkout", "-qb", "work");
  fs.writeFileSync(path.join(dir, "a.txt"), "a on the branch\n");
  git(dir, "commit", "-qam", "branch edit");
  git(dir, "checkout", "-q", "main");
  fs.writeFileSync(path.join(dir, "c.txt"), "c on main after the fork\n");
  git(dir, "commit", "-qam", "main edit");
  git(dir, "checkout", "-q", "work");
  fs.writeFileSync(path.join(dir, "b.txt"), "b uncommitted\n");
  fs.mkdirSync(path.join(dir, "new"));
  fs.writeFileSync(path.join(dir, "new", "d.txt"), "untracked\n");

  return dir;
}

describe("changedFiles", () => {
  it("lists a branch commit, an uncommitted edit and an untracked file, not a later edit on the base", () => {
    expect(changedFiles(forked(), "main")?.toSorted()).toStrictEqual(["a.txt", "b.txt", "new/d.txt"]);
  });

  it("gives null for a base git cannot diff against", () => {
    expect(changedFiles(forked(), "nope")).toBeNull();
  });
});

describe("firstChanged", () => {
  const files = ["agents/skills", "cli/eval/first-word-is.ts"];

  it.each([
    [["README.md", "cli/eval/first-word-is.ts"], "cli/eval/first-word-is.ts"],
    [["agents/skills/su/SKILL.md"], "agents/skills/su/SKILL.md"],
    [["evals/skill-routing/cases.ts"], "evals/skill-routing/cases.ts"],
  ])("finds the first of %j that it reads: %s", (changed, found) => {
    expect(firstChanged("skill-routing", files, changed)).toBe(found);
  });

  it("finds nothing in a path that only starts the same, another eval or an unlisted file", () => {
    const changed = ["agents/skills-old/x.md", "evals/skill-routing-2/eval.ts", "cli/eval/first-line.test.ts"];

    expect(firstChanged("skill-routing", files, changed)).toBeUndefined();
  });
});
