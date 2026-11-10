import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { aliasOf } from "../../dev/test-paths";
import { processFatTools } from "./gate-fat-tools.ts";
import { activeReview, stampPath } from "./strategy.ts";
import { useTmp } from "./fixtures/gate-workspace.ts";
import { asChild, inSession, WRITE_KINDS, type WriteKind } from "./fixtures/hook-payload.ts";
import {
  grokReply,
  planFile,
  planText,
  REVIEW_SID,
  reviewWrite,
  stampContent,
  stamped,
} from "./fixtures/review-plan.ts";
import { VALID_PLAN } from "./fixtures/persist-bodies.ts";

const tmp = useTmp();
const put = (kind: WriteKind, w: string, write: { target: string; content?: string }) =>
  processFatTools(reviewWrite(kind, { cwd: w, ...write }));
/** Every stamp under the workspace's sessions, whatever the session id. */
const stampFiles = (w: string) => {
  const sessions = path.join(w, ".tmp/repo/sessions");
  if (!fs.existsSync(sessions)) return [];
  return fs.readdirSync(sessions).filter((d) => fs.existsSync(path.join(sessions, d, "strategy.json")));
};

it.each(WRITE_KINDS)(
  "%s: stamps the session on a parent save of a review plan, and changes nothing else about the answer",
  (kind) => {
    for (const strategy of ["review-fast", "review-deep"]) {
      const w = tmp.dir("gate-review-");
      const { file, text } = planFile(w, strategy, "ready");
      expect(put(kind, w, { target: file, content: text }), strategy).toBeNull();
      expect(stamped(w), strategy).toBe(true);
      expect(stampContent(w)).toEqual({ plan: file });
    }
  },
);

it.each(WRITE_KINDS)(
  "%s: stamps on a box tick of an in-progress review plan in a session with no stamp (resume)",
  (kind) => {
    const w = tmp.dir("gate-review-");
    const { file, text } = planFile(w, "review-deep");
    expect(stamped(w)).toBe(false);
    put(kind, w, { target: file, content: text });
    expect(activeReview(w, REVIEW_SID)).toEqual({ plan: file, serial: 3, strategy: "review-deep" });
  },
);

it.each(WRITE_KINDS)("%s: writes no stamp for a default plan, without a session id, or from a child", (kind) => {
  const w = tmp.dir("gate-review-");
  const dflt = planFile(w, "default");
  put(kind, w, { target: dflt.file, content: dflt.text });
  expect(stamped(w)).toBe(false);
  const rev = planFile(w, "review-fast");
  processFatTools(inSession(reviewWrite(kind, { cwd: w, target: rev.file, content: rev.text }), null));
  expect(stampFiles(w)).toEqual([]);
  for (const child of ["scout", "implementer-fast"]) {
    processFatTools(asChild(reviewWrite(kind, { cwd: w, target: rev.file, content: rev.text }), child));
    expect(stamped(w), child).toBe(false);
  }
});

it.each(WRITE_KINDS)(
  "%s: writes no stamp for a non-plan write, and the plan's own status decides afterwards",
  (kind) => {
    const w = tmp.dir("gate-review-");
    const { file, text } = planFile(w, "review-fast");
    put(kind, w, { target: path.join(w, "src/x.ts"), content: text });
    put(kind, w, { target: path.join(w, ".tmp/repo/roadmaps/r.md"), content: text });
    expect(stamped(w)).toBe(false);
    put(kind, w, { target: file, content: text });
    expect(activeReview(w, REVIEW_SID)?.strategy).toBe("review-fast");
    for (const status of ["done", "blocked", "ready"]) {
      fs.writeFileSync(file, planText("review-fast", status));
      expect(stamped(w), status).toBe(true);
      expect(activeReview(w, REVIEW_SID), status).toBeNull();
    }
  },
);

it("stamps from the Write content, not the file on disk", () => {
  const w = tmp.dir("gate-review-");
  const { file } = planFile(w, "default");
  put("claudeWrite", w, { target: file, content: planText("review-fast", "in-progress") });
  expect(stamped(w)).toBe(true);
  fs.rmSync(stampPath(w, REVIEW_SID));
  put("claudeWrite", w, { target: file, content: planText("default", "in-progress") });
  expect(stamped(w)).toBe(false);
});

