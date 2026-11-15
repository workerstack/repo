import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import {
  age,
  clean,
  cleanDirs,
  DEAD,
  exists,
  gitInit,
  DAY,
  HOUR,
  LIVE,
  NOW,
  planter,
  STALE_AGE,
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
  ".repo/tmp/evals/cache/old.json",
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
    ".repo/tmp/tsbuildinfo/tsconfig.json.tsbuildinfo",
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
  put(".repo/tmp/stray.txt", STALE_AGE);
  put(".repo/tmp/stray-dir/x", STALE_AGE);
  fs.utimesSync(path.join(root, ".repo/tmp/stray-dir"), new Date(NOW - STALE_AGE), new Date(NOW - STALE_AGE));
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
  fs.lutimesSync(link, new Date(NOW - STALE_AGE), new Date(NOW - STALE_AGE));
  clean(root);
  expect(fs.existsSync(link)).toBe(false);
  expect(fs.existsSync(path.join(outside, "keep.txt"))).toBe(true);
});

it("repo clean outside git cleans the given root and skips the nested scan", () => {
  const root = tempDir("repo-clean-nogit-");
  planter(root)(".repo/scratch/old.log", STALE_AGE);
  const { code } = clean(root);
  expect(code).toBe(0);
  expect(exists(root)(".repo/scratch/old.log")).toBe(false);
});

/** Loose entries of every kind the 2-day window covers, named by `when`, aged `ms`; their paths. */
function plantLoose(root: string, { when, sid, ms }: { when: string; sid: string; ms: number }): string[] {
  const put = planter(root);
  const session = `.repo/tmp/sessions/${sid}`;
  const files = [`.repo/scratch/${when}.log`, `.repo/tmp/${when}.txt`, `.repo/tmp/orchestrator-logs/ask-stop-${when}`];

  for (const rel of [...files, `${session}/wrote.txt`]) put(rel, ms);
  age(path.join(root, session), ms);

  return [...files, session];
}

it("repo clean keeps loose state touched 1 day ago and removes it at 3 days", () => {
  const root = tempDir("repo-clean-window-");
  gitInit(root);
  const day = plantLoose(root, { ms: DAY, sid: "33333333-aaaa-4bbb-8ccc-000000000003", when: "day" });
  const old = plantLoose(root, { ms: STALE_AGE, sid: DEAD, when: "old" });
  clean(root);

  for (const rel of day) expect(exists(root)(rel), rel).toBe(true);

  for (const rel of old) expect(exists(root)(rel), rel).toBe(false);
});
