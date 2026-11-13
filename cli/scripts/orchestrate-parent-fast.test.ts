import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { claudeSession, lines, read } from "./__fixtures__/fast-session.ts";
import type { HookSession } from "./__fixtures__/hook-session.ts";
import {
  closing,
  fastPlan as fastItem,
  must,
  orchestrateKit,
  plan as planItem,
  strategyOf,
  transcript,
} from "./__fixtures__/orchestrate-kit.ts";
import { VALID_PLAN } from "./__fixtures__/persist-bodies.ts";
import { validateHandoff } from "./persist-handoff-validate.ts";

const kit = orchestrateKit();

const FAST_BODY = [
  "FAST_PLAN_NAME: add tmp ignore",
  "commit: chore: ignore .tmp",
  "# add-tmp-ignore",
  "",
  "## Goal",
  "Ignore `.tmp/` in git.",
  "",
  "## Steps",
  "1 [ ] add `.tmp/` to `.gitignore`",
  "",
  "## Verify",
  "2 [ ] `git check-ignore .tmp/x` prints it",
  "",
].join("\n");

function claude(ws: string, sid: string): HookSession {
  return claudeSession(kit, ws, sid);
}

/** A session in a fresh workspace that saved one fast plan through the hook. */
function oneFast(sid: string) {
  const ws = kit.temp();
  const s = claude(ws, sid);
  s.say("do the small thing");

  return { fast: s.save(".repo/plans-fast/x.md", FAST_BODY), s, ws };
}

function handoffs(ws: string) {
  const dir = path.join(ws, ".repo/handoffs");

  return fs.existsSync(dir) ? fs.readdirSync(dir).map((n) => path.join(dir, n)) : [];
}

function theHandoff(ws: string) {
  const file = must(handoffs(ws)[0]);
  const text = read(file);
  expect(handoffs(ws)).toHaveLength(1);
  expect(validateHandoff(path.basename(file), text)).toStrictEqual([]);

  return { file, serial: Number(path.basename(file).split("-")[0]), text };
}

it("saves a fast plan under plans-fast with no strategy or reviews key, and Stop asks for the fast block", () => {
  const { fast, s, ws } = oneFast("f1");
  expect(path.relative(ws, fast)).toMatch(/^\.repo[\\/]plans-fast[\\/]1-add-tmp-ignore-\d{8}T\d{6}Z\.md$/);
  expect(read(fast)).not.toMatch(/^(reviews|strategy):/m);
  const block = closing(fastItem(1));
  expect(block).toBe("```\nfast-plan 1\n  i  implement\n  h  hand off\n     or reply to revise\n```");
  expect(s.stop("Saved. Shall I start?")).toStrictEqual({
    decision: "block",
    reason: `end with this block:\n${block}`,
  });
  expect(s.stop(`Saved.\n\n${block}`)).toBeNull();
});

it("a stop whose block is a full plan's does not cover a saved fast plan", () => {
  const { s } = oneFast("f2");
  expect(s.stop(`Saved.\n\n${closing(planItem(1))}`)?.decision).toBe("block");
});

it("i approves a fast plan with its run text, in any short yes", () => {
  const { fast, s, ws } = oneFast("f3");
  const tp = transcript(ws, `Saved.\n\n${closing(fastItem(1))}`);
  const before = read(fast);

  for (const text of ["i", "y", "go", "Do it!"]) {
    expect(lines(s.say(text, tp))).toContain(
      `i approves fast-plan 1: fast-plan 1: run /implement-plan-fast 1 (${fast})`,
    );
  }

  expect(read(fast)).toBe(before);
});

it("every code on an all-fast block is no choice and shows the block again", () => {
  const { fast, s, ws } = oneFast("f4");
  const tp = transcript(ws, `Saved.\n\n${closing(fastItem(1))}`);
  const before = read(fast);

  for (const code of ["if", "isf", "isd", "hf", "hsf", "hsd"]) {
    const out = s.say(code, tp);
    expect(out).toContain(`"${code}" is not a choice; end with this block again:\n${closing(fastItem(1))}`);
    expect(out).not.toContain("approves");
  }

  expect(read(fast)).toBe(before);
  expect(handoffs(ws)).toStrictEqual([]);
});

it("h hands a fast plan off with State and Next naming it", () => {
  const { fast, s, ws } = oneFast("f5");
  const ctx = s.say("h", transcript(ws, `Saved.\n\n${closing(fastItem(1))}`));
  const { file, serial, text } = theHandoff(ws);
  expect(ctx.split("\n")).toContain(
    `h handed off fast-plan 1 to ${file}; ` +
      `tell the person to run /pickup ${serial} in a fresh session, and do no work here`,
  );
  expect(lines(text)).toContain(`- fast-plan 1: ${fast}`);
  expect(lines(text)).toContain("1.1 [ ] /implement-plan-fast 1");
});

