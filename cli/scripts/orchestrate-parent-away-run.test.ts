import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import {
  FAST_PLAN_BODY,
  FAST_ROADMAP_BODY,
  awayRunStamp,
  decisionLine,
  modeSession,
  runBlock,
} from "./__fixtures__/away-run-kit.ts";
import { lines, read } from "./__fixtures__/fast-session.ts";
import type { HookSession } from "./__fixtures__/hook-session.ts";
import {
  closing,
  fastPlan,
  fastRoadmap,
  orchestrateKit,
  plan as planItem,
  roadmap as roadmapItem,
} from "./__fixtures__/orchestrate-kit.ts";
import { DRAFT_ROADMAP, VALID_PLAN } from "./__fixtures__/persist-bodies.ts";
import type { Approvable } from "./orchestrate.types.ts";
import { validateFastPlan } from "./persist-fast-plan-validate.ts";
import { validateFastRoadmap } from "./persist-fast-roadmap-validate.ts";
import { validatePlan } from "./persist-plan-validate.ts";
import { validateRoadmap } from "./persist-roadmap-validate.ts";

const kit = orchestrateKit();

type Case = {
  key: string;
  item: Approvable;
  save: (s: HookSession) => string;
  step: (file: string) => string;
  strategy?: string;
  validate: (filename: string, text: string, opts: { fresh: boolean }) => string[];
};

const CASES: readonly Case[] = [
  {
    item: planItem(1),
    key: "plan 1",
    save: (s) => s.reviewed("plans", VALID_PLAN),
    step: (f) => `run /implement-plan 1 (${f})`,
    strategy: "default",
    validate: validatePlan,
  },
  {
    item: roadmapItem(1),
    key: "roadmap 1",
    save: (s) => s.reviewed("roadmaps", DRAFT_ROADMAP),
    step: (f) => `set status locked, then run /implement-roadmap 1 (${f})`,
    strategy: "default",
    validate: validateRoadmap,
  },
  {
    item: fastPlan(1),
    key: "fast-plan 1",
    save: (s) => s.save(".repo/plans-fast/x.md", FAST_PLAN_BODY),
    step: (f) => `run /implement-plan-fast 1 (${f})`,
    validate: validateFastPlan,
  },
  {
    item: fastRoadmap(1),
    key: "fast-roadmap 1",
    save: (s) => s.save(".repo/roadmaps-fast/x.md", FAST_ROADMAP_BODY),
    step: (f) => `set status locked, then run /implement-roadmap-fast 1 (${f})`,
    validate: validateFastRoadmap,
  },
];

const ENDINGS = [
  { name: "ends with the block", reply: (c: Case) => `Saved.\n\n${closing(c.item)}` },
  { name: "has no block", reply: () => "Saved." },
] as const;

it.each(CASES.flatMap((c) => ENDINGS.map((e) => ({ c, e, label: `${c.key}, reply ${e.name}` }))))(
  "under /away Stop runs the header choice once and logs it for $label",
  ({ c, e }) => {
    const { s } = modeSession(kit, "k1", "/away");
    const file = c.save(s);
    expect(s.stop(e.reply(c))).toStrictEqual(runBlock(c.key, c.step(file)));
    const text = read(file);
    expect(lines(text)).toContain(decisionLine(c.key, c.strategy));
    expect(c.validate(path.basename(file), text, { fresh: false })).toStrictEqual([]);
    expect(s.stop(e.reply(c))).toBeNull();
    expect(read(file)).toBe(text);
  },
);

it("runs a plan and a fast plan saved in one turn in one block, in save order", () => {
  const { s } = modeSession(kit, "k2", "/away");
  const plan = s.reviewed("plans", VALID_PLAN);
  const fast = s.save(".repo/plans-fast/x.md", FAST_PLAN_BODY);
  expect(s.stop("Saved.")?.reason).toBe(
    "away: ran the approval block's header choice and logged it in each file, " +
      "so re-read each file before you edit it; " +
      "i approves plan 1, then fast-plan 1: " +
      `plan 1: run /implement-plan 1 (${plan}); fast-plan 1: run /implement-plan-fast 1 (${fast})`,
  );
  expect(s.stop("Saved.")).toBeNull();
});

it("runs a plan again once it is revised after its run", () => {
  const { s } = modeSession(kit, "k3", "/away");
  const plan = s.reviewed("plans", VALID_PLAN);
  expect(s.stop("Saved.")).toStrictEqual(runBlock("plan 1", `run /implement-plan 1 (${plan})`));
  s.say("revise the goal");
  s.save(plan, read(plan).replace("reviews: 1", "reviews: 2"));
  expect(s.stop("Revised.")).toStrictEqual(runBlock("plan 1", `run /implement-plan 1 (${plan})`));
  expect(lines(read(plan)).filter((l) => l === decisionLine("plan 1", "default"))).toHaveLength(2);
});

it("a plan saved in an earlier turn runs only when the reply's block names it", () => {
  const { s } = modeSession(kit, "k4", "");
  const plan = s.reviewed("plans", VALID_PLAN);
  s.say("/away");
  s.say("go on");
  expect(s.stop("Nothing new.")).toBeNull();
  expect(s.stop(`Saved.\n\n${closing(planItem(1))}`)).toStrictEqual(
    runBlock("plan 1", `run /implement-plan 1 (${plan})`),
  );
});

it("a bad away run stamp reads as empty", () => {
  const { s, ws } = modeSession(kit, "k5", "/away");
  const plan = s.reviewed("plans", VALID_PLAN);
  fs.mkdirSync(path.dirname(awayRunStamp(ws, "k5")), { recursive: true });
  fs.writeFileSync(awayRunStamp(ws, "k5"), "not json");
  expect(s.stop("Saved.")).toStrictEqual(runBlock("plan 1", `run /implement-plan 1 (${plan})`));
});
