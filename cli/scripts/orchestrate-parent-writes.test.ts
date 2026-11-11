import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { must, orchestrateKit, replyOf, type HookOut } from "./__fixtures__/orchestrate-kit.ts";
import { DRAFT_ROADMAP, VALID_IMPL, VALID_PLAN, VALID_TMP } from "./__fixtures__/persist-bodies.ts";

const kit = orchestrateKit();

function pre(ws: string, toolName: string, toolInput: Record<string, unknown>): HookOut["hookSpecificOutput"] | null {
  return replyOf(kit.grok({ ws }, "PreToolUse", { toolInput, toolName }))?.hookSpecificOutput ?? null;
}
/** The path the hook hands back for a Write; the case fails when it hands none. */
function savedAt(ws: string, save: { file: string; content: string; tool?: string }): string {
  return must(pre(ws, save.tool ?? "write", { content: save.content, file_path: save.file })).updatedInput.file_path;
}
function read(file: string) {
  return fs.readFileSync(file, "utf8");
}

it("hands the host the absolute path of a new plan", () => {
  const ws = kit.temp();
  const saved = savedAt(ws, { content: VALID_PLAN, file: ".tmp/repo/plans/x.md", tool: "Write" });
  expect(path.dirname(saved)).toBe(path.join(ws, ".tmp/repo/plans"));
  expect(path.basename(saved)).toMatch(/^1-add-tmp-ignore-\d{8}T\d{6}Z\.md$/);
  expect(fs.existsSync(saved)).toBe(true);
});

it("rewrites whichever path key the host sent", () => {
  const ws = kit.temp();
  const out = must(pre(ws, "write", { content: VALID_TMP, path: ".tmp/repo/note.md" }));
  expect(out.updatedInput.file_path).toBeUndefined();
  expect(path.dirname(out.updatedInput.path)).toBe(path.join(ws, ".tmp/repo"));
  expect(fs.existsSync(out.updatedInput.path)).toBe(true);
});

it("saves a new roadmap under .tmp/repo/roadmaps with an absolute path", () => {
  const ws = kit.temp();
  const saved = savedAt(ws, { content: DRAFT_ROADMAP, file: ".tmp/repo/roadmaps/new.md" });
  expect(path.dirname(saved)).toBe(path.join(ws, ".tmp/repo/roadmaps"));
  expect(path.basename(saved)).toMatch(/^1-auth-program-\d{8}T\d{6}Z\.md$/);
  expect(fs.existsSync(saved)).toBe(true);
});

it("validates a full-body roadmap re-save and leaves the write to the host", () => {
  const ws = kit.temp();
  const saved = savedAt(ws, { content: DRAFT_ROADMAP, file: ".tmp/repo/roadmaps/new.md" });
  const before = read(saved);
  const body = DRAFT_ROADMAP.replace("strip narrating comments.", "strip narrating comments and logs.");
  const again = must(pre(ws, "write", { content: body, file_path: path.relative(ws, saved) }));
  expect(again.updatedInput.file_path).toBe(saved);
  expect(again.updatedInput.content).toMatch(/comments and logs\./);
  // The host writes it: a hook write first makes Claude Code refuse the Write as modified since read.
  expect(read(saved)).toBe(before);
});

it("leaves a write under docs/roadmaps alone", () => {
  const ws = kit.temp();
  expect(pre(ws, "write", { content: DRAFT_ROADMAP, file_path: "docs/roadmaps/new.md" })).toBeNull();
  expect(fs.existsSync(path.join(ws, "docs/roadmaps"))).toBe(false);
});

it("checks a roadmap Edit against the text it would produce", () => {
  const ws = kit.temp();
  const saved = savedAt(ws, { content: DRAFT_ROADMAP, file: ".tmp/repo/roadmaps/new.md" });
  const before = read(saved);
  const edit = { file_path: saved, new_string: "2 [ ] commit:", old_string: "2 [ ] commit diff pass:" };
  const broken = must(pre(ws, "Edit", edit));
  expect(broken.permissionDecision).toBe("deny");
  expect(broken.permissionDecisionReason).toContain('slice 2 needs "N [ ] {title, 2–6 words}: {one sentence}"');
  for (const [tool, input] of [
    ["Edit", { file_path: saved, new_string: "1 [x] auth types", old_string: "1 [ ] auth types" }],
    ["search_replace", { file_path: saved, new_string: "3.1 [x]", old_string: "3.1 [ ]" }],
  ] as const)
    expect(pre(ws, tool, input), tool).toBeNull();

  expect(read(saved)).toBe(before);
});

