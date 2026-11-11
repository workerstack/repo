import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { VALID_LESSON } from "./fixtures/persist-bodies.ts";
import { must, orchestrateKit, plantSource, replyOf, type HookOut } from "./fixtures/orchestrate-kit.ts";

const kit = orchestrateKit();

/** One PreToolUse in Grok's shape, as session `sid`; the reply's hook output, or null when the hook stays silent. */
function pre(ws: string, call: { tool: string; input: Record<string, unknown> }, sid = "s1") {
  const fields = { toolName: call.tool, toolInput: call.input, session_id: sid };
  return replyOf(kit.grok({ ws }, "PreToolUse", fields))?.hookSpecificOutput ?? null;
}
const write = (file: string, content: string) => ({ tool: "Write", input: { file_path: file, content } });

function withSource(): string {
  const ws = kit.temp();
  plantSource(ws);
  fs.writeFileSync(path.join(ws, "other.ts"), "x\n");
  return ws;
}

const saveLesson = (ws: string): HookOut["hookSpecificOutput"] =>
  must(pre(ws, write(".repo/lessons/plan-forks.md", VALID_LESSON)));

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
  const out = must(pre(ws, { tool: "Edit", input: { file_path: file, old_string: "hits: 1", new_string: "hits: 2" } }));
  expect(out.permissionDecision).toBe("deny");
  expect(out.permissionDecisionReason).toMatch(/Write the full lesson/);
  expect(out.permissionDecisionReason).toMatch(/bun repo lessons hit/);
});

it("tells the session about a matching lesson once", () => {
  const ws = withSource();
  saveLesson(ws);
  const edit = { file_path: path.join(ws, "src/a.ts"), old_string: "x", new_string: "y" };
  const first = must(pre(ws, { tool: "Edit", input: edit }));
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
