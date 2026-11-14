import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { put } from "./__fixtures__/temp-dirs.ts";
import { applyMigration } from "./apply-migration.ts";
import { planApprovalRename, renameApproval } from "./migrate-approval-name.ts";

const { tempDir } = useTempDirs("migrate-approval-name-");

describe("renameApproval", () => {
  it("renames the mode line of the leading frontmatter only, auto becoming ask", () => {
    const text = "---\nstrategy: free\nmode: auto\n---\n\nmode: auto\n```\nmode: auto\n```\n";

    expect(renameApproval(text)).toBe("---\nstrategy: free\napproval: ask\n---\n\nmode: auto\n```\nmode: auto\n```\n");
  });

  it("keeps the value of away and ask", () => {
    expect(renameApproval("---\nmode: away\n---\n")).toBe("---\napproval: away\n---\n");
    expect(renameApproval("---\nmode: ask\n---\n")).toBe("---\napproval: ask\n---\n");
  });

  it("leaves other keys, unknown values and text without leading frontmatter", () => {
    expect(renameApproval("---\nnote: mode: auto\nmode: automatic\n---\n")).toBe(
      "---\nnote: mode: auto\nmode: automatic\n---\n",
    );
    expect(renameApproval("---\nstrategy: free\n---\nbody\n")).toBe("---\nstrategy: free\n---\nbody\n");
    expect(renameApproval("\n---\nmode: auto\n---\n")).toBe("\n---\nmode: auto\n---\n");
    expect(renameApproval("---\nmode: auto\n")).toBe("---\nmode: auto\n");
  });

  it("handles CRLF and trailing blanks, and a rerun changes nothing", () => {
    const once = renameApproval("---\r\nmode:  auto \r\n---\r\n");

    expect(once).toBe("---\r\napproval: ask\r\n---\r\n");
    expect(renameApproval(once)).toBe(once);
  });
});

describe("planApprovalRename", () => {
  it("lists changed plans and roadmaps, sorted, and skips the rest", () => {
    const root = tempDir();
    put(root, ".repo/plans/b.md", "---\nmode: auto\n---\n");
    put(root, ".repo/plans/a.md", "---\nmode: away\n---\n");
    put(root, ".repo/plans/none.md", "---\nstrategy: free\n---\nmode: auto\n");
    put(root, ".repo/plans/x.txt", "---\nmode: auto\n---\n");
    put(root, ".repo/plans/sub/c.md", "---\nmode: auto\n---\n");
    put(root, ".repo/roadmaps/r.md", "---\nmode: ask\n---\n");
    put(root, ".repo/handoffs/h.md", "---\nmode: auto\n---\n");

    expect(planApprovalRename(root)).toStrictEqual([
      {
        kind: "rename-text",
        note: "renamed mode to approval in 3 files under .repo",
        paths: [".repo/plans/a.md", ".repo/plans/b.md", ".repo/roadmaps/r.md"],
        rename: "approval",
      },
    ]);
  });

  it("words one file in the singular", () => {
    const root = tempDir();
    put(root, ".repo/plans/a.md", "---\nmode: auto\n---\n");

    expect(planApprovalRename(root)[0]).toMatchObject({ note: "renamed mode to approval in 1 file under .repo" });
  });
});

describe("planApprovalRename with nothing to change", () => {
  it("plans nothing without .repo, without a change or with an empty dir", () => {
    const root = tempDir();

    expect(planApprovalRename(root)).toStrictEqual([]);
    put(root, ".repo/plans/a.md", "---\napproval: away\n---\n");
    fs.mkdirSync(path.join(root, ".repo/roadmaps"));

    expect(planApprovalRename(root)).toStrictEqual([]);
  });
});

describe("the rename-text approval step", () => {
  it("applies the step, leaves handoffs and bodies, and plans nothing the second time", async () => {
    const root = tempDir();
    put(root, ".repo/plans/a.md", "---\nmode: auto\n---\nmode: auto\n");
    put(root, ".repo/roadmaps/r.md", "---\nmode: away\n---\n");
    put(root, ".repo/handoffs/h.md", "---\nmode: auto\n---\n");
    const lines = await applyMigration(root, planApprovalRename(root));

    expect(lines).toStrictEqual(["repo sync: renamed mode to approval in 2 files under .repo"]);
    expect(fs.readFileSync(path.join(root, ".repo/plans/a.md"), "utf8")).toBe("---\napproval: ask\n---\nmode: auto\n");
    expect(fs.readFileSync(path.join(root, ".repo/roadmaps/r.md"), "utf8")).toBe("---\napproval: away\n---\n");
    expect(fs.readFileSync(path.join(root, ".repo/handoffs/h.md"), "utf8")).toBe("---\nmode: auto\n---\n");
    expect(planApprovalRename(root)).toStrictEqual([]);
  });
});
