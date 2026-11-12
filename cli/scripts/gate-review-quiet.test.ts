import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { useTmp } from "./__fixtures__/gate-workspace.ts";
import { asChild, claudeCall, inSession, WRITE_KINDS } from "./__fixtures__/hook-payload.ts";
import { planFile, REVIEW_SID, reviewWrite, startReview } from "./__fixtures__/review-plan.ts";
import { processFatTools } from "./gate-fat-tools.ts";
import type { ToolArgs } from "./gate-harness.ts";
import type { HookInput } from "./hook-input.ts";
import { stampPath, writeStamp } from "./strategy.ts";

const tmp = useTmp();

const COMMANDS = [
  "bun run test x.test.ts",
  "bun run test && echo ok",
  "cat a.txt",
  "ls src",
  "git add x",
  "git commit -m x",
];

/** Parent and scout calls of every kind the gate handles, in one workspace. */
function calls(w: string): HookInput[] {
  function sent(tool: string, input: ToolArgs) {
    return inSession(claudeCall(w, tool, input), REVIEW_SID);
  }

  const out: HookInput[] = [];

  for (const kind of WRITE_KINDS) {
    const targets = [
      path.join(w, "src/x.ts"),
      path.join(w, ".tmp/repo/plans/p.md"),
      "tmp/notes.md",
      path.join(w, "packages/a/.tmp/repo/scratch/s.md"),
    ];

    for (const target of targets)
      out.push(reviewWrite(kind, { cwd: w, target }), asChild(reviewWrite(kind, { cwd: w, target }), "scout"));
  }

  for (const command of COMMANDS) out.push(sent("Bash", { command }), asChild(sent("Bash", { command }), "scout"));

  out.push(sent("Grep", { pattern: "x" }), sent("Read", { file_path: path.join(w, "src/a.ts") }));

  return out;
}

/** The answer to each call as text, with the workspace spelled `<ws>`. */
function answers(w: string): string[] {
  fs.mkdirSync(path.join(w, "src"), { recursive: true });
  fs.writeFileSync(path.join(w, "src/a.ts"), "x\n");
  // JSON doubles a win32 path's backslashes and shell commands spell it with slashes; both become <ws>.
  const spellings = [JSON.stringify(w).slice(1, -1), w.split(path.sep).join("/")];

  return calls(w).map((c) => {
    let text = JSON.stringify(processFatTools(c));

    for (const ws of spellings) text = text.split(ws).join("<ws>");

    return text;
  });
}

const states: [string, (w: string) => void][] = [
  ["default", (w) => startReview(w, { strategy: "default" })],
  ["ready", (w) => startReview(w, { status: "ready" })],
  ["done", (w) => startReview(w, { status: "done", strategy: "review-deep" })],
  ["blocked", (w) => startReview(w, { status: "blocked" })],
  ["stamp of a missing plan", (w) => writeStamp(w, REVIEW_SID, path.join(w, ".tmp/repo/plans/gone.md"))],
  [
    "corrupt stamp",
    (w) => {
      fs.mkdirSync(path.dirname(stampPath(w, REVIEW_SID)), { recursive: true });
      fs.writeFileSync(stampPath(w, REVIEW_SID), "{");
    },
  ],
  ["stamp for another session", (w) => writeStamp(w, "other", planFile(w, "review-fast").file)],
];

it(
  "without a running review the gate answers as it did before: " +
    "no stamp, no session id, or a stamp of an ended plan",
  () => {
    const base = answers(tmp.dir("gate-review-"));
    expect(base.filter((r) => r.includes('"deny"'))).toStrictEqual([]);
    expect(base.filter((r) => r === "null").length).toBeGreaterThan(30);

    for (const [name, arm] of states) {
      const w = tmp.dir("gate-review-");
      arm(w);
      expect(answers(w), name).toStrictEqual(base);
    }
  },
);
