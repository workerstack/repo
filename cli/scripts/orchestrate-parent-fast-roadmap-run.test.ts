import { expect, it } from "vitest";

import { claudeSession, read } from "./__fixtures__/fast-session.ts";
import type { HookSession } from "./__fixtures__/hook-session.ts";
import { closing, fastRoadmap as fastRoadmapItem, orchestrateKit, transcript } from "./__fixtures__/orchestrate-kit.ts";

const kit = orchestrateKit();

const ROADMAP_BODY = [
  "FAST_ROADMAP_NAME: tidy ignores",
  "# tidy-ignores",
  "",
  "## Order",
  "1 [ ] ignore tmp: add .tmp/ to .gitignore",
  "2 [ ] ignore logs: add *.log to .gitignore",
  "",
  "## Verify",
  "3 [ ] `git check-ignore .tmp/x a.log` prints both",
  "",
].join("\n");

const PLAN_BODY = [
  "FAST_PLAN_NAME: add ignore",
  "commit: chore: ignore",
  "# add-ignore",
  "",
  "## Goal",
  "Ignore a path in git.",
  "",
  "## Steps",
  "1 [ ] add the path to `.gitignore`",
  "",
  "## Verify",
  "2 [ ] `git check-ignore x` prints it",
  "",
].join("\n");

const SLICES = ["1 [ ] ignore tmp: add .tmp/ to .gitignore", "2 [ ] ignore logs: add *.log to .gitignore"];

function runPlan(s: HookSession, fast: string) {
  for (const [from, to] of [
    ["status: ready", "status: in-progress"],
    ["1 [ ] add", "1 [x] add"],
    ["2 [ ] `git", "2 [x] `git"],
    ["status: in-progress", "status: done"],
  ] as const) {
    const next = read(fast).replace(from, to);
    expect(s.save(fast, next)).toBe(fast);
    expect(read(fast)).toBe(next);
    expect(s.stop("Step done.")).toBeNull();
  }
}

function saveRoadmap(s: HookSession, roadmap: string, next: string) {
  expect(s.save(roadmap, next)).toBe(roadmap);
  expect(read(roadmap)).toBe(next);
  expect(read(roadmap)).not.toMatch(/^reviews:/m);
}

it("a two-slice fast roadmap runs through the hooks from save to done", () => {
  const ws = kit.temp();
  const s = claudeSession(kit, ws, "run1");
  s.say("plan the small things");
  const roadmap = s.save(".repo/roadmaps-fast/x.md", ROADMAP_BODY);
  const block = closing(fastRoadmapItem(1));

  expect(s.stop("Saved. Shall I start?")).toStrictEqual({
    decision: "block",
    reason: `end with this block:\n${block}`,
  });
  expect(s.stop(`Saved.\n\n${block}`)).toBeNull();
  expect(s.say("i", transcript(ws, `Saved.\n\n${block}`))).toContain(
    `fast-roadmap 1: set status locked, then run /implement-roadmap-fast 1 (${roadmap})`,
  );

  saveRoadmap(s, roadmap, read(roadmap).replace("status: draft", "status: locked"));
  saveRoadmap(s, roadmap, read(roadmap).replace("status: locked", "status: in-progress"));

  for (const [i, line] of SLICES.entries()) {
    const fast = s.save(`.repo/plans-fast/p${i}.md`, PLAN_BODY);
    saveRoadmap(s, roadmap, read(roadmap).replace(line, `${line}\n      Location: ${fast}`));
    expect(s.stop("Saved the slice's plan.")).toBeNull();

    runPlan(s, fast);

    expect(read(fast)).not.toMatch(/^reviews:/m);
    saveRoadmap(s, roadmap, read(roadmap).replace(line, line.replace("[ ]", "[x]")));
  }

  saveRoadmap(s, roadmap, read(roadmap).replace("3 [ ]", "3 [x]"));
  saveRoadmap(s, roadmap, read(roadmap).replace("status: in-progress", "status: done"));
  expect(read(roadmap)).toMatch(/^status: done$/m);
});
