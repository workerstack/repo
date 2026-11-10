import { describe, expect, it } from "vitest";
import { parallelErrors, parallelFiles, planBoxes, planPhases, readPhaseErrors } from "./persist-plan-boxes.ts";

const PLAN = [
  "1 [ ] One (parallel: a.ts, b\\c.ts)",
  "1.1 [x] leaf",
  "```",
  "9 [ ] fenced",
  "```",
  "2 [ ] Two (parallel: b/c.ts)",
  "2.1 [ ] leaf",
].join("\n");

describe("planBoxes and planPhases", () => {
  it("reads boxes outside fences and groups leaves under their phase", () => {
    const boxes = planBoxes(PLAN);
    expect(boxes.map((b) => b.id)).toEqual(["1", "1.1", "2", "2.1"]);
    expect(boxes[1]).toEqual({ id: "1.1", mark: "x", text: "leaf" });
    expect(planPhases(boxes).map((p) => p.leaves.map((l) => l.id))).toEqual([["1.1"], ["2.1"]]);
  });
});

describe("parallelFiles and parallelErrors", () => {
  it("reads declared files with / separators, and null for a serial phase", () => {
    const phase = (text: string) => ({ id: "3", mark: " ", text });
    expect(parallelFiles(phase("One (parallel: a.ts, b\\c.ts)"))).toEqual(["a.ts", "b/c.ts"]);
    expect(parallelFiles(phase("plain"))).toBeNull();
  });

  it("names a shared file, a lone phase and a phase with no files", () => {
    expect(parallelErrors(planPhases(planBoxes(PLAN)))).toEqual([
      "parallel phases 1 and 2 both list b/c.ts; parallel phases need disjoint files",
    ]);
    const lone = planPhases(planBoxes("1 [ ] A (parallel: )\n1.1 [ ] x\n2 [ ] B\n2.1 [ ] y"));
    expect(parallelErrors(lone)).toEqual([
      "phase 1 is parallel alone; parallel needs two or more adjacent phases",
      "phase 1 is parallel with no files; list the files it writes after parallel:",
    ]);
  });
});

describe("readPhaseErrors", () => {
  const reads = planPhases(planBoxes("1 [ ] Read\n1.1 [ ] read `principle-a` and `principle-b`"));

  it("denies a fresh read-only phase", () => {
    expect(readPhaseErrors(reads, { fresh: true })).toEqual([
      "phase 1 only reads principles; move each read into the phase it gates",
    ]);
  });

  it("lets an update keep a read-only phase the saved file already had", () => {
    const previous = "1 [ ] Read\n1.1 [ ] read `principle-a`";
    expect(readPhaseErrors(reads, { fresh: false, previous })).toEqual([]);
    expect(readPhaseErrors(reads, { fresh: false, previous: "1 [ ] Do\n1.1 [ ] x" })).toHaveLength(1);
  });
});
