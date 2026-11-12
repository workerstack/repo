import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { aliasOf } from "../../dev/test-paths";
import { useTmp } from "./__fixtures__/gate-workspace.ts";
import {
  asChild,
  camelCall,
  claudeCall,
  denyReason,
  inSession,
  notDenied,
  WRITE_KINDS,
  type WriteKind,
} from "./__fixtures__/hook-payload.ts";
import {
  grokReply,
  IMPLEMENTER_WRITE,
  planText,
  REVIEW_SID,
  reviewReason,
  reviewWrite,
  startReview,
} from "./__fixtures__/review-plan.ts";
import { processFatTools } from "./gate-fat-tools.ts";
import { harnessOf } from "./gate-harness.ts";
import { isOutsideRootTmp } from "./gate-review.ts";
import type { HookInput } from "./hook-input.ts";
import { ENFORCED_HARNESSES } from "./strategy.constants.ts";
import { activeReview } from "./strategy.ts";

const tmp = useTmp();

function deny(reason: string) {
  return { reason, type: "deny" };
}

function send(kind: WriteKind, w: string, target: string) {
  return processFatTools(reviewWrite(kind, { cwd: w, target }));
}

function sendAs(kind: WriteKind, w: string, spec: { target: string; type: string }) {
  return processFatTools(asChild(reviewWrite(kind, { cwd: w, target: spec.target }), spec.type));
}

/** What a parent write is answered when the review is enforced on its harness, else nothing. */
function parentAnswer(payload: HookInput, strategy = "review-fast") {
  return ENFORCED_HARNESSES.has(harnessOf(payload)) ? deny(reviewReason(strategy)) : null;
}

const ENDED: [string, string][] = [
  ["review-fast", "done"],
  ["review-fast", "blocked"],
  ["default", "in-progress"],
];

it.each(WRITE_KINDS)("%s: denies a parent product write and follows ENFORCED_HARNESSES", (kind) => {
  for (const strategy of ["review-fast", "review-deep"]) {
    const w = tmp.dir("gate-review-");
    startReview(w, { strategy });
    const payload = reviewWrite(kind, { cwd: w, target: path.join(w, "src/x.ts") });
    expect(processFatTools(payload), strategy).toStrictEqual(parentAnswer(payload, strategy));
    const nested = reviewWrite(kind, { cwd: w, target: path.join(w, "packages/a/.tmp/x.md") });
    expect(processFatTools(nested), strategy).toStrictEqual(parentAnswer(nested, strategy));
  }
});

it.each(WRITE_KINDS)("%s: allows the plan, the journal, .tmp and scratch, judged after the rewrite", (kind) => {
  const w = tmp.dir("gate-review-");
  const plan = startReview(w);

  const targets = [
    plan,
    path.join(w, ".tmp/repo/implementations/i.md"),
    path.join(w, ".tmp/x"),
    "tmp/notes.md",
    "./.tmp/repo/plans/p.md",
    `${w}/src/../.tmp/repo/plans/p.md`,
  ];

  for (const target of targets) expect(notDenied(send(kind, w, target)), target).toBe(true);
});

it.each(WRITE_KINDS)("%s: holds the deny for a spelling of a product path, and allows a child", (kind) => {
  const w = tmp.dir("gate-review-");
  startReview(w);
  const dotted = reviewWrite(kind, { cwd: w, target: `${w}/agents/../src/x.ts` });
  expect(processFatTools(dotted)).toStrictEqual(parentAnswer(dotted));
  const relative = reviewWrite(kind, { cwd: w, target: "src/x.ts" });
  expect(processFatTools(relative)).toStrictEqual(parentAnswer(relative));

  for (const type of ["implementer-fast", "implementer-deep", "scout"])
    expect(sendAs(kind, w, { target: path.join(w, "src/x.ts"), type }), type).toBeNull();
});

it.each(WRITE_KINDS)(
  "%s: allows after the plan is done or blocked, with no session id, or with a default plan",
  (kind) => {
    const w = tmp.dir("gate-review-");
    const plan = startReview(w);
    const product = reviewWrite(kind, { cwd: w, target: path.join(w, "src/x.ts") });
    expect(processFatTools(inSession(product, null))).toBeNull();
    expect(processFatTools(inSession(product, "other"))).toBeNull();

    for (const [strategy, status] of ENDED) {
      fs.writeFileSync(plan, planText(strategy, status));
      expect(send(kind, w, path.join(w, "src/x.ts")), `${strategy} ${status}`).toBeNull();
    }
  },
);

/** The answers an implementer gets for plan and journal writes, for other writes, and a scout for a plan write. */
function implementerAnswers(kind: WriteKind, w: string) {
  function as(type: string) {
    return (target: string) => sendAs(kind, w, { target, type });
  }

  const barred = [
    path.join(w, ".tmp/repo/plans/p.md"),
    path.join(w, ".tmp/repo/implementations/i.md"),
    "tmp/plans/p.md",
  ];

  const free = [path.join(w, "src/x.ts"), path.join(w, ".tmp/x"), path.join(w, ".tmp/repo/scratch/s.md")];
  free.push(path.join(w, ".tmp/repo/handoffs/h.md"));

  return {
    barred: barred.map(as("implementer-fast")),
    free: free.map(as("implementer-deep")),
    scout: as("scout")(path.join(w, ".tmp/repo/plans/p.md")),
  };
}