it("a code on a mixed queue writes the strategy only to the full plan", () => {
  const { fast, s, ws } = oneFast("f6");
  const full = s.reviewed("plans", VALID_PLAN);
  const fastBefore = read(fast);
  const tp = transcript(ws, `Saved.\n\n${closing(planItem(1), fastItem(1))}`);
  expect(closing(planItem(1), fastItem(1)).split("\n")[1]).toBe("plan 1 · free, then fast-plan 1");

  expect(lines(s.say("isd", tp))).toContain(
    "i approves plan 1, then fast-plan 1: plan 1: strategy spawn-deep was written to its frontmatter; " +
      `re-read the plan, then run /implement-plan 1 (${full}); ` +
      `fast-plan 1: run /implement-plan-fast 1 (${fast})`,
  );

  expect(strategyOf(full)).toBe("spawn-deep");
  expect(read(fast)).toBe(fastBefore);
  const ctx = s.say("hsf", tp);
  const { file, text } = theHandoff(ws);
  expect(ctx).toContain(`h handed off plan 1 (strategy spawn-fast written), then fast-plan 1 to ${file}`);
  expect(lines(text)).toContain(`- plan 1: ${full} (strategy: spawn-fast)`);
  expect(lines(text)).toContain(`- fast-plan 1: ${fast}`);
  expect(read(fast)).toBe(fastBefore);
});

it("a bare i on a mixed queue approves both, and the block must show the file's strategy", () => {
  const { fast, s, ws } = oneFast("f7");
  const full = s.reviewed("plans", VALID_PLAN);
  const tp = transcript(ws, `Saved.\n\n${closing(planItem(1), fastItem(1))}`);
  expect(s.say("i", tp)).toContain(
    `plan 1: run /implement-plan 1 (${full}); fast-plan 1: run /implement-plan-fast 1 (${fast})`,
  );
  expect(s.say("i", transcript(ws, closing(planItem(1, "spawn-fast"), fastItem(1))))).not.toContain("approves");
});

it("an unsettled full plan in the queue still blocks, and the fast plan never does", () => {
  const { s, ws } = oneFast("f8");
  s.reviewed("plans", VALID_PLAN);
  s.spawnReview("/review-plan 1");
  const tp = transcript(ws, `Saved.\n\n${closing(planItem(1), fastItem(1))}`);
  const why = "its review has not settled; wait for it, then end with the approval block again";
  expect(lines(s.say("i", tp))).toContain(`i did not approve plan 1: ${why}`);
  expect(lines(s.say("h", tp))).toContain(`h did not hand off plan 1: ${why}`);
  expect(s.stop(closing(planItem(1), fastItem(1)))?.reason).toMatch(/^plan 1's review has not settled/);
  expect(s.stop(closing(fastItem(1)))).toBeNull();
});

it("a saved fast plan runs through its ticks to done with no reviews key", () => {
  const { fast, s, ws } = oneFast("f9");
  const block = closing(fastItem(1));
  const tp = transcript(ws, `Saved.\n\n${block}`);

  // Only a ready plan waits for an `i`; once started it is no longer approvable.
  expect(s.stop(`Saved.\n\n${block}`)).toBeNull();
  expect(lines(s.say("i", tp))).toContain(`i approves fast-plan 1: fast-plan 1: run /implement-plan-fast 1 (${fast})`);

  function step(from: string, to: string) {
    const next = read(fast).replace(from, to);
    expect(s.save(fast, next)).toBe(fast);
    expect(read(fast)).toBe(next);
    expect(s.stop(`Saved.\n\n${block}`)).toBeNull();
    expect(s.say("i", tp)).not.toContain("approves");
    expect(read(fast)).not.toMatch(/^(reviews|strategy):/m);
  }

  step("status: ready", "status: in-progress");
  step("1 [ ] add", "1 [x] add");
  step("2 [ ] `git", "2 [x] `git");
  step("status: in-progress", "status: done");
  expect(read(fast)).toMatch(/^status: done$/m);
});

it("checks an Edit of a saved fast plan against the text it would produce", () => {
  const { fast, s } = oneFast("f10");

  function edit(to: string) {
    return s.call("PreToolUse", {
      input: { file_path: fast, new_string: to, old_string: "status: ready" },
      tool: "Edit",
    });
  }

  expect(edit("status: in-progress")).toBeNull();
  const denied = edit("strategy: free");
  expect(denied?.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(denied?.hookSpecificOutput.permissionDecisionReason).toContain("a fast plan has no strategy");
});
