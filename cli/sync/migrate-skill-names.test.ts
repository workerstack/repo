import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { put } from "./__fixtures__/temp-dirs.ts";
import { applyMigration } from "./apply-migration.ts";
import { planSkillRename, renameSkills } from "./migrate-skill-names.ts";
import { conflictLines } from "./migrate.ts";

const { tempDir } = useTempDirs("migrate-skill-names-");

/** The text at `rel` under `root`. */
function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("renameSkills", () => {
  it("adds -deep to each of the four names and leaves the fast skills and other words", () => {
    const text = "run /write-plan, then `implement-plan 4`; write-roadmap and implement-roadmap.\n";

    expect(renameSkills(text)).toBe(
      "run /write-plan-deep, then `implement-plan-deep 4`; write-roadmap-deep and implement-roadmap-deep.\n",
    );
    expect(renameSkills("write-plan-fast implement-roadmap-fast rewrite-plan write-plans\n")).toBe(
      "write-plan-fast implement-roadmap-fast rewrite-plan write-plans\n",
    );
    expect(renameSkills(renameSkills(text))).toBe(renameSkills(text));
  });
});

/** The line the rename prints for `count` files. */
function renamed(count: string): string {
  return (
    "renamed write-plan, write-roadmap, implement-plan and implement-roadmap to their -deep names " +
    `in ${count} under .repo`
  );
}

describe("planSkillRename", () => {
  it("renames the names in plans, handoffs and lessons, and a rerun plans nothing", async () => {
    const root = tempDir();
    put(root, ".repo/plans/1-a.md", "Written with /write-plan.\n");
    put(root, ".repo/handoffs/h.md", "next: implement-plan 4\n");
    put(root, ".repo/lessons/sub/l.md", "write-roadmap splits it\n");

    expect(await applyMigration(root, planSkillRename(root))).toStrictEqual([`repo sync: ${renamed("3 files")}`]);
    expect(read(root, ".repo/plans/1-a.md")).toBe("Written with /write-plan-deep.\n");
    expect(read(root, ".repo/handoffs/h.md")).toBe("next: implement-plan-deep 4\n");
    expect(read(root, ".repo/lessons/sub/l.md")).toBe("write-roadmap-deep splits it\n");
    expect(planSkillRename(root)).toStrictEqual([]);
  });

  it("leaves the fast skills, .repo/tmp, other files and files outside .repo", () => {
    const root = tempDir();
    put(root, ".repo/plans/2-fast.md", "Written with /write-plan-fast.\n");
    put(root, ".repo/plans/notes.txt", "write-plan\n");
    put(root, ".repo/tmp/state.md", "write-plan\n");
    put(root, ".repo/tmp/deep/state.md", "write-plan\n");
    put(root, "docs/x.md", "write-plan\n");

    expect(planSkillRename(root)).toStrictEqual([]);
  });

  it("words one file in the singular", () => {
    const root = tempDir();
    put(root, ".repo/plans/a.md", "write-plan\n");

    expect(planSkillRename(root)).toMatchObject([{ note: renamed("1 file") }]);
  });

  it("plans nothing without .repo", () => {
    expect(planSkillRename(tempDir())).toStrictEqual([]);
  });
});

const SKILL = "---\nname: write-plan\noverrides: write-plan\ndescription: mine\n---\nRun write-plan-fast less.\n";

describe("planSkillRename of an override skill", () => {
  it("moves .repo/skills/write-plan to write-plan-deep with its name and overrides rewritten", async () => {
    const root = tempDir();
    put(root, ".repo/skills/write-plan/SKILL.md", SKILL);
    put(root, ".repo/skills/write-plan/notes.txt", "kept\n");
    const lines = await applyMigration(root, planSkillRename(root));

    expect(lines).toStrictEqual([
      `repo sync: ${renamed("1 file")}`,
      "repo sync: moved .repo/skills/write-plan to .repo/skills/write-plan-deep",
    ]);
    expect(read(root, ".repo/skills/write-plan-deep/SKILL.md")).toBe(
      "---\nname: write-plan-deep\noverrides: write-plan-deep\ndescription: mine\n---\nRun write-plan-fast less.\n",
    );
    expect(read(root, ".repo/skills/write-plan-deep/notes.txt")).toBe("kept\n");
    expect(fs.existsSync(path.join(root, ".repo/skills/write-plan"))).toBe(false);
    expect(planSkillRename(root)).toStrictEqual([]);
  });
});

describe("planSkillRename with both skill dirs", () => {
  it("stops on a conflict and changes nothing", async () => {
    const root = tempDir();
    put(root, ".repo/skills/implement-plan/SKILL.md", "---\nname: implement-plan\n---\nold\n");
    put(root, ".repo/skills/implement-plan-deep/SKILL.md", "---\nname: implement-plan-deep\n---\nnew\n");
    const steps = planSkillRename(root);

    expect(conflictLines(steps)).toStrictEqual([
      "repo sync: cannot move .repo/skills/implement-plan: .repo/skills/implement-plan-deep already exists and " +
        "differs; merge them by hand, then run `bun repo sync`",
    ]);
    await applyMigration(root, steps);
    const kept = [".repo/skills/implement-plan/SKILL.md", ".repo/skills/implement-plan-deep/SKILL.md"];

    expect(kept.map((rel) => read(root, rel))).toStrictEqual([
      "---\nname: implement-plan\n---\nold\n",
      "---\nname: implement-plan-deep\n---\nnew\n",
    ]);
  });
});
