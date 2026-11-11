import path from "node:path";

import { expect, it } from "vitest";

import { useTmp } from "./fixtures/gate-workspace.ts";
import { camelCall, updatedInputOf } from "./fixtures/hook-payload.ts";
import { processFatTools, processHookPayload } from "./gate-fat-tools.ts";
import { rewriteScratchPath, rewriteScratchWrite } from "./gate-rewrites.ts";
import { canonicalPath } from "./workspace-root.ts";

const tmp = useTmp();
// A root that does not exist, in the spelling the product compares in (macOS expands /home).
const ws = canonicalPath("/home/ecomet/Development/repo-test-2");
const R = (root: string) => ({ checkout: root, cwd: root, root });
const nested = {
  checkout: path.resolve("/r"),
  cwd: path.join(path.resolve("/r"), "packages/a"),
  root: path.resolve("/r"),
};

it("rewriteScratchPath: rewrites outside-ws */.tmp/repo/* into workspace scratch", () => {
  expect(rewriteScratchPath("/tmp/host/.tmp/repo/notes.md", R(ws))).toBe(path.resolve(ws, ".tmp/repo/notes.md"));
  expect(rewriteScratchPath("/var/foo/.tmp/repo/handoffs/draft.md", R(ws))).toBe(
    path.resolve(ws, ".tmp/repo/handoffs/draft.md"),
  );
});

it("rewriteScratchPath: rejects empty, .., and escaped rel", () => {
  expect(rewriteScratchPath("", R(ws))).toBeNull();
  expect(rewriteScratchPath("/tmp/x/.tmp/repo/", R(ws))).toBeNull();
  expect(rewriteScratchPath("/tmp/x/.tmp/repo/../../etc/passwd", R(ws))).toBeNull();
  expect(rewriteScratchPath("/tmp/x/.tmp/repo/../escape.md", R(ws))).toBeNull();
  expect(rewriteScratchPath("/tmp/x/.tmp/repo//abs", R(ws))).not.toBe("/abs");
});

it("rewriteScratchPath: does not rewrite in-workspace paths or non-scratch", () => {
  expect(rewriteScratchPath(path.join(ws, ".tmp/repo/notes.md"), R(ws))).toBeNull();
  expect(rewriteScratchPath(path.join(ws, "src/index.ts"), R(ws))).toBeNull();
  expect(rewriteScratchPath("src/index.ts", R(ws))).toBeNull();
});

it("Write|Edit rewrites Write/Edit/write/search_replace path fields and never denies", () => {
  const outside = "/tmp/host/.tmp/repo/scratch/notes.md";
  const dest = path.resolve(ws, ".tmp/repo/scratch/notes.md");
  for (const toolName of ["Write", "Edit", "write", "search_replace"]) {
    const out = processFatTools(camelCall(toolName, { content: "x", file_path: outside }, { workspaceRoot: ws }));
    expect(out).toStrictEqual({ type: "rewrite", updatedInput: { content: "x", file_path: dest } });
  }
});

it("Write|Edit leaves a Write that orchestrate-parent persists to that hook", () => {
  for (const rel of ["notes.md", "plans/x.md", "roadmaps/x.md", "handoffs/x.md", "implementations/x.md"]) {
    const input = { content: "x", file_path: `/tmp/host/.tmp/repo/${rel}` };
    expect(processFatTools(camelCall("Write", input, { workspaceRoot: ws })), rel).toBeNull();
  }
});

it("Write|Edit: a Claude-style parent Write to src does not deny", () => {
  const write = { content: "export {}\n", file_path: path.join(ws, "src/index.ts") };
  expect(processFatTools(camelCall("Write", write, { workspaceRoot: ws }))).toBeNull();
  const edit = { file_path: "src/index.ts", new_string: "b", old_string: "a" };
  expect(processHookPayload(camelCall("Edit", edit, { workspaceRoot: ws }))).toBeNull();
});

it("Write|Edit does not rewrite an escaping scratch path and still does not deny", () => {
  const input = { content: "nope", file_path: "/tmp/x/.tmp/repo/../../etc/passwd" };
  expect(processFatTools(camelCall("Write", input, { workspaceRoot: ws }))).toBeNull();
});

it("rewrites repo-root notes.md and leaves README", () => {
  const root = tmp.dir("gate-scratch-");
  const write = (file: string) =>
    processFatTools(camelCall("Write", { content: "x", file_path: file }, { workspaceRoot: root }));
  expect(rewriteScratchWrite("notes.md", R(root))).toBe(path.join(root, ".tmp", "repo", "notes.md"));
  expect(rewriteScratchWrite("README.md", R(root))).toBeNull();
  expect(write("notes.md")?.type).toBe("rewrite");
  expect(updatedInputOf(write("notes.md")).file_path).toBe(path.join(root, ".tmp", "repo", "notes.md"));
  expect(write("README.md")).toBeNull();
});

it("nested scratch: sends a nested or worktree .tmp/repo Write to the root's", () => {
  const r = nested.root;
  const dest = path.join(r, ".tmp/repo/scratch/x.txt");
  expect(rewriteScratchPath(path.join(r, "packages/a/.tmp/repo/scratch/x.txt"), nested)).toBe(dest);
  expect(rewriteScratchPath(path.join(r, ".worktrees/w/.tmp/repo/scratch/x.txt"), nested)).toBe(dest);
  expect(rewriteScratchPath(".tmp/repo/scratch/x.txt", nested)).toBe(dest);
  expect(rewriteScratchPath(path.join(r, ".tmp/repo/verify/S/.tmp/repo/x"), nested)).toBeNull();
  expect(rewriteScratchPath(path.join(r, "packages/a/b.tmp/repo/x"), nested)).toBeNull();
});

it("nested scratch: matches below a root that itself sits under some .tmp/repo", () => {
  const s = path.resolve("/host/.tmp/repo/verify/S");
  const at = { checkout: s, cwd: path.join(s, "packages/a"), root: s };
  const dest = path.join(s, ".tmp/repo/scratch/x.txt");
  expect(rewriteScratchPath(path.join(s, "packages/a/.tmp/repo/scratch/x.txt"), at)).toBe(dest);
  expect(rewriteScratchPath(".tmp/repo/scratch/x.txt", at)).toBe(dest);
  expect(rewriteScratchPath(path.join(s, "packages/a/notes.md"), at)).toBeNull();
});

it("nested scratch: parses Windows paths with path.win32", () => {
  const w = { checkout: "C:\\r", cwd: "C:\\r\\packages\\a", root: "C:\\r" };
  expect(rewriteScratchPath("C:\\r\\packages\\a\\.tmp\\repo\\x.txt", w, path.win32)).toBe("C:\\r\\.tmp\\repo\\x.txt");
  expect(rewriteScratchPath(".tmp\\repo\\x.txt", w, path.win32)).toBe("C:\\r\\.tmp\\repo\\x.txt");
  expect(rewriteScratchPath("C:\\r\\.tmp\\repo\\x.txt", w, path.win32)).toBeNull();
});
