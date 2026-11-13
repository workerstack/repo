import { describe, expect, it } from "vitest";

import { MISTAKES_H2 } from "./persist-doc.constants.ts";
import { mistakeLogErrors, parseMistakes, PLAN_MISTAKE_SOURCES, reviewErrors, withEntry } from "./persist-mistakes.ts";
import { reviewsToEnter } from "./persist-plan.constants.ts";

const OPTS = { gates: reviewsToEnter, review: "/review-plan {n}" };
const ENTRY = "- review: slow → fast";

const ENTRY_FORMAT =
  'Previous mistakes entry must be "- {feedback|verify|review|premise|decision}: {what was wrong} → {what changed}": ';

describe("parseMistakes", () => {
  it("accepts (none) and well-formed entries with a lesson", () => {
    expect(parseMistakes("(none)\n", PLAN_MISTAKE_SOURCES)).toStrictEqual({ entries: [], errors: [] });
    const got = parseMistakes(`${ENTRY} (lesson: some-lesson)\n`, PLAN_MISTAKE_SOURCES);
    expect(got.errors).toStrictEqual([]);
    expect(got.entries).toStrictEqual([
      { lesson: "some-lesson", line: `${ENTRY} (lesson: some-lesson)`, source: "review", text: "slow → fast" },
    ]);
  });

  it("refuses an empty log and a malformed line", () => {
    expect(parseMistakes(undefined, PLAN_MISTAKE_SOURCES).errors).toStrictEqual([
      "## Previous mistakes is empty; write (none)",
    ]);
    expect(parseMistakes("- nope: a → b", PLAN_MISTAKE_SOURCES).errors).toStrictEqual([`${ENTRY_FORMAT}- nope: a → b`]);
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
      "status in-progress needs reviews: 1 or more; " +
      "run /review-plan {n}, settle its findings, and bump reviews in that save";

    expect(reviewErrors({ reviews: "0", status: "in-progress" }, null, OPTS)).toStrictEqual([want]);
    expect(reviewErrors({ status: "in-progress" }, { status: "ready" }, OPTS)).toStrictEqual([want]);
    expect(reviewErrors({ reviews: "0", status: "in-progress" }, { status: "in-progress" }, OPTS)).toStrictEqual([]);
    expect(reviewErrors({ reviews: "1", status: "in-progress" }, null, OPTS)).toStrictEqual([]);
    expect(reviewErrors({ reviews: "0" }, null, OPTS)).toStrictEqual([]);
  });
});

const opts = { fresh: true, kind: "plan", sources: PLAN_MISTAKE_SOURCES };

describe("mistakeLogErrors", () => {
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
    const previous = { bodies: { [MISTAKES_H2]: `${ENTRY}\n- verify: a → b` }, order: [MISTAKES_H2] };

    function run(log: string) {
      return mistakeLogErrors([MISTAKES_H2], { [MISTAKES_H2]: log }, { ...opts, previous });
    }

    expect(run(`${ENTRY}\n- verify: a → b\n- decision: c → d`)).toStrictEqual([]);
    expect(run(`${ENTRY}\n- verify: a → changed`)).toStrictEqual([
      "Previous mistakes is append-only; keep this entry unchanged: - verify: a → b",
    ]);
    expect(
      mistakeLogErrors(["Goal"], {}, { ...opts, fresh: false, previous: { bodies: {}, order: ["Goal"] } }),
    ).toStrictEqual([]);
  });
});

describe("mistakeLogErrors entries", () => {
  it("reports a malformed entry", () => {
    expect(mistakeLogErrors([MISTAKES_H2], { [MISTAKES_H2]: "bad" }, opts)).toStrictEqual([`${ENTRY_FORMAT}bad`]);
  });
});

describe("withEntry", () => {
  const doc = "# x\n\n## Verify\n1 [ ] y\n";

  it("replaces a (none) body with the line", () => {
    const want = `${doc}\n## Previous mistakes\n${ENTRY}\n`;
    expect(withEntry(`${doc}\n## Previous mistakes\n(none)\n\n`, ENTRY)).toBe(want);
  });

  it("appends after the last entry", () => {
    expect(withEntry(`${doc}\n## Previous mistakes\n- verify: a → b`, ENTRY)).toBe(
      `${doc}\n## Previous mistakes\n- verify: a → b\n${ENTRY}\n`,
    );
  });

  it("adds the section at the end when there is none", () => {
    expect(withEntry(`${doc}\n\n`, ENTRY)).toBe(`${doc}\n## Previous mistakes\n${ENTRY}\n`);
  });

  it("skips a fenced ## Previous mistakes line and keeps every line above the real one", () => {
    const fenced = "# x\n\n```md\n## Previous mistakes\n- verify: a → b\n```\n\n## Verify\n1 [ ] y\n";
    expect(withEntry(`${fenced}\n## Previous mistakes\n(none)\n`, ENTRY)).toBe(
      `${fenced}\n## Previous mistakes\n${ENTRY}\n`,
    );
    expect(withEntry(fenced, ENTRY)).toBe(`${fenced}\n## Previous mistakes\n${ENTRY}\n`);
  });

  it("keeps existing entry lines as they are and drops only (none) and trailing blank lines", () => {
    expect(withEntry(`${doc}\n## Previous mistakes\n\n- verify: a → b\n  \n\n`, ENTRY)).toBe(
      `${doc}\n## Previous mistakes\n\n- verify: a → b\n${ENTRY}\n`,
    );
  });
});
