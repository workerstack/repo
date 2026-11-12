import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { age, clean, cleanDirs, DAY, exists, gitInit, planter } from "./__fixtures__/clean-kit.ts";
import { nextSerial } from "./persist-doc.ts";

const tempDir = cleanDirs();
const OLD = 40 * DAY;
const T = ".tmp/repo";

function fm(status: string) {
  return `---\nserial: 1\nstatus: ${status}\n---\n\n# x\n`;
}

function plan(n: number) {
  return `${T}/plans/${n}-p${n}-20260901T000000Z.md`;
}

/** Plans of every age and status, a stray non-markdown file, and two roadmaps, one pinning plan 3. */
function plantPlans(root: string, put: ReturnType<typeof planter>): void {
  put(plan(1), OLD, fm("done"));
  put(plan(2), OLD, fm("ready"));
  put(plan(3), OLD, fm("done"));
  put(plan(4), DAY, fm("done"));
  put(plan(5), OLD, "# no frontmatter\n");
  put(plan(6), OLD, fm("done"));
  put(`${T}/plans/9-x.txt`, OLD);
  put(`${T}/roadmaps/1-r1-20260901T000000Z.md`, OLD, fm("done"));
  const pin = `${fm("in-progress")}\n## Order\n1 [x] Title: a\n      Location: ${path.join(root, plan(3))}\n`;
  put(`${T}/roadmaps/2-r2-20260901T000000Z.md`, OLD, pin);
}

/** A repo whose durable files are all 40 days old but for plan 4. */
function aged(): string {
  const root = tempDir("repo-age-");
  gitInit(root);
  const put = planter(root);
  plantPlans(root, put);
  put(`${T}/implementations/1-i1-20260901T000000Z.md`, OLD, fm("done"));
  put(`${T}/implementations/2-i2-20260901T000000Z.md`, OLD, fm("in-progress"));
  put(`${T}/implementations/3-i3-20260901T000000Z.md`, OLD, fm("done"));
  put(`${T}/handoffs/1-h1-20260901T000000Z.md`, OLD, fm("open"));
  put(`${T}/handoffs/2-h2-20260901T000000Z.md`, OLD, fm("done"));
  put(`${T}/1-a-20260901T000000Z.md`, OLD);
  put(`${T}/2-b-20260901T000000Z.md`, OLD);

  for (const d of ["plans", "roadmaps", "implementations", "handoffs"]) age(path.join(root, T, d), OLD);
  age(path.join(root, plan(4)), DAY);

  return root;
}

const GONE = [
  ".tmp/repo/plans/1-p1-20260901T000000Z.md",
  ".tmp/repo/roadmaps/1-r1-20260901T000000Z.md",
  ".tmp/repo/implementations/1-i1-20260901T000000Z.md",
  ".tmp/repo/handoffs/1-h1-20260901T000000Z.md",
  ".tmp/repo/1-a-20260901T000000Z.md",
];

/** Every file under `dir`, at any depth. */
function all(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? all(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

/** Every file under .tmp/repo, root-relative and sorted. */
function files(root: string): string[] {
  return all(path.join(root, T))
    .map((p) => path.relative(root, p).split(path.sep).join("/"))
    .toSorted();
}

it("age-out removes finished repo files untouched for 30 days and keeps live work and the newest serials", () => {
  const root = aged();
  const before = files(root);
  const { code, lines } = clean(root);
  expect(code).toBe(0);
  expect(files(root)).toStrictEqual(before.filter((p) => !GONE.includes(p)));
  expect(lines.find((l) => l.startsWith("removed "))).toMatch(
    /^removed 1 old plan, 1 old roadmap, 1 old journal, 1 old handoff, 1 old tmp artifact \(/,
  );
  expect(nextSerial(path.join(root, ".tmp/repo/plans"))).toBe(7);
  expect(clean(root).lines[0]).toMatch(/^removed 0 entries/);
});

it("age-out --dry-run lists exactly the aged-out files and deletes nothing", () => {
  const root = aged();
  const { code, lines } = clean(root, true);
  expect(code).toBe(0);
  const summary = lines.findIndex((l) => l.startsWith("would remove "));
  expect(lines.slice(0, summary).toSorted()).toStrictEqual(GONE.toSorted());
  expect(lines[summary]).toMatch(
    /^would remove 1 old plan, 1 old roadmap, 1 old journal, 1 old handoff, 1 old tmp artifact \(/,
  );

  for (const p of GONE) expect(exists(root)(p), p).toBe(true);
});
