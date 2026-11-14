import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { put } from "./__fixtures__/temp-dirs.ts";
import { applyMigration } from "./apply-migration.ts";
import { planStrategyRename, relativeSlash, renameStrategies } from "./migrate-strategy-name.ts";

const NOTE_HEAD = "renamed strategy review-fast to spawn-fast, review-deep to spawn-deep and default to free";
const { tempDir } = useTempDirs("migrate-strategy-name-");

describe("renameStrategies doc", () => {
  it("maps the strategy line of the leading frontmatter only", () => {
    const text = "---\nstrategy: review-fast\n---\n\nstrategy: review-fast\n```\nstrategy: review-deep\n```\n";

    expect(renameStrategies(text, "doc")).toBe(
      "---\nstrategy: spawn-fast\n---\n\nstrategy: review-fast\n```\nstrategy: review-deep\n```\n",
    );
  });

  it("maps review-deep and leaves other keys, spawn values and prose", () => {
    const text = "---\nstrategy: review-deep\nnote: strategy: review-fast\n---\nbody\n";

    expect(renameStrategies(text, "doc")).toBe("---\nstrategy: spawn-deep\nnote: strategy: review-fast\n---\nbody\n");
    expect(renameStrategies("---\nstrategy: spawn-fast\n---\n", "doc")).toBe("---\nstrategy: spawn-fast\n---\n");
  });

  it("leaves text without leading frontmatter or without a close", () => {
    expect(renameStrategies("\n---\nstrategy: review-fast\n---\n", "doc")).toBe("\n---\nstrategy: review-fast\n---\n");
    expect(renameStrategies("---\nstrategy: review-fast\n", "doc")).toBe("---\nstrategy: review-fast\n");
  });

  it("is idempotent and handles CRLF", () => {
    const once = renameStrategies("---\r\nstrategy: review-fast\r\n---\r\n", "doc");

    expect(once).toBe("---\r\nstrategy: spawn-fast\r\n---\r\n");
    expect(renameStrategies(once, "doc")).toBe(once);
  });
});

describe("renameStrategies default to free", () => {
  it("maps plain and quoted frontmatter, and a rerun changes nothing", () => {
    const plain = renameStrategies("---\nstrategy: default\n---\nbody\n", "doc");
    const quoted = renameStrategies('---\nstrategy: "default"\n---\nbody\n', "doc");

    expect(plain).toBe("---\nstrategy: free\n---\nbody\n");
    expect(quoted).toBe('---\nstrategy: "free"\n---\nbody\n');
    expect(renameStrategies(plain, "doc")).toBe(plain);
  });

  it("leaves a plan body line with default", () => {
    const text = "---\nstrategy: free\n---\nstrategy: default\nthe default\n";

    expect(renameStrategies(text, "doc")).toBe(text);
  });

  it("maps parenthesised handoff mentions and leaves prose, rerun-stable", () => {
    const once = renameStrategies("a (strategy: default) b (strategy default written) c (strategy default)", "handoff");

    expect(once).toBe("a (strategy: free) b (strategy free written) c (strategy free)");
    expect(renameStrategies(once, "handoff")).toBe(once);
    expect(renameStrategies("(we kept the strategy default)", "handoff")).toBe("(we kept the strategy default)");
  });
});

describe("renameStrategies handoff", () => {
  it("maps parenthesised strategies", () => {
    expect(renameStrategies("a (strategy: review-deep) b (strategy review-fast written)", "handoff")).toBe(
      "a (strategy: spawn-deep) b (strategy spawn-fast written)",
    );
  });

  it("leaves prose outside parens, spawn values, and is idempotent", () => {
    const text = "strategy: review-fast in the plan (strategy: spawn-fast)";

    expect(renameStrategies(text, "handoff")).toBe(text);
    const once = renameStrategies("(strategy: review-fast)", "handoff");

    expect(renameStrategies(once, "handoff")).toBe(once);
  });
});

describe("relativeSlash", () => {
  it("joins with / whatever the platform separator", () => {
    expect(relativeSlash("C:\\r", "C:\\r\\.repo\\plans\\a.md", path.win32)).toBe(".repo/plans/a.md");
    expect(relativeSlash("/r", "/r/.repo/plans/a.md", path.posix)).toBe(".repo/plans/a.md");
  });
});

describe("planStrategyRename", () => {
  it("lists changed plans, roadmaps and handoffs, sorted, skipping others", () => {
    const root = tempDir();
    put(root, ".repo/plans/b.md", "---\nstrategy: review-fast\n---\n");
    put(root, ".repo/plans/a.md", "---\nstrategy: review-deep\n---\n");
    put(root, ".repo/plans/same.md", "---\nstrategy: spawn-fast\n---\n");
    put(root, ".repo/plans/x.txt", "---\nstrategy: review-fast\n---\n");
    put(root, ".repo/roadmaps/r.md", "---\nstrategy: review-fast\n---\n");
    put(root, ".repo/handoffs/h.md", "done (strategy: review-deep)\n");
    put(root, ".repo/implementations/i.md", "---\nstrategy: review-fast\n---\n");
    put(root, ".repo/scratch/s.md", "---\nstrategy: review-fast\n---\n");
    const steps = planStrategyRename(root);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "rename-text",
      note:
        "renamed strategy review-fast to spawn-fast, review-deep to spawn-deep and default to free in 4 files " +
        "under .repo",
      paths: [".repo/handoffs/h.md", ".repo/plans/a.md", ".repo/plans/b.md", ".repo/roadmaps/r.md"],
    });
  });

  it("words one file in the singular", () => {
    const root = tempDir();
    put(root, ".repo/plans/a.md", "---\nstrategy: review-deep\n---\n");

    expect(planStrategyRename(root)[0]).toMatchObject({ note: `${NOTE_HEAD} in 1 file under .repo` });
  });
});

describe("planStrategyRename with nothing to change", () => {
  it("plans nothing without .repo or without a change", () => {
    const root = tempDir();

    expect(planStrategyRename(root)).toStrictEqual([]);
    put(root, ".repo/plans/a.md", "---\nstrategy: spawn-fast\n---\n");
    put(root, ".repo/plans/sub/b.md", "---\nstrategy: review-fast\n---\n");
    fs.mkdirSync(path.join(root, ".repo/handoffs"));

    expect(planStrategyRename(root)).toStrictEqual([]);
  });
});

describe("the rename-text strategy step", () => {
  it("applies the step and plans nothing the second time", async () => {
    const root = tempDir();
    put(root, ".repo/plans/a.md", "---\nstrategy: review-deep\n---\nstrategy: review-deep\n");
    put(root, ".repo/handoffs/h.md", "(strategy review-fast written)\n");
    const lines = await applyMigration(root, planStrategyRename(root));

    expect(lines).toStrictEqual([
      "repo sync: renamed strategy review-fast to spawn-fast, review-deep to spawn-deep and default to free " +
        "in 2 files under .repo",
    ]);
    expect(fs.readFileSync(path.join(root, ".repo/plans/a.md"), "utf8")).toBe(
      "---\nstrategy: spawn-deep\n---\nstrategy: review-deep\n",
    );
    expect(fs.readFileSync(path.join(root, ".repo/handoffs/h.md"), "utf8")).toBe("(strategy spawn-fast written)\n");
    expect(planStrategyRename(root)).toStrictEqual([]);
  });
});
