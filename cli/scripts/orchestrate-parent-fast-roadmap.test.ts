import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { claudeSession, lines, read } from "./__fixtures__/fast-session.ts";
import type { HookSession } from "./__fixtures__/hook-session.ts";
import {
  closing,
  fastPlan as fastItem,
  fastRoadmap as fastRoadmapItem,
  gitRepo,
  must,
  orchestrateKit,
  replyOf,
  transcript,
} from "./__fixtures__/orchestrate-kit.ts";
import { isSliceOf } from "./orchestrate-reviews.ts";
import { validateHandoff } from "./persist-handoff-validate.ts";

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

const LINE_ONE = "1 [ ] ignore tmp: add .tmp/ to .gitignore";

function claude(ws: string, sid: string): HookSession {
  return claudeSession(kit, ws, sid);
}

/** A session in a fresh workspace that saved one fast roadmap through the hook. */
function oneRoadmap(sid: string) {
  const ws = kit.temp();
  const s = claude(ws, sid);
  s.say("plan the small things");

  return { roadmap: s.save(".repo/roadmaps-fast/x.md", ROADMAP_BODY), s, ws };
}

/** `roadmap` moved to `status` with a Location line under slice 1 when one is given. */
function moved(roadmap: string, status: string, location?: string) {
  const next = read(roadmap).replace(/^status: .*$/m, `status: ${status}`);

  return location === undefined ? next : next.replace(LINE_ONE, `${LINE_ONE}\n      Location: ${location}`);
}

it("saves a fast roadmap under roadmaps-fast with no strategy or reviews key, and Stop asks for the fast block", () => {
  const { roadmap, s, ws } = oneRoadmap("r1");
  expect(path.relative(ws, roadmap)).toMatch(/^\.repo[\\/]roadmaps-fast[\\/]1-tidy-ignores-\d{8}T\d{6}Z\.md$/);
  expect(read(roadmap)).not.toMatch(/^(reviews|strategy):/m);
  const block = closing(fastRoadmapItem(1));
  expect(block).toBe("```\nfast-roadmap 1\n  i  implement\n  h  hand off\n     or reply to revise\n```");
  expect(s.stop("Saved. Shall I start?")).toStrictEqual({
    decision: "block",
    reason: `end with this block:\n${block}`,
  });
  expect(s.stop(`Saved.\n\n${block}`)).toBeNull();
});

it("i approves a fast roadmap with the lock text, and no code is a choice", () => {
  const { roadmap, s, ws } = oneRoadmap("r2");
  const block = closing(fastRoadmapItem(1));
  const tp = transcript(ws, `Saved.\n\n${block}`);
  const before = read(roadmap);

  expect(lines(s.say("i", tp))).toContain(
    `i approves fast-roadmap 1: fast-roadmap 1: set status locked, then run /implement-roadmap-fast 1 (${roadmap})`,
  );

  for (const code of ["if", "isf", "isd", "hf", "hsf", "hsd"])
    expect(s.say(code, tp)).toContain(`"${code}" is not a choice; end with this block again:\n${block}`);

  expect(read(roadmap)).toBe(before);
});

it("h hands a fast roadmap off with State and Next naming it", () => {
  const { roadmap, s, ws } = oneRoadmap("r3");
  const ctx = s.say("h", transcript(ws, `Saved.\n\n${closing(fastRoadmapItem(1))}`));
  const dir = path.join(ws, ".repo/handoffs");
  const file = path.join(dir, must(fs.readdirSync(dir)[0]));
  const text = read(file);
  expect(validateHandoff(path.basename(file), text)).toStrictEqual([]);
  expect(ctx).toContain(`h handed off fast-roadmap 1 to ${file}`);
  expect(lines(text)).toContain("# run-fast-roadmap-1");
  expect(lines(text)).toContain(`- fast-roadmap 1: ${roadmap}`);
  expect(lines(text)).toContain("1.1 [ ] set status locked, then /implement-roadmap-fast 1");
});

