import { expect, it } from "vitest";

import { useTmp } from "./fixtures/gate-workspace.ts";
import { asChild, claudeCall, codexCall, inSession, notDenied } from "./fixtures/hook-payload.ts";
import { IMPLEMENTER_GIT, REVIEW_SID, startReview } from "./fixtures/review-plan.ts";
import { processFatTools } from "./gate-fat-tools.ts";
import type { HookInput } from "./hook-input.ts";

const tmp = useTmp();
const STAGING = [
  "git add src/x.ts",
  "git add -A",
  "git commit -m x",
  "git -C . commit -m x",
  "cd src && git add x.ts",
  "git add . && git status",
  "git --no-pager commit -m x",
];

it("an implementer's git add and git commit are denied under every strategy; reads and a parent's git pass", () => {
  for (const state of ["none", "default", "review-fast"]) {
    const w = tmp.dir("gate-review-");
    if (state !== "none") startReview(w, { strategy: state });
    const base = inSession(claudeCall(w, "Bash", { command: "" }), REVIEW_SID);
    function sh(command: string, extra: HookInput = {}) {
      return processFatTools({ ...base, agent_type: "implementer-fast", tool_input: { command }, ...extra });
    }
    for (const command of STAGING)
      expect(sh(command), `${state} ${command}`).toStrictEqual({ reason: IMPLEMENTER_GIT, type: "deny" });

    for (const command of ["git status", "git diff", "git log -1", "git diff --stat"])
      expect(notDenied(sh(command)), command).toBe(true);

    expect(sh("git add x", { agent_type: "scout" })).toBeNull();
    expect(sh("git commit -m x", { agent_type: undefined })).toBeNull();
    const codex = asChild(
      inSession(codexCall(w, "Bash", { command: "git commit -m x" }), REVIEW_SID),
      "implementer-deep",
    );
    expect(processFatTools(codex)).toStrictEqual({ reason: IMPLEMENTER_GIT, type: "deny" });
  }
});
