import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { must, orchestrateKit, plantSource, replyOf, type HookOut } from "./__fixtures__/orchestrate-kit.ts";
import { VALID_LESSON } from "./__fixtures__/persist-bodies.ts";
import type { ToolArgs } from "./gate-harness.ts";

const kit = orchestrateKit();

/** One PreToolUse in Grok's shape, as session `sid`; the reply's hook output, or null when the hook stays silent. */
function pre(ws: string, call: { tool: string; input: ToolArgs }, sid = "s1") {
  const fields = { session_id: sid, toolInput: call.input, toolName: call.tool };

  return replyOf(kit.grok({ ws }, "PreToolUse", fields))?.hookSpecificOutput ?? null;
}

function write(file: string, content: string) {
  return { input: { content, file_path: file }, tool: "Write" };
}

function withSource(): string {
  const ws = kit.temp();
  plantSource(ws);
  fs.writeFileSync(path.join(ws, "other.ts"), "x\n");

  return ws;
}

function saveLesson(ws: string): HookOut["hookSpecificOutput"] {
  return must(pre(ws, write(".repo/lessons/plan-forks.md", VALID_LESSON)));
}

it("hands a valid lesson to the host and regenerates the index", () => {
  const ws = withSource();
  const out = saveLesson(ws);
  expect(out.updatedInput.file_path).toBe(path.join(ws, ".repo/lessons/plan-forks.md"));
  expect(out.updatedInput.content).toMatch(/^hits: 1$/m);
  expect(fs.existsSync(path.join(ws, ".repo/lessons/plan-forks.md"))).toBe(false);
  expect(fs.readFileSync(path.join(ws, ".repo/lessons/INDEX.md"), "utf8")).toContain(
    "| .repo/lessons/plan-forks.md | src/** | 1 |",
  );
});

it("denies an invalid lesson with the validator reason", () => {
  const ws = withSource();
  const out = must(pre(ws, write(".repo/lessons/plan-forks.md", VALID_LESSON.replace('["src/**"]', '["lib/**"]'))));
  expect(out.permissionDecision).toBe("deny");
  expect(out.permissionDecisionReason).toMatch(/lib\/\*\* matches no file/);
});

it("denies an Edit of a lesson and names the routes that work", () => {
  const ws = withSource();
  saveLesson(ws);
  const file = path.join(ws, ".repo/lessons/plan-forks.md");
  const out = must(pre(ws, { input: { file_path: file, new_string: "hits: 2", old_string: "hits: 1" }, tool: "Edit" }));
  expect(out.permissionDecision).toBe("deny");
  expect(out.permissionDecisionReason).toMatch(/Write the full lesson/);
  expect(out.permissionDecisionReason).toMatch(/bun repo lessons hit/);
});

it("tells the session about a matching lesson once", () => {
  const ws = withSource();
  saveLesson(ws);
  const edit = { file_path: path.join(ws, "src/a.ts"), new_string: "y", old_string: "x" };
  const first = must(pre(ws, { input: edit, tool: "Edit" }));
  expect(first.additionalContext).toContain(".repo/lessons/plan-forks.md");
  expect(first.additionalContext).toContain("Rewriting a saved plan minted a new serial.");
  expect(pre(ws, write("src/a.ts", "z\n"))).toBeNull();
  expect(pre(ws, write("src/a.ts", "z\n"), "s2")?.additionalContext).toContain("plan-forks");
  expect(pre(ws, write("other.ts", "z\n"), "s3")).toBeNull();
});

it("stays quiet without lessons and fails open on a broken index", () => {
  const ws = withSource();
  expect(pre(ws, write("src/a.ts", "z\n"))).toBeNull();
  fs.mkdirSync(path.join(ws, ".repo/lessons"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".repo/lessons/INDEX.md"), "| .repo/lessons/x.md | [ | nope |\n");
  expect(pre(ws, write("src/a.ts", "z\n"))).toBeNull();
});
