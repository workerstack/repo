import { describe, expect, it } from "vitest";
import { MISTAKES_H2 } from "./persist-doc.constants.ts";
import { mistakeLogErrors, parseMistakes, PLAN_MISTAKE_SOURCES, reviewErrors } from "./persist-mistakes.ts";

const GATES = { "in-progress": 1 };
const OPTS = { gates: GATES, review: "/review-plan {n}" };
const ENTRY = "- review: slow → fast";

describe("parseMistakes", () => {
  it("accepts (none) and well-formed entries with a lesson", () => {
    expect(parseMistakes("(none)\n", PLAN_MISTAKE_SOURCES)).toStrictEqual({ entries: [], errors: [] });
    const got = parseMistakes(`${ENTRY} (lesson: some-lesson)\n`, PLAN_MISTAKE_SOURCES);
    expect(got.errors).toStrictEqual([]);
    expect(got.entries).toStrictEqual([
      { source: "review", text: "slow → fast", lesson: "some-lesson", line: `${ENTRY} (lesson: some-lesson)` },
    ]);
  });

  it("refuses an empty log and a malformed line", () => {
    expect(parseMistakes(undefined, PLAN_MISTAKE_SOURCES).errors).toStrictEqual([
      "## Previous mistakes is empty; write (none)",
    ]);
    expect(parseMistakes("- nope: a → b", PLAN_MISTAKE_SOURCES).errors).toStrictEqual([
      'Previous mistakes entry must be "- {feedback|verify|review|premise|decision}: {what was wrong} → {what changed}": - nope: a → b',
    ]);
  });
});

describe("reviewErrors", () => {
  it("refuses a malformed count", () => {
    expect(reviewErrors({ reviews: "01" }, null, OPTS)).toStrictEqual([
      "reviews must be a whole number with no sign or leading zero, e.g. reviews: 1",
    ]);
  });

  it("refuses removing or lowering a saved count", () => {
    expect(reviewErrors({}, { reviews: "2" }, OPTS)).toStrictEqual([
      "keep reviews: 2 in the frontmatter; the review count cannot be removed",
    ]);
    expect(reviewErrors({ reviews: "1" }, { reviews: "2" }, OPTS)).toStrictEqual([
      "reviews cannot go down (saved 2, got 1)",
    ]);
    expect(reviewErrors({ reviews: "2" }, { reviews: "2" }, OPTS)).toStrictEqual([]);
  });

  it("gates entering a status on the rounds", () => {
    const want =
      "status in-progress needs reviews: 1 or more; run /review-plan {n}, settle its findings, and bump reviews in that save";
    expect(reviewErrors({ status: "in-progress", reviews: "0" }, null, OPTS)).toStrictEqual([want]);
    expect(reviewErrors({ status: "in-progress" }, { status: "ready" }, OPTS)).toStrictEqual([want]);
    expect(reviewErrors({ status: "in-progress", reviews: "0" }, { status: "in-progress" }, OPTS)).toStrictEqual([]);
    expect(reviewErrors({ status: "in-progress", reviews: "1" }, null, OPTS)).toStrictEqual([]);
    expect(reviewErrors({ reviews: "0" }, null, OPTS)).toStrictEqual([]);
  });
});

describe("mistakeLogErrors", () => {
  const opts = { fresh: true, sources: PLAN_MISTAKE_SOURCES, kind: "plan" };

  it("requires the log on a fresh save only", () => {
    expect(mistakeLogErrors(["Goal"], {}, opts)).toStrictEqual([
      "missing ## Previous mistakes; end a new plan with it and (none)",
    ]);
    expect(mistakeLogErrors(["Goal"], {}, { ...opts, fresh: false })).toStrictEqual([]);
  });

  it("wants the log last and once", () => {
    const bodies = { [MISTAKES_H2]: "(none)" };
    expect(mistakeLogErrors([MISTAKES_H2, "Goal"], bodies, opts)).toStrictEqual([
      "## Previous mistakes must be the last heading, once",
    ]);
    expect(mistakeLogErrors(["Goal", MISTAKES_H2, MISTAKES_H2], bodies, opts)).toStrictEqual([
      "## Previous mistakes must be the last heading, once",
    ]);
  });

  it("keeps saved entries unchanged and in order", () => {
    const previous = { order: [MISTAKES_H2], bodies: { [MISTAKES_H2]: `${ENTRY}\n- verify: a → b` } };
    const run = (log: string) => mistakeLogErrors([MISTAKES_H2], { [MISTAKES_H2]: log }, { ...opts, previous });
    expect(run(`${ENTRY}\n- verify: a → b\n- decision: c → d`)).toStrictEqual([]);
    expect(run(`${ENTRY}\n- verify: a → changed`)).toStrictEqual([
      "Previous mistakes is append-only; keep this entry unchanged: - verify: a → b",
    ]);
    expect(
      mistakeLogErrors(["Goal"], {}, { ...opts, fresh: false, previous: { order: ["Goal"], bodies: {} } }),
    ).toStrictEqual([]);
  });
});

describe("mistakeLogErrors entries", () => {
  const opts = { fresh: true, sources: PLAN_MISTAKE_SOURCES, kind: "plan" };

  it("reports a malformed entry", () => {
    expect(mistakeLogErrors([MISTAKES_H2], { [MISTAKES_H2]: "bad" }, opts)).toStrictEqual([
      'Previous mistakes entry must be "- {feedback|verify|review|premise|decision}: {what was wrong} → {what changed}": bad',
    ]);
  });
});
