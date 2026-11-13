import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { aliasOf } from "../../dev/test-paths";
import { useTmp } from "./__fixtures__/gate-workspace.ts";
import { asChild, inSession, WRITE_KINDS, type WriteKind } from "./__fixtures__/hook-payload.ts";
import { VALID_PLAN } from "./__fixtures__/persist-bodies.ts";
import {
  grokReply,
  planFile,
  planText,
  REVIEW_SID,
  reviewWrite,
  stampContent,
  stamped,
} from "./__fixtures__/review-plan.ts";
import { processFatTools } from "./gate-fat-tools.ts";
import { jsonText } from "./json-text.ts";
import { activeReview, stampPath } from "./strategy.ts";

const tmp = useTmp();

function put(kind: WriteKind, w: string, write: { target: string; content?: string }) {
  return processFatTools(reviewWrite(kind, { cwd: w, ...write }));
}

/** Every stamp under the workspace's sessions, whatever the session id. */
function stampFiles(w: string) {
  const sessions = path.join(w, ".repo/tmp/sessions");

  if (!fs.existsSync(sessions)) return [];

  return fs.readdirSync(sessions).filter((d) => fs.existsSync(path.join(sessions, d, "strategy.json")));
}

it.each(WRITE_KINDS)(
  "%s: stamps the session on a parent save of a review plan, and changes nothing else about the answer",
  (kind) => {
    for (const strategy of ["spawn-fast", "spawn-deep"]) {
      const w = tmp.dir("gate-review-");
      const { file, text } = planFile(w, strategy, "ready");
      expect(put(kind, w, { content: text, target: file }), strategy).toBeNull();
      expect(stamped(w), strategy).toBe(true);
      expect(stampContent(w)).toStrictEqual({ plan: file });
    }
  },
);

it.each(WRITE_KINDS)(
  "%s: stamps on a box tick of an in-progress review plan in a session with no stamp (resume)",
  (kind) => {
    const w = tmp.dir("gate-review-");
    const { file, text } = planFile(w, "spawn-deep");
    expect(stamped(w)).toBe(false);
    put(kind, w, { content: text, target: file });
    expect(activeReview(w, REVIEW_SID)).toStrictEqual({ plan: file, serial: 3, strategy: "spawn-deep" });
  },
);

it.each(WRITE_KINDS)("%s: writes no stamp for a default plan, without a session id, or from a child", (kind) => {
  const w = tmp.dir("gate-review-");
  const dflt = planFile(w, "free");
  put(kind, w, { content: dflt.text, target: dflt.file });
  expect(stamped(w)).toBe(false);
  const rev = planFile(w, "spawn-fast");
  processFatTools(inSession(reviewWrite(kind, { content: rev.text, cwd: w, target: rev.file }), null));
  expect(stampFiles(w)).toStrictEqual([]);

  for (const child of ["scout", "implementer-fast"]) {
    processFatTools(asChild(reviewWrite(kind, { content: rev.text, cwd: w, target: rev.file }), child));
    expect(stamped(w), child).toBe(false);
  }
});

it.each(WRITE_KINDS)(
  "%s: writes no stamp for a non-plan write, and the plan's own status decides afterwards",
  (kind) => {
    const w = tmp.dir("gate-review-");
    const { file, text } = planFile(w, "spawn-fast");
    put(kind, w, { content: text, target: path.join(w, "src/x.ts") });
    put(kind, w, { content: text, target: path.join(w, ".repo/roadmaps/r.md") });
    expect(stamped(w)).toBe(false);
    put(kind, w, { content: text, target: file });
    expect(activeReview(w, REVIEW_SID)?.strategy).toBe("spawn-fast");

    for (const status of ["done", "blocked", "ready"]) {
      fs.writeFileSync(file, planText("spawn-fast", status));
      expect(stamped(w), status).toBe(true);
      expect(activeReview(w, REVIEW_SID), status).toBeNull();
    }
  },
);

it("stamps from the Write content, not the file on disk", () => {
  const w = tmp.dir("gate-review-");
  const { file } = planFile(w, "free");
  put("claudeWrite", w, { content: planText("spawn-fast", "in-progress"), target: file });
  expect(stamped(w)).toBe(true);
  fs.rmSync(stampPath(w, REVIEW_SID));
  put("claudeWrite", w, { content: planText("free", "in-progress"), target: file });
  expect(stamped(w)).toBe(false);
});

