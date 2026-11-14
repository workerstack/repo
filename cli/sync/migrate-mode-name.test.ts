import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { put } from "./__fixtures__/temp-dirs.ts";
import { applyMigration } from "./apply-migration.ts";
import { planModeRename, renameMode } from "./migrate-mode-name.ts";

const { tempDir } = useTempDirs("migrate-mode-name-");

describe("renameMode", () => {
  it("maps the mode line of the leading frontmatter only", () => {
    const text = "---\nstrategy: free\nmode: auto\n---\n\nmode: auto\n```\nmode: auto\n```\n";

    expect(renameMode(text)).toBe("---\nstrategy: free\nmode: ask\n---\n\nmode: auto\n```\nmode: auto\n```\n");
  });

  it("leaves away, ask, other keys and text without frontmatter", () => {
    expect(renameMode("---\nmode: away\n---\n")).toBe("---\nmode: away\n---\n");
    expect(renameMode("---\nmode: ask\n---\n")).toBe("---\nmode: ask\n---\n");
    expect(renameMode("---\nnote: mode: auto\nmode: automatic\n---\n")).toBe(
      "---\nnote: mode: auto\nmode: automatic\n---\n",
    );
    expect(renameMode("\n---\nmode: auto\n---\n")).toBe("\n---\nmode: auto\n---\n");
    expect(renameMode("---\nmode: auto\n")).toBe("---\nmode: auto\n");
  });

  it("handles CRLF and trailing blanks, and a rerun changes nothing", () => {
    const once = renameMode("---\r\nmode:  auto \r\n---\r\n");

    expect(once).toBe("---\r\nmode: ask\r\n---\r\n");
    expect(renameMode(once)).toBe(once);
  });
});

describe("planModeRename", () => {
  it("lists changed plans and roadmaps, sorted, and skips the rest", () => {
    const root = tempDir();
    put(root, ".repo/plans/b.md", "---\nmode: auto\n---\n");
    put(root, ".repo/plans/a.md", "---\nmode: auto\n---\n");
    put(root, ".repo/plans/away.md", "---\nmode: away\n---\nmode: auto\n");
    put(root, ".repo/plans/x.txt", "---\nmode: auto\n---\n");
    put(root, ".repo/plans/sub/c.md", "---\nmode: auto\n---\n");
    put(root, ".repo/roadmaps/r.md", "---\nmode: auto\n---\n");
    put(root, ".repo/handoffs/h.md", "---\nmode: auto\n---\n");

    expect(planModeRename(root)).toStrictEqual([
      {
        kind: "rename-text",
        note: "renamed mode auto to ask in 3 files under .repo",
        paths: [".repo/plans/a.md", ".repo/plans/b.md", ".repo/roadmaps/r.md"],
        rename: "mode",
      },
    ]);
  });

  it("words one file in the singular", () => {
    const root = tempDir();
    put(root, ".repo/plans/a.md", "---\nmode: auto\n---\n");

    expect(planModeRename(root)[0]).toMatchObject({ note: "renamed mode auto to ask in 1 file under .repo" });
  });
});

describe("planModeRename with nothing to change", () => {
  it("plans nothing without .repo, without a change or with an empty dir", () => {
    const root = tempDir();

    expect(planModeRename(root)).toStrictEqual([]);
    put(root, ".repo/plans/a.md", "---\nmode: away\n---\n");
    fs.mkdirSync(path.join(root, ".repo/roadmaps"));

    expect(planModeRename(root)).toStrictEqual([]);
  });
});

describe("the rename-text mode step", () => {
  it("applies the step, leaves handoffs and bodies, and plans nothing the second time", async () => {
    const root = tempDir();
    put(root, ".repo/plans/a.md", "---\nmode: auto\n---\nmode: auto\n");
    put(root, ".repo/roadmaps/r.md", "---\nmode: auto\n---\n");
    put(root, ".repo/handoffs/h.md", "---\nmode: auto\n---\n");
    const lines = await applyMigration(root, planModeRename(root));

    expect(lines).toStrictEqual(["repo sync: renamed mode auto to ask in 2 files under .repo"]);
    expect(fs.readFileSync(path.join(root, ".repo/plans/a.md"), "utf8")).toBe("---\nmode: ask\n---\nmode: auto\n");
    expect(fs.readFileSync(path.join(root, ".repo/roadmaps/r.md"), "utf8")).toBe("---\nmode: ask\n---\n");
    expect(fs.readFileSync(path.join(root, ".repo/handoffs/h.md"), "utf8")).toBe("---\nmode: auto\n---\n");
    expect(planModeRename(root)).toStrictEqual([]);
  });
});