it.each(WRITE_KINDS)(
  "%s: denies an implementer's write to the plan or the journal under every strategy, and nothing else",
  (kind) => {
    for (const state of ["none", "default", "review-fast", "review-deep"]) {
      const w = tmp.dir("gate-review-");

      if (state !== "none") startReview(w, { strategy: state });
      const { barred, free, scout } = implementerAnswers(kind, w);
      expect(barred, state).toStrictEqual([deny(IMPLEMENTER_WRITE), deny(IMPLEMENTER_WRITE), deny(IMPLEMENTER_WRITE)]);
      expect(free.every(notDenied), state).toBe(true);
      expect(notDenied(scout), state).toBe(true);
    }
  },
);

it("a parent shell write is not parsed", () => {
  const w = tmp.dir("gate-review-");
  startReview(w);
  const shell = inSession(claudeCall(w, "Bash", { command: "echo hi > src/x.ts" }), REVIEW_SID);
  expect(processFatTools(shell)).toBeNull();
});

it("a Cursor parent write is allowed because Cursor is not enforced", () => {
  const w = tmp.dir("gate-review-");
  startReview(w);
  expect(ENFORCED_HARNESSES.has("cursor")).toBe(false);
  expect(send("cursor", w, path.join(w, "src/x.ts"))).toBeNull();
});

it(
  "a Cursor parent write in a committed repo is denied by the main-checkout guard " +
    "whatever ENFORCED_HARNESSES says",
  () => {
    const w = tmp.committed("gate-review-");
    startReview(w);
    expect(ENFORCED_HARNESSES.has("cursor")).toBe(false);
    const out = send("cursor", w, path.join(w, "src/x.ts"));
    expect(out?.type).toBe("deny");
    expect(denyReason(out)).toMatch(/^the main checkout is shared: run bun /);
    expect(send("cursor", w, path.join(w, ".worktrees/a/src/x.ts"))).toBeNull();
  },
);

it("a reviewer parent's product write inside a worktree still gets the review reason", () => {
  const w = tmp.committed("gate-review-");
  startReview(w);

  for (const kind of ["claudeWrite", "claudeEdit", "codexTool", "codexHeredoc"] as const)
    expect(send(kind, w, path.join(w, ".worktrees/a/src/x.ts")), kind).toStrictEqual(deny(reviewReason("review-fast")));
});

it("judges by the canonical path through an alias of the root, and for a path.win32 root", () => {
  const w = tmp.dir("gate-review-");
  const plan = startReview(w);
  const alias = aliasOf(w);

  for (const kind of ["claudeWrite", "codexTool", "codexHeredoc"] as const) {
    const product = reviewWrite(kind, { cwd: alias, target: path.join(alias, "src/x.ts") });
    expect(processFatTools(product), kind).toStrictEqual(parentAnswer(product));

    for (const target of [path.join(alias, ".tmp/repo/plans/p.md"), path.join(alias, ".tmp/x")])
      expect(notDenied(send(kind, alias, target)), `${kind} ${target}`).toBe(true);
  }

  expect(activeReview(alias, REVIEW_SID)?.plan).toBe(plan);
  const root = "C:\\r";
  expect(isOutsideRootTmp("C:\\r\\src\\x.ts", root, path.win32)).toBe(true);
  expect(isOutsideRootTmp("C:\\r\\.tmpx\\x", root, path.win32)).toBe(true);
  expect(isOutsideRootTmp("D:\\r\\.tmp\\x", root, path.win32)).toBe(true);
  expect(isOutsideRootTmp("c:\\R\\.TMP\\repo\\plans\\p.md", root, path.win32)).toBe(false);
  expect(isOutsideRootTmp("C:\\r\\.tmp\\x", root, path.win32)).toBe(false);
});

it("Grok: a parent write through orchestrate-parent follows ENFORCED_HARNESSES", () => {
  const w = tmp.dir("gate-review-");
  startReview(w);

  function run(extra: HookInput, file = path.join(w, "src/x.ts")) {
    return grokReply(w, { extra, input: { content: "x", file_path: file }, tool: "Write" });
  }

  const payload = camelCall("Write", {}, { hookEventName: "PreToolUse", session_id: REVIEW_SID, workspaceRoot: w });
  const parent = run({});
  const verdict = parent === null ? null : { decision: parent.decision, reason: parent.reason };
  const block = { decision: "block", reason: reviewReason("review-fast") };
  expect(verdict).toStrictEqual(ENFORCED_HARNESSES.has(harnessOf(payload)) ? block : null);
  expect(run({ subagent_type: "implementer-fast" })).toBeNull();
  expect(run({ subagent_type: "scout" })).toBeNull();
  expect(run({}, path.join(w, ".tmp/x.md"))?.decision).toBeUndefined();
});
