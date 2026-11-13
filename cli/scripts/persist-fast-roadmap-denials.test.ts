import { describe, expect, it } from "vitest";

import {
  BODY,
  NO_LOCATION,
  PLAN_ABS,
  SENT,
  saveRoadmap,
  withExtraBoxes,
  withLocation,
} from "./__fixtures__/persist-fast-roadmap-kit.ts";
import { useTmpWs } from "./__fixtures__/persist-plan-kit.ts";
import { fastRoadmapLineCount } from "./persist-fast-roadmap-validate.ts";

const tmpWs = useTmpWs("persist-fast-roadmap-deny-");

function errorsOf(content: string) {
  return saveRoadmap(content, tmpWs()).errors;
}

describe("fast roadmap denials", () => {
  it("denies a strategy line", () => {
    expect(errorsOf(`FAST_ROADMAP_NAME: x\nstrategy: spawn-fast\n${BODY}`)).toContain("a fast roadmap has no strategy");
  });

  it("denies sections beyond Order and Verify, and a missing one", () => {
    const only = "a fast roadmap holds only Order and Verify, then an optional Previous mistakes";
    expect(errorsOf(`${SENT}\n## Goal\nx\n`)).toContain(only);
    expect(errorsOf(SENT.replace(/## Verify[\s\S]*$/, ""))).toContain(only);
  });

  it("denies more than 20 lines counting the frontmatter, and allows exactly 20", () => {
    const room = 20 - fastRoadmapLineCount(saveRoadmap(SENT, tmpWs()).content ?? "");
    expect(saveRoadmap(withExtraBoxes(room), tmpWs()).ok).toBe(true);
    expect(errorsOf(withExtraBoxes(room + 1))).toContain(
      "a fast roadmap is at most 20 lines; write a roadmap (/write-roadmap)",
    );
  });

  it("denies fewer than two slices", () => {
    const one = SENT.replace("2 [ ] ignore logs: add *.log to .gitignore\n", "");
    expect(errorsOf(one)).toContain("a fast roadmap has two or more slices; write a fast plan (/write-plan-fast)");
  });

  it("denies a ticked box on a new roadmap and a malformed slice", () => {
    expect(errorsOf(SENT.replace("1 [ ]", "1 [x]"))).toContain("a new fast roadmap has only [ ] boxes");
    expect(errorsOf(SENT.replace("ignore tmp: add", "ignore tmp add"))).toContain(
      'slice 1 needs "N [ ] {title}: {one sentence}"',
    );
  });
});

describe("fast roadmap Location", () => {
  it("accepts an absolute posix path to a fast plan, and win32 ones", () => {
    const winPlan = "\\.repo\\plans-fast\\4-add-tmp-ignore-20261113T030000Z.md";
    expect(saveRoadmap(withLocation(SENT, PLAN_ABS), tmpWs()).ok).toBe(true);
    expect(saveRoadmap(withLocation(SENT, `C:\\Users\\me\\repo${winPlan}`), tmpWs()).ok).toBe(true);
    expect(saveRoadmap(withLocation(SENT, `\\\\host\\share${winPlan}`), tmpWs()).ok).toBe(true);
  });

  it.each([
    "/repo/.repo/plans/4-add-tmp-ignore-20261113T030000Z.md",
    ".repo/plans-fast/4-x.md",
    "/repo/.repo/plans-fast/notaplan.txt",
    "/repo/.repo/plans-fast/sub/4-x.md",
    "/repo/other/plans-fast/4-x.md",
    "/repo/plans-fast/4-x.md",
  ])("denies the Location %s", (loc) => {
    expect(errorsOf(withLocation(SENT, loc))).toContain(NO_LOCATION);
  });
});