it("stamps from the Content of an Antigravity write_file, not the file on disk", () => {
  const w = tmp.dir("gate-review-");
  const { file } = planFile(w, "default");
  put("antigravity", w, { target: file, content: planText("review-fast", "in-progress") });
  expect(stamped(w)).toBe(true);
  fs.rmSync(stampPath(w, REVIEW_SID));
  put("antigravity", w, { target: file, content: planText("default", "in-progress") });
  expect(stamped(w)).toBe(false);
});

it("stamps an alias spelling of the plan as the canonical path, once", () => {
  const w = tmp.dir("gate-review-");
  const { file, text } = planFile(w, "review-fast");
  const alias = aliasOf(w);
  const plan = "3-review-plan-20261107T181901Z.md";
  const spelled = [
    path.join(alias, ".tmp/repo/plans", plan),
    path.join(w, "agents/../.tmp/repo/plans", plan),
    path.join(w, "./.tmp/repo/plans/../plans", plan),
  ];
  for (const target of spelled) {
    put("claudeWrite", target.startsWith(alias) ? alias : w, { target, content: text });
    expect(stampContent(w), target).toEqual({ plan: file });
  }
  const left = fs.readdirSync(path.dirname(stampPath(w, REVIEW_SID))).filter((f) => f !== "wrote.txt");
  expect(left).toEqual(["strategy.json"]);
  expect(activeReview(alias, REVIEW_SID)?.plan).toBe(file);
});

it("fails open when the stamp cannot be written", () => {
  const w = tmp.dir("gate-review-");
  const { file, text } = planFile(w, "review-fast");
  fs.writeFileSync(path.join(w, ".tmp/repo/sessions"), "a file where the directory belongs");
  expect(put("claudeWrite", w, { target: file, content: text })).toBeNull();
  expect(put("claudeEdit", w, { target: path.join(w, "src/x.ts") })).toBeNull();
});

/** The plan Grok's persist hook would save, written the way the host does. */
function savedPlan(w: string, strategy: string) {
  const body = VALID_PLAN.replace("strategy: default", `strategy: ${strategy}`);
  const saved = grokReply(w, { tool: "Write", input: { file_path: ".tmp/repo/plans/x.md", content: body } });
  const filePath = String(saved?.hookSpecificOutput?.updatedInput?.file_path);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = String(saved?.hookSpecificOutput?.updatedInput?.content);
  fs.writeFileSync(filePath, content);
  return { file_path: filePath, content };
}
const tick = (file: string) => ({ file_path: file, old_string: "1.1 [ ]", new_string: "1.1 [x]" });

it("Grok: stamps on a valid Edit and on a full Write of a review plan, and not for default", () => {
  const w = tmp.dir("gate-review-");
  const review = savedPlan(w, "review-fast");
  expect(stamped(w)).toBe(false);
  expect(grokReply(w, { tool: "Edit", input: tick(review.file_path) })).toBeNull();
  expect(activeReview(w, REVIEW_SID)).toBeNull();
  expect(stampContent(w)).toEqual({ plan: review.file_path });
  fs.rmSync(stampPath(w, REVIEW_SID));
  grokReply(w, { tool: "Write", input: { file_path: review.file_path, content: review.content } });
  expect(stamped(w)).toBe(true);
  const other = tmp.dir("gate-review-");
  const dflt = savedPlan(other, "default");
  grokReply(other, { tool: "Edit", input: tick(dflt.file_path) });
  grokReply(other, { tool: "Write", input: { file_path: dflt.file_path, content: dflt.content } });
  expect(stamped(other)).toBe(false);
});

it("Grok: stamps nothing for a child", () => {
  const w = tmp.dir("gate-review-");
  const review = savedPlan(w, "review-fast");
  grokReply(w, { tool: "Edit", input: tick(review.file_path), extra: { subagent_type: "scout" } });
  expect(stamped(w)).toBe(false);
});
