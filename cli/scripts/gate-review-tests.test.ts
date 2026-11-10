import fs from "node:fs";
import { expect, it } from "vitest";
import { processFatTools, processHookPayload } from "./gate-fat-tools.ts";
import { jobCommand, quoteQuery } from "./gate-job.ts";
import type { HookInput } from "./hook-input.ts";
import { useTmp } from "./fixtures/gate-workspace.ts";
import { asChild, claudeCall, codexCall, commandOf, inSession } from "./fixtures/hook-payload.ts";
import { planFile, planText, REVIEW_SID, startReview } from "./fixtures/review-plan.ts";
import { writeStamp } from "./strategy.ts";

const tmp = useTmp();
const job = (w: string, cmd: string) => jobCommand(w, `--job test --query ${quoteQuery(cmd)}`);
const claudeSh = (w: string, command: string, extra: HookInput = {}): HookInput => ({
  ...inSession(claudeCall(w, "Bash", { command }), REVIEW_SID),
  ...extra,
});
const rewrite = (w: string, command: string) => ({ type: "rewrite", updatedInput: { command: job(w, command) } });
const implementer = (type: string) => ({ agent_type: type });
const SUITES = [
  "bun test",
  "bunx vitest run a.test.ts",
  "bun vitest",
  "bun --bun vitest run --coverage",
  "bunx --bun vitest run a.test.ts",
  "npx vitest run",
  "vitest",
  "npm test",
  "npm run test -- a",
  "pnpm test",
  "pnpm run test",
  "  bun run test  ",
];
const NOT_PARENT: [string, string][] = [
  ["default", "in-progress"],
  ["review-fast", "ready"],
  ["review-fast", "done"],
  ["review-fast", "blocked"],
];

it("rewrites an implementer child's test run to the job test and passes a compound through", () => {
  const w = tmp.dir("gate-review-");
  const cmd = "bun run test x.test.ts";
  for (const agent of ["implementer-fast", "implementer-deep"]) {
    const extra = implementer(agent);
    expect(processFatTools(claudeSh(w, cmd, extra)), agent).toEqual(rewrite(w, cmd));
    const codex = asChild(inSession(codexCall(w, "Bash", { command: cmd }), REVIEW_SID), agent);
    expect(processHookPayload(codex), agent).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { command: job(w, cmd) },
      },
    });
    expect(processFatTools(claudeSh(w, "bun run test && echo ok", extra)), agent).toBeNull();
    expect(processFatTools(claudeSh(w, "bun run test x | tail -5", extra)), agent).toBeNull();
  }
  for (const suite of SUITES) {
    const out = processFatTools(claudeSh(w, suite, implementer("implementer-fast")));
    expect(out, suite).toEqual(rewrite(w, suite.trim()));
  }
});

it("leaves other implementer commands to the existing rewrites", () => {
  const w = tmp.dir("gate-review-");
  const extra = implementer("implementer-fast");
  expect(processFatTools(claudeSh(w, "bun run typecheck", extra))).toBeNull();
  expect(processFatTools(claudeSh(w, "echo bun run test", extra))).toBeNull();
  expect(processFatTools(claudeSh(w, "ls src", extra))).toEqual({
    type: "rewrite",
    updatedInput: { command: "rtk ls src" },
  });
  const dump = processFatTools(claudeSh(w, "cat a.txt", extra));
  expect(dump).toMatchObject({ type: "rewrite" });
  expect(commandOf(dump)).toMatch(/node_modules\/\.bin\/repo job --job exec --query /);
  expect(processFatTools(claudeSh(w, job(w, "bun run test x"), extra))).toBeNull();
});

it("rewrites a parent's test run only while a review plan is in progress in its session", () => {
  const w = tmp.dir("gate-review-");
  const cmd = "bun run test x.test.ts";
  expect(processFatTools(claudeSh(w, cmd))).toBeNull();
  const plan = startReview(w);
  expect(processFatTools(claudeSh(w, cmd))).toEqual(rewrite(w, cmd));
  expect(processFatTools(claudeSh(w, "bun run test && echo ok"))).toBeNull();
  expect(processFatTools(claudeSh(w, cmd, { session_id: "other" }))).toBeNull();
  expect(processFatTools(claudeSh(w, cmd, { session_id: undefined }))).toBeNull();
  for (const [strategy, status] of NOT_PARENT) {
    fs.writeFileSync(plan, planText(strategy, status));
    expect(processFatTools(claudeSh(w, cmd)), `${strategy} ${status}`).toBeNull();
  }
});

it("leaves a scout child's command and a stampless default session unchanged", () => {
  const w = tmp.dir("gate-review-");
  startReview(w);
  expect(processFatTools(claudeSh(w, "bun run test x", implementer("scout")))).toBeNull();
  const other = tmp.dir("gate-review-");
  writeStamp(other, REVIEW_SID, planFile(other, "default").file);
  expect(processFatTools(claudeSh(other, "bun run test x"))).toBeNull();
});
