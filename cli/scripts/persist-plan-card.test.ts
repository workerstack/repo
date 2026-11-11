import { describe, expect, it } from "vitest";
import { CARD, CARDED, H1, leanKit, read, stripCard, update, useTmpWs, withCard } from "./fixtures/persist-plan-kit.ts";
import { VALID_PLAN, savedOk } from "./fixtures/persist-bodies.ts";
import { validatePlan } from "./persist-plan-validate.ts";

const tmpWs = useTmpWs();
const { save, legacy } = leanKit(tmpWs);

describe("card format", () => {
  it("saves a plan whose card follows the title", () => {
    const r = save(CARDED);
    expect(r.ok, r.error).toBe(true);
  });

  it("denies a fresh plan without a card", () => {
    const r = save(stripCard(VALID_PLAN));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("start with the 5-line card after the title: WHAT, WHY, RISK, TOUCH, DONE");
  });

  it("denies labels out of order and names the line", () => {
    const r = save(withCard(VALID_PLAN, [CARD[0], CARD[2], CARD[1], CARD[3], CARD[4]]));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("card line 2 must start with WHY");
  });

  it("denies a card line over 120 characters and keeps one at 120", () => {
    const touch = (len: number) => "TOUCH  " + "x".repeat(len - "TOUCH  ".length);
    const long = save(withCard(VALID_PLAN, [CARD[0], CARD[1], CARD[2], touch(121), CARD[4]]));
    expect(long.ok).toBe(false);
    expect(long.errors).toContain("card line 4 (TOUCH) is 121 characters; the limit is 120");
    const edge = save(withCard(VALID_PLAN, [CARD[0], CARD[1], CARD[2], touch(120), CARD[4]]));
    expect(edge.ok, edge.error).toBe(true);
  });
});

describe("card denials", () => {
  it("drops a PLAN_NAME sent after commit and strategy so the card sits under the title", () => {
    const body = CARDED.split("\n").slice(2).join("\n");
    const r = save(`commit: feat: add the thing\nstrategy: default\nPLAN_NAME: add tmp ignore\n${body}`);
    expect(r.ok, r.error).toBe(true);
    expect(r.content).not.toMatch(/^PLAN_NAME:/m);
    expect(r.content).toContain(`${H1}${CARD.join("\n")}\n\n## Goal`);
    expect(validatePlan(savedOk(r).filename, savedOk(r).content)).toStrictEqual([]);
  });

  it("denies a label without its 7-column padding or text", () => {
    for (const why of ["WHY  plans stay untracked", "WHY    "]) {
      const r = save(withCard(VALID_PLAN, [CARD[0], why, CARD[2], CARD[3], CARD[4]]));
      expect(r.ok, why).toBe(false);
      expect(r.errors, why).toContain('card line 2 (WHY) needs its text at column 8: "WHY    <text>"');
    }
  });

  it("denies a card longer than 5 lines", () => {
    const r = save(withCard(VALID_PLAN, [...CARD, "NOTE   one more"]));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("the card is 5 lines; end it with a blank line after DONE");
  });
});

describe("card PLAN_NAME", () => {
  it("drops a PLAN_NAME under the title but keeps one inside a fence", () => {
    const under = save(
      CARDED.replace("PLAN_NAME: add tmp ignore\n", "").replace(H1, `${H1}PLAN_NAME: add tmp ignore\n\n`),
    );
    expect(under.ok, under.error).toBe(true);
    expect(under.content).not.toMatch(/^PLAN_NAME:/m);
    expect(under.filename).toMatch(/^1-add-tmp-ignore-/);
    const F = "```";
    const unnamed = CARDED.replace("PLAN_NAME: add tmp ignore\n", "");
    const fenced = save(unnamed.replace("\n\n## Goal", `\n\n${F}text\nPLAN_NAME: example\n${F}\n\n## Goal`));
    expect(fenced.ok, fenced.error).toBe(true);
    expect(fenced.filename).toMatch(/^1-add-tmp-ignore-/);
    expect(fenced.content).toMatch(/^PLAN_NAME: example$/m);
    const below = save(unnamed.replace("## Context\n", "## Context\nPLAN_NAME: example\n"));
    expect(below.filename).toMatch(/^1-add-tmp-ignore-/);
    expect(below.content).toMatch(/^PLAN_NAME: example$/m);
  });

  it("denies a body with no sections, named or not", () => {
    for (const content of ["PLAN_NAME: lone\n", "# lone\n\nno sections\n"]) {
      const r = save(content);
      expect(r.ok, content).toBe(false);
      expect(r.errors, content).toContain("heading order");
    }
  });
});

describe("card gaps", () => {
  it("names each line a short card is missing", () => {
    const r = save(withCard(VALID_PLAN, CARD.slice(0, 4)));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("card line 5 must start with DONE");
  });

  it("updates a saved plan that has no card", () => {
    const s = legacy(stripCard);
    const r = update(s.ws, s.abs, read(s.abs).replace("1.1 [ ]", "1.1 [x]"));
    expect(r.ok, r.error).toBe(true);
  });
});
