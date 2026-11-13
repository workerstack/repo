import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CHECKOUT_STATE,
  IGNORED_DIRS,
  isIgnoredRepoPath,
  REPO,
  repoPath,
  routesToRoot,
  STATE_DIRS,
} from "./repo-dirs.ts";

const ROOT = path.resolve("/work/repo");
const WIN_ROOT = "C:\\work\\repo";

describe("repoPath", () => {
  it("joins the root, .repo and the segments", () => {
    expect(repoPath(ROOT, "plans", "a.md")).toBe(path.join(ROOT, REPO, "plans", "a.md"));
    expect(repoPath(ROOT)).toBe(path.join(ROOT, ".repo"));
  });
});

describe("IGNORED_DIRS", () => {
  it("holds the eight dirs", () => {
    expect([...IGNORED_DIRS].toSorted()).toStrictEqual(
      ["handoffs", "implementations", "plans", "plans-fast", "roadmaps", "roadmaps-fast", "scratch", "tmp"].toSorted(),
    );
    expect(STATE_DIRS.has("sessions")).toBe(true);
    expect(CHECKOUT_STATE.has("sync.json")).toBe(true);
  });
});

describe("isIgnoredRepoPath", () => {
  it.each([".repo/plans/x", ".repo/tmp/a", ".repo/scratch/n.md", ".repo/plans"])("is true for %s", (rel) => {
    expect(isIgnoredRepoPath(ROOT, path.join(ROOT, rel))).toBe(true);
  });

  it.each([".repo/lessons/x", ".repo/lint-baseline.json", ".tmp/x", ".repo", "plans/x"])("is false for %s", (rel) => {
    expect(isIgnoredRepoPath(ROOT, path.join(ROOT, rel))).toBe(false);
  });

  it("reads a C:\\ spelling", () => {
    const w = path.win32;

    expect(isIgnoredRepoPath(WIN_ROOT, "C:\\work\\repo\\.repo\\plans\\x", w)).toBe(true);
    expect(isIgnoredRepoPath(WIN_ROOT, "C:\\work\\repo\\.repo\\tmp\\a", w)).toBe(true);
    expect(isIgnoredRepoPath(WIN_ROOT, "C:\\work\\repo\\.repo\\lessons\\x", w)).toBe(false);
    expect(isIgnoredRepoPath(WIN_ROOT, "C:\\work\\repo\\.tmp\\x", w)).toBe(false);
    expect(isIgnoredRepoPath(WIN_ROOT, "D:\\other\\.repo\\plans\\x", w)).toBe(false);
  });
});

describe("routesToRoot", () => {
  it.each([".repo/plans/x", ".repo/tmp/sessions/x", ".repo/scratch/a", ".repo/tmp"])("is true for %s", (rel) => {
    expect(routesToRoot(ROOT, path.join(ROOT, rel))).toBe(true);
  });

  it.each([".repo/tmp/sync.json", ".repo/tmp/stage/x", ".repo/tmp/stage", ".repo/lessons/x"])(
    "is false for %s",
    (rel) => {
      expect(routesToRoot(ROOT, path.join(ROOT, rel))).toBe(false);
    },
  );

  it("reads a C:\\ spelling", () => {
    const w = path.win32;

    expect(routesToRoot(WIN_ROOT, "C:\\work\\repo\\.repo\\tmp\\sync.json", w)).toBe(false);
    expect(routesToRoot(WIN_ROOT, "C:\\work\\repo\\.repo\\tmp\\stage\\x", w)).toBe(false);
    expect(routesToRoot(WIN_ROOT, "C:\\work\\repo\\.repo\\plans\\x", w)).toBe(true);
    expect(routesToRoot(WIN_ROOT, "C:\\work\\repo\\.repo\\tmp\\sessions\\x", w)).toBe(true);
  });
});
