import { describe, expect, it } from "vitest";

import { LEGACY_ROADMAP } from "./fixtures/persist-bodies.ts";
import { read, useTmpWs } from "./fixtures/persist-plan-kit.ts";
import { extra, savedLegacy, update } from "./fixtures/persist-roadmap-kit.ts";

const tmpWs = useTmpWs("persist-roadmap-");
const GOAL = "## Goal\nShip auth as two plans. The second plan waits on the first. Names stay reserved.\n";
const WHY = "      Why: Later slices add skills. This slot keeps init and INDEX together.\n";
// Pads Context with bullets so the saved legacy roadmap runs past the pointer cap, like roadmap 4.
const long = LEGACY_ROADMAP.replace(
  "## Context\n",
  `## Context\n${Array.from({ length: 40 }, (_, i) => `- context fact ${i + 1}`).join("\n")}\n`,
);
const linesAbove = (text: string) => text.split("\n").indexOf("## Previous mistakes");

describe("a legacy roadmap update", () => {
  it("is rejected when the Goal is not 1 to 3 sentences", () => {
    const ws = tmpWs();
    const abs = savedLegacy(ws);
    const r = update(ws, abs, LEGACY_ROADMAP.replace(GOAL, "## Goal\nOne. Two. Three. Four.\n"));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("goal");
  });

  it("is rejected when a slice has no Why", () => {
    const ws = tmpWs();
    const abs = savedLegacy(ws);
    const r = update(ws, abs, LEGACY_ROADMAP.replace(WHY, ""));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("why");
  });
});

describe("a legacy roadmap past the pointer cap", () => {
  it("still saves an old-shape roadmap past 60 lines under the old rules", () => {
    const ws = tmpWs();
    const abs = savedLegacy(ws, long);
    expect(linesAbove(read(abs))).toBeGreaterThan(60);
    const r = update(ws, abs, long.replace("1 [ ] Title: auth types", "1 [x] Title: auth types"));
    expect(r.ok, r.error).toBe(true);
    expect(read(abs)).toMatch(/^1 \[x\] Title: auth types$/m);
  });

  it("holds an old-shape update that deletes ## Goal to the old rules", () => {
    const ws = tmpWs();
    const abs = savedLegacy(ws, long);
    const before = read(abs);
    const r = update(ws, abs, long.replace(/## Goal\n[\s\S]*?(?=## Usage)/, ""));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("heading order");
    expect(r.errors).not.toContain(extra("Context"));
    expect(read(abs)).toBe(before);
  });
});