it("denies locking an unreviewed roadmap by Edit and allows it after a round", () => {
  const ws = kit.temp();
  const saved = savedAt(ws, { content: DRAFT_ROADMAP, file: ".tmp/repo/roadmaps/new.md" });
  const lock = { file_path: saved, new_string: "status: locked", old_string: "status: draft" };
  const denied = must(pre(ws, "Edit", lock));
  expect(denied.permissionDecision).toBe("deny");
  expect(denied.permissionDecisionReason).toMatch(/\/review-roadmap/);
  fs.writeFileSync(saved, read(saved).replace("reviews: 0", "reviews: 1"));
  expect(pre(ws, "Edit", lock)).toBeNull();
});

it("rewrites an existing plan in place and hands back its absolute path", () => {
  const ws = kit.temp();
  const saved = savedAt(ws, { content: VALID_PLAN, file: ".tmp/repo/plans/x.md", tool: "Write" });
  const before = read(saved);
  const body = before
    .replace("status: ready", "status: in-progress")
    .replace("reviews: 0", "reviews: 1")
    .replace("1.1 [ ]", "1.1 [x]");
  const again = must(pre(ws, "Write", { content: body, file_path: path.relative(ws, saved) }));
  expect(again.updatedInput.file_path).toBe(saved);
  expect(again.updatedInput.content).toMatch(/^1\.1 \[x\] /m);
  expect(fs.readdirSync(path.join(ws, ".tmp/repo/plans"))).toStrictEqual([path.basename(saved)]);
  // The host writes it: a hook write first makes Claude Code refuse the Write as modified since read.
  expect(read(saved)).toBe(before);
});

it("lets a valid Edit of an existing plan through", () => {
  const ws = kit.temp();
  const saved = savedAt(ws, { content: VALID_PLAN, file: ".tmp/repo/plans/x.md", tool: "Write" });
  const before = read(saved);
  for (const [tool, input] of [
    ["Edit", { file_path: saved, new_string: "1.1 [x]", old_string: "1.1 [ ]" }],
    ["search_replace", { file_path: saved, new_string: "1.2 [x]", old_string: "1.2 [ ]" }],
  ] as const)
    expect(pre(ws, tool, input), tool).toBeNull();

  expect(read(saved)).toBe(before);
});

it("denies starting an unreviewed plan by Edit and allows it after a round", () => {
  const ws = kit.temp();
  const saved = savedAt(ws, { content: VALID_PLAN, file: ".tmp/repo/plans/x.md", tool: "Write" });
  const flip = { file_path: saved, new_string: "status: in-progress", old_string: "status: ready" };
  const denied = must(pre(ws, "Edit", flip));
  expect(denied.permissionDecision).toBe("deny");
  expect(denied.permissionDecisionReason).toMatch(/\/review-plan/);
  fs.writeFileSync(saved, read(saved).replace("reviews: 0", "reviews: 1"));
  expect(pre(ws, "Edit", flip)).toBeNull();
});

it("denies an Edit that breaks a plan or drops a Previous mistakes entry", () => {
  const ws = kit.temp();
  const entry = "- review: Verify ran the whole suite → runs check-ignore only";
  const body = VALID_PLAN.replace("## Previous mistakes\n(none)", `## Previous mistakes\n${entry}`);
  const saved = savedAt(ws, { content: body, file: ".tmp/repo/plans/x.md", tool: "Write" });
  const broken = must(pre(ws, "Edit", { file_path: saved, new_string: "## Aim", old_string: "## Goal" }));
  expect(broken.permissionDecision).toBe("deny");
  const dropped = must(pre(ws, "Edit", { file_path: saved, new_string: "(none)", old_string: entry }));
  expect(dropped.permissionDecision).toBe("deny");
  expect(dropped.permissionDecisionReason).toContain("Verify ran the whole suite");
});

it("hands the host the absolute path of a full-body journal update", () => {
  const ws = kit.temp();
  const saved = savedAt(ws, { content: VALID_IMPL, file: ".tmp/repo/implementations/x.md", tool: "Write" });
  const again = must(pre(ws, "Write", { content: read(saved), file_path: path.relative(ws, saved) }));
  expect(again.updatedInput.file_path).toBe(saved);
});