it("the lock save passes with no reviews, and a locked roadmap still waits for its block", () => {
  const { roadmap, s } = oneRoadmap("r4");
  const next = moved(roadmap, "locked");
  expect(s.save(roadmap, next)).toBe(roadmap);
  expect(read(roadmap)).toBe(next);
  expect(read(roadmap)).not.toMatch(/^reviews:/m);
  expect(s.stop("Locked.")?.decision).toBe("block");
  expect(s.stop(`Locked.\n\n${closing(fastRoadmapItem(1))}`)).toBeNull();
});

it("a fast plan named by an in-progress fast roadmap needs no block", () => {
  const { roadmap, s } = oneRoadmap("r5");
  const fast = s.save(".repo/plans-fast/x.md", PLAN_BODY);
  expect(s.stop(`Saved.\n\n${closing(fastRoadmapItem(1))}`)?.reason).toContain(
    closing(fastRoadmapItem(1), fastItem(1)),
  );
  s.save(roadmap, moved(roadmap, "in-progress", fast));
  expect(s.stop("Saved the slice's plan.")).toBeNull();
});

it("a fast plan an in-progress fast roadmap does not name still asks for its block", () => {
  const { roadmap, s } = oneRoadmap("r6");
  s.save(roadmap, moved(roadmap, "in-progress"));
  s.save(".repo/plans-fast/x.md", PLAN_BODY);
  expect(s.stop("Saved.")).toStrictEqual({
    decision: "block",
    reason: `end with this block:\n${closing(fastItem(1))}`,
  });
});

it("a fast plan named only by an in-progress full roadmap still asks for its block", () => {
  const { s, ws } = oneRoadmap("r7");
  const fast = s.save(".repo/plans-fast/x.md", PLAN_BODY);
  fs.mkdirSync(path.join(ws, ".repo/roadmaps"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".repo/roadmaps/1-full-20261103T000000Z.md"),
    [
      "---",
      "serial: 1",
      "name: full",
      "status: in-progress",
      "reviews: 1",
      "strategy: free",
      "---",
      "",
      "## Order",
      LINE_ONE,
      `      Location: ${fast}`,
      "",
    ].join("\n"),
  );
  expect(s.stop("Saved.")?.reason).toContain(closing(fastRoadmapItem(1), fastItem(1)));
});

it("reads a win32 Location of a fast plan in a fast roadmap", () => {
  const win = "1 [ ] t: t\n      Location: C:\\Users\\me\\repo\\.repo\\plans-fast\\1-x-20261103T000000Z.md\n";
  expect(isSliceOf("c:/Users/me/repo/.repo/plans-fast/1-x-20261103T000000Z.md", win, path.win32)).toBe(true);
});

it("saves a worktree session's fast roadmap at the main checkout's roadmaps-fast", () => {
  const { r, w } = gitRepo(kit);
  const at = { cwd: w, env: { CLAUDE_PROJECT_DIR: w }, sid: "r8" };
  const out = kit.writeAs(at, path.join(w, ".repo/roadmaps-fast/x.md"), ROADMAP_BODY);
  const saved = must(replyOf(out)).hookSpecificOutput.updatedInput.file_path;
  expect(path.dirname(saved)).toBe(path.join(r, ".repo/roadmaps-fast"));
  expect(fs.readFileSync(path.join(r, ".repo/tmp/sessions/r8/approvals.txt"), "utf8")).toContain(saved);
});

it("checks an Edit of a saved fast roadmap against the text it would produce", () => {
  const { roadmap, s } = oneRoadmap("r9");

  function edit(to: string) {
    return s.call("PreToolUse", {
      input: { file_path: roadmap, new_string: to, old_string: "status: draft" },
      tool: "Edit",
    });
  }

  expect(edit("status: locked")).toBeNull();
  const denied = edit("strategy: free");
  expect(denied?.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(denied?.hookSpecificOutput.permissionDecisionReason).toContain("a fast roadmap has no strategy");
});
