import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { aliasOf } from "../../dev/test-paths";
import { useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { realDir } from "./__fixtures__/real-dir.ts";
import { activeReviews, pruneStamps, sessionDir, stampPlan, stampedPlans, unstampPlan } from "./review-stamps.ts";

useTempDirs();

const NAME = "4-x-20261107T181901Z.md";

function writePlan(root: string, rel: string, fm: Record<string, string>): string {
  const abs = path.join(root, ".repo", rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  const head = Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  fs.writeFileSync(abs, `---\n${head}\n---\n\n# plan\n`);

  return abs;
}

/** A plan's frontmatter with `strategy` (left out when null) and `status`. */
function planFm(strategy: string | null, status = "in-progress") {
  return { name: "x", serial: "4", status, ...(strategy == null ? {} : { strategy }) };
}

/** The session's stamp folder. */
function reviewsDir(root: string, sid: string) {
  return path.join(sessionDir(root, sid), "reviews");
}

function stampWith(root: string, sid: string, body: string) {
  fs.mkdirSync(reviewsDir(root, sid), { recursive: true });
  fs.writeFileSync(path.join(reviewsDir(root, sid), "plan-odd.json"), body);
}

it("sessionDir keeps the sid inside the sessions dir", () => {
  const root = realDir("stamps-");
  expect(sessionDir(root, "abc-1")).toBe(path.join(root, ".repo", "tmp", "sessions", "abc-1"));
  expect(path.relative(path.join(root, ".repo", "tmp", "sessions"), sessionDir(root, "../../x")).startsWith("..")).toBe(
    false,
  );
});

it("reads an in-progress spawn plan as a plan and a fast plan as a fast-plan", () => {
  const root = realDir("stamps-");
  const plan = writePlan(root, `plans/${NAME}`, planFm("spawn-fast"));
  const fast = writePlan(root, `plans-fast/${NAME}`, planFm("spawn-deep"));
  stampPlan(root, "s1", fast);
  stampPlan(root, "s1", plan);

  expect(activeReviews(root, "s1")).toStrictEqual([
    { kind: "plan", plan, serial: 4, strategy: "spawn-fast" },
    { kind: "fast-plan", plan: fast, serial: 4, strategy: "spawn-deep" },
  ]);
  expect(fs.readdirSync(reviewsDir(root, "s1")).toSorted()).toStrictEqual([
    `fast-plan-${path.basename(NAME, ".md")}.json`,
    `plan-${path.basename(NAME, ".md")}.json`,
  ]);
});

it("reads no review for ready, done, blocked, free, a missing key, a missing plan or an unstamped session", () => {
  const root = realDir("stamps-");

  for (const [fm, label] of [
    [planFm("spawn-fast", "ready"), "ready"],
    [planFm("spawn-fast", "done"), "done"],
    [planFm("spawn-fast", "blocked"), "blocked"],
    [planFm("free"), "free"],
    [planFm(null), "nokey"],
  ] as const) {
    stampPlan(root, label, writePlan(root, `plans/4-${label}-20261107T181901Z.md`, fm));
    expect(activeReviews(root, label), label).toStrictEqual([]);
  }

  stampPlan(root, "gone", path.join(root, ".repo", "plans", "9-gone-20261107T181901Z.md"));
  expect(activeReviews(root, "gone")).toStrictEqual([]);
  expect(activeReviews(root, "never-stamped")).toStrictEqual([]);
});

it("ignores an old strategy.json and odd stamp bodies", () => {
  const root = realDir("stamps-");
  const plan = writePlan(root, `plans/${NAME}`, planFm("spawn-fast"));
  fs.mkdirSync(sessionDir(root, "old"), { recursive: true });
  fs.writeFileSync(path.join(sessionDir(root, "old"), "strategy.json"), JSON.stringify({ plan }));
  expect(activeReviews(root, "old")).toStrictEqual([]);

  for (const [i, body] of ["5", "null", "{}", '{"plan": 7}', "{not json"].entries()) {
    stampWith(root, `s${i}`, body);
    expect(stampedPlans(root, `s${i}`), body).toStrictEqual([]);
    expect(activeReviews(root, `s${i}`), body).toStrictEqual([]);
  }
});

it("reads no review when the stamp folder cannot be read", () => {
  const root = realDir("stamps-");
  fs.mkdirSync(sessionDir(root, "s1"), { recursive: true });
  fs.writeFileSync(reviewsDir(root, "s1"), "a file where the folder belongs");
  expect(activeReviews(root, "s1")).toStrictEqual([]);
});

it("skips frontmatter lines that are not key: value, and a plan with no frontmatter", () => {
  const root = realDir("stamps-");
  const plan = path.join(root, "plan.md");
  fs.writeFileSync(plan, "---\n# note\n\nserial: 3\nstatus: in-progress\nstrategy: spawn-deep\n---\n");
  stampPlan(root, "s1", plan);
  expect(activeReviews(root, "s1")).toStrictEqual([{ kind: "plan", plan, serial: 3, strategy: "spawn-deep" }]);
  fs.writeFileSync(plan, "# no frontmatter\n");
  expect(activeReviews(root, "s1")).toStrictEqual([]);
});

it("prunes ended, missing and odd stamps and keeps ready and in-progress spawn plans", () => {
  const root = realDir("stamps-");

  const keep = [planFm("spawn-fast", "ready"), planFm("spawn-deep")].map((fm, i) =>
    writePlan(root, `plans/${i}-keep-20261107T181901Z.md`, fm),
  );

  const drop = [
    planFm("spawn-fast", "done"),
    planFm("spawn-fast", "blocked"),
    planFm("free"),
    planFm(null),
    { serial: "4", strategy: "spawn-deep" },
  ].map((fm, i) => writePlan(root, `plans/${i}-drop-20261107T181901Z.md`, fm));

  for (const p of [...keep, ...drop, path.join(root, ".repo/plans/9-gone.md")]) stampPlan(root, "s1", p);

  stampWith(root, "s1", "{}");
  pruneStamps(root, "s1");
  expect(stampedPlans(root, "s1").toSorted()).toStrictEqual(keep.toSorted());
  expect(fs.readdirSync(reviewsDir(root, "s1"))).toHaveLength(2);
  pruneStamps(root, "never-stamped");
});

it("stampPlan twice leaves one identical file and no temp file; unstampPlan removes it, twice", () => {
  const root = realDir("stamps-");
  const plan = writePlan(root, `plans/${NAME}`, planFm("spawn-fast"));
  stampPlan(root, "s1", plan);
  const [file] = fs.readdirSync(reviewsDir(root, "s1"));
  const first = fs.readFileSync(path.join(reviewsDir(root, "s1"), String(file)), "utf8");
  stampPlan(root, "s1", plan);
  expect(fs.readdirSync(reviewsDir(root, "s1")).toSorted()).toStrictEqual([file]);
  expect(fs.readFileSync(path.join(reviewsDir(root, "s1"), String(file)), "utf8")).toBe(first);
  unstampPlan(root, "s1", plan);
  unstampPlan(root, "s1", plan);
  expect(stampedPlans(root, "s1")).toStrictEqual([]);
});

it("stamps a plan typed with ./ or .., or through a symlinked root, as its canonical path", () => {
  const root = realDir("stamps-");
  const plan = writePlan(root, `plans/${NAME}`, planFm("spawn-fast"));
  stampPlan(root, "s1", `${root}/./.repo/tmp/../plans/${NAME}`);
  expect(stampedPlans(root, "s1")).toStrictEqual([plan]);
  const alias = aliasOf(root);
  stampPlan(alias, "s2", path.join(alias, ".repo", "plans", NAME));
  expect(stampedPlans(root, "s2")).toStrictEqual([plan]);
  expect(activeReviews(alias, "s2")).toStrictEqual([{ kind: "plan", plan, serial: 4, strategy: "spawn-fast" }]);
});

it("leaves no temp file and rethrows when the stamp cannot be replaced", () => {
  const root = realDir("stamps-");
  const plan = path.join(root, "plan.md");
  stampPlan(root, "s1", plan);
  const [file] = fs.readdirSync(reviewsDir(root, "s1"));
  fs.rmSync(path.join(reviewsDir(root, "s1"), String(file)));
  fs.mkdirSync(path.join(reviewsDir(root, "s1"), String(file), "keep"), { recursive: true });
  expect(() => stampPlan(root, "s1", plan)).toThrow(/rename/);
  expect(fs.readdirSync(reviewsDir(root, "s1")).toSorted()).toStrictEqual([file]);
});
