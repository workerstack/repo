import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import {
  clean,
  cleanDirs,
  DEAD,
  exists,
  gitInit,
  HOUR,
  LIVE,
  NOW,
  planter,
  sweepRepo,
} from "./__fixtures__/clean-kit.ts";

const tempDir = cleanDirs();

const GONE = [
  ".repo/scratch/old.log",
  ".repo/scratch/review",
  `.repo/tmp/sessions/${DEAD}`,
  `.repo/tmp/orchestrator-logs/ask-stop-${DEAD}`,
  ".repo/tmp/orchestrator-logs/ask-stop-default",
  ".repo/tmp/stash/old.txt",
];

const KEPT = [
  ".repo/plans/1-a-20261103T000000Z.md",
  ".repo/roadmaps/1-r-20261103T000000Z.md",
  ".repo/handoffs/1-h-20261103T000000Z.md",
  ".repo/implementations/1-i-20261103T000000Z.md",
  ".repo/scratch/3-notes-20261103T120000Z.md",
  ".repo/scratch/new.log",
  `.repo/tmp/sessions/${LIVE}/wrote.txt`,
  `.repo/tmp/orchestrator-logs/ask-stop-${LIVE}`,
  ".repo/tmp/stash/new.txt",
  ".repo/tmp/browser/session.json",
];

it("repo clean removes agent scratch, dead sessions, stale stamps and old stash; keeps what repo owns", () => {
  const root = sweepRepo(tempDir);
  const has = exists(root);
  const { code, lines } = clean(root);
  expect(code).toBe(0);

  for (const gone of GONE) expect(has(gone), gone).toBe(false);

  for (const kept of KEPT) expect(has(kept), kept).toBe(true);
  expect(lines.some((l) => l.startsWith("removed "))).toBe(true);
  expect(lines.some((l) => l.startsWith("kept "))).toBe(true);
});

it("repo clean --dry-run lists what it would remove and deletes nothing", () => {
  const root = sweepRepo(tempDir);
  const { code, lines } = clean(root, true);
  expect(code).toBe(0);
  expect(exists(root)(".repo/scratch/old.log")).toBe(true);
  expect(lines).toContain(".repo/scratch/old.log");
  expect(lines).toContain(".repo/scratch/review");
  expect(lines).toContain(`.repo/tmp/sessions/${DEAD}`);
  expect(lines).toContain(".repo/tmp/stash/old.txt");
  expect(lines.some((l) => l.includes("plans/"))).toBe(false);
  expect(lines.some((l) => l.startsWith("would remove "))).toBe(true);
  expect(lines.some((l) => l.startsWith("would keep "))).toBe(true);
});

it("repo clean removes stray nested ignored .repo dirs and keeps one that holds plans", () => {
  const root = sweepRepo(tempDir);
  const put = planter(root);
  put("packages/a/.repo/tmp/sessions/x/wrote.txt", 2 * HOUR);
  put("packages/b/.repo/plans/1-x.md", 2 * HOUR);
  const { lines } = clean(root);
  expect(exists(root)("packages/a/.repo/tmp")).toBe(false);
  expect(exists(root)("packages/b/.repo/plans/1-x.md")).toBe(true);
  expect(lines).toContain("kept nested packages/b/.repo/plans: holds plans");
});

it("repo clean keeps the committed .repo files and reports an empty sweep against .repo", () => {
  const root = tempDir("repo-clean-committed-");
  gitInit(root);
  const put = planter(root);

  const committed = [
    ".repo/backlog.md",
    ".repo/lessons/x.md",
    ".repo/lint-baseline.json",
    ".repo/test-times.json",
    ".repo/rules/a.md",
    ".repo/skills/s/SKILL.md",
    ".repo/settings/s.json",
    ".repo/tmp/sync.json",
    ".repo/tmp/stage/x",
  ];

  for (const rel of committed) put(rel, 90 * 24 * HOUR);
  put("packages/a/.repo/lessons/y.md", 90 * 24 * HOUR);
  const { code, lines } = clean(root);
  expect(code).toBe(0);
  expect(lines[0]).toBe("removed 0 entries from .repo");

  for (const rel of [...committed, "packages/a/.repo/lessons/y.md"]) expect(exists(root)(rel), rel).toBe(true);
});

it("repo clean removes a stale stray file and a stale stray dir under .repo/tmp", () => {
  const root = tempDir("repo-clean-stray-");
  gitInit(root);
  const put = planter(root);
  put(".repo/tmp/stray.txt", 2 * HOUR);
  put(".repo/tmp/stray-dir/x", 2 * HOUR);
  fs.utimesSync(path.join(root, ".repo/tmp/stray-dir"), new Date(NOW - 2 * HOUR), new Date(NOW - 2 * HOUR));
  const { code } = clean(root);
  expect(code).toBe(0);
  expect(exists(root)(".repo/tmp/stray.txt")).toBe(false);
  expect(exists(root)(".repo/tmp/stray-dir")).toBe(false);
});

it("repo clean converges: a second run removes nothing and exits 0", () => {
  const root = sweepRepo(tempDir);
  clean(root);
  const again = clean(root);
  expect(again.code).toBe(0);
  expect(again.lines[0]).toMatch(/^removed 0 /);
});

it("repo clean removes a symlink as a link and leaves its target", () => {
  const root = sweepRepo(tempDir);
  const outside = tempDir("repo-clean-target-");
  fs.writeFileSync(path.join(outside, "keep.txt"), "x");
  const link = path.join(root, ".repo/scratch/linked");
  fs.symlinkSync(outside, link, "dir");
  fs.lutimesSync(link, new Date(NOW - 2 * HOUR), new Date(NOW - 2 * HOUR));
  clean(root);
  expect(fs.existsSync(link)).toBe(false);
  expect(fs.existsSync(path.join(outside, "keep.txt"))).toBe(true);
});

it("repo clean outside git cleans the given root and skips the nested scan", () => {
  const root = tempDir("repo-clean-nogit-");
  planter(root)(".repo/scratch/old.log", 2 * HOUR);
  const { code } = clean(root);
  expect(code).toBe(0);
  expect(exists(root)(".repo/scratch/old.log")).toBe(false);
});
