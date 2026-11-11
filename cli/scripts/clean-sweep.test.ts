import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { clean, cleanDirs, DEAD, exists, HOUR, LIVE, NOW, planter, sweepRepo } from "./fixtures/clean-kit.ts";

const tempDir = cleanDirs();

const GONE = [
  ".tmp/repo/old.log",
  ".tmp/repo/review",
  `.tmp/repo/sessions/${DEAD}`,
  `.tmp/repo/orchestrator-logs/ask-stop-${DEAD}`,
  ".tmp/repo/orchestrator-logs/ask-stop-default",
  ".tmp/repo/stash/old.txt",
];
const KEPT = [
  ".tmp/repo/plans/1-a-20261103T000000Z.md",
  ".tmp/repo/roadmaps/1-r-20261103T000000Z.md",
  ".tmp/repo/handoffs/1-h-20261103T000000Z.md",
  ".tmp/repo/implementations/1-i-20261103T000000Z.md",
  ".tmp/repo/3-notes-20261103T120000Z.md",
  ".tmp/repo/new.log",
  `.tmp/repo/sessions/${LIVE}/wrote.txt`,
  `.tmp/repo/orchestrator-logs/ask-stop-${LIVE}`,
  ".tmp/repo/stash/new.txt",
  ".tmp/repo/browser/session.json",
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
  expect(exists(root)(".tmp/repo/old.log")).toBe(true);
  expect(lines).toContain(".tmp/repo/old.log");
  expect(lines).toContain(".tmp/repo/review");
  expect(lines).toContain(`.tmp/repo/sessions/${DEAD}`);
  expect(lines).toContain(".tmp/repo/stash/old.txt");
  expect(lines.some((l) => l.includes("plans/"))).toBe(false);
  expect(lines.some((l) => l.startsWith("would remove "))).toBe(true);
  expect(lines.some((l) => l.startsWith("would keep "))).toBe(true);
});

it("repo clean removes stray nested .tmp/repo dirs and keeps one that holds plans", () => {
  const root = sweepRepo(tempDir);
  const put = planter(root);
  put("packages/a/.tmp/repo/sessions/x/wrote.txt", 2 * HOUR);
  put("packages/b/.tmp/repo/plans/1-x.md", 2 * HOUR);
  const { lines } = clean(root);
  expect(exists(root)("packages/a/.tmp/repo")).toBe(false);
  expect(exists(root)("packages/b/.tmp/repo/plans/1-x.md")).toBe(true);
  expect(lines).toContain("kept nested packages/b/.tmp/repo: holds plans");
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
  const link = path.join(root, ".tmp/repo/linked");
  fs.symlinkSync(outside, link, "dir");
  fs.lutimesSync(link, new Date(NOW - 2 * HOUR), new Date(NOW - 2 * HOUR));
  clean(root);
  expect(fs.existsSync(link)).toBe(false);
  expect(fs.existsSync(path.join(outside, "keep.txt"))).toBe(true);
});

it("repo clean outside git cleans the given root and skips the nested scan", () => {
  const root = tempDir("repo-clean-nogit-");
  planter(root)(".tmp/repo/old.log", 2 * HOUR);
  const { code } = clean(root);
  expect(code).toBe(0);
  expect(exists(root)(".tmp/repo/old.log")).toBe(false);
});