it("stamps from the Content of an Antigravity write_file, not the file on disk", () => {
  const w = tmp.dir("gate-review-");
  const { file } = planFile(w, "free");
  put("antigravity", w, { content: planText("spawn-fast", "in-progress"), target: file });
  expect(stamped(w)).toBe(true);
  fs.rmSync(stampPath(w, REVIEW_SID));
  put("antigravity", w, { content: planText("free", "in-progress"), target: file });
  expect(stamped(w)).toBe(false);
});

it("stamps an alias spelling of the plan as the canonical path, once", () => {
  const w = tmp.dir("gate-review-");
  const { file, text } = planFile(w, "spawn-fast");
  const alias = aliasOf(w);
  const plan = "3-review-plan-20261107T181901Z.md";

  const spelled = [
    path.join(alias, ".repo/plans", plan),
    path.join(w, "agents/../.repo/plans", plan),
    path.join(w, "./.repo/plans/../plans", plan),
  ];

  for (const target of spelled) {
    put("claudeWrite", target.startsWith(alias) ? alias : w, { content: text, target });
    expect(stampContent(w), target).toStrictEqual({ plan: file });
  }

  const left = fs.readdirSync(path.dirname(stampPath(w, REVIEW_SID))).filter((f) => f !== "wrote.txt");
  expect(left).toStrictEqual(["strategy.json"]);
  expect(activeReview(alias, REVIEW_SID)?.plan).toBe(file);
});

it("fails open when the stamp cannot be written", () => {
  const w = tmp.dir("gate-review-");
  const { file, text } = planFile(w, "spawn-fast");
  fs.mkdirSync(path.join(w, ".repo/tmp"), { recursive: true });
  fs.writeFileSync(path.join(w, ".repo/tmp/sessions"), "a file where the directory belongs");
  expect(put("claudeWrite", w, { content: text, target: file })).toBeNull();
  expect(put("claudeEdit", w, { target: path.join(w, "src/x.ts") })).toBeNull();
});

/** The plan Grok's persist hook would save, written the way the host does. */
function savedPlan(w: string, strategy: string) {
  const body = VALID_PLAN.replace("strategy: free", `strategy: ${strategy}`);
  const saved = grokReply(w, { input: { content: body, file_path: ".repo/plans/x.md" }, tool: "Write" });
  const filePath = jsonText(saved?.hookSpecificOutput?.updatedInput?.file_path);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = jsonText(saved?.hookSpecificOutput?.updatedInput?.content);
  fs.writeFileSync(filePath, content);

  return { content, file_path: filePath };
}

function tick(file: string) {
  return { file_path: file, new_string: "1.1 [x]", old_string: "1.1 [ ]" };
}

it("Grok: stamps on a valid Edit and on a full Write of a review plan, and not for default", () => {
  const w = tmp.dir("gate-review-");
  const review = savedPlan(w, "spawn-fast");
  expect(stamped(w)).toBe(false);
  expect(grokReply(w, { input: tick(review.file_path), tool: "Edit" })).toBeNull();
  expect(activeReview(w, REVIEW_SID)).toBeNull();
  expect(stampContent(w)).toStrictEqual({ plan: review.file_path });
  fs.rmSync(stampPath(w, REVIEW_SID));
  grokReply(w, { input: { content: review.content, file_path: review.file_path }, tool: "Write" });
  expect(stamped(w)).toBe(true);
  const other = tmp.dir("gate-review-");
  const dflt = savedPlan(other, "free");
  grokReply(other, { input: tick(dflt.file_path), tool: "Edit" });
  grokReply(other, { input: { content: dflt.content, file_path: dflt.file_path }, tool: "Write" });
  expect(stamped(other)).toBe(false);
});

it("Grok: stamps nothing for a child", () => {
  const w = tmp.dir("gate-review-");
  const review = savedPlan(w, "spawn-fast");
  grokReply(w, { extra: { subagent_type: "scout" }, input: tick(review.file_path), tool: "Edit" });
  expect(stamped(w)).toBe(false);
});
