import path from "node:path";

import { expect, it } from "vitest";

import { useTmp } from "./__fixtures__/gate-workspace.ts";
import { camelCall, updatedInputOf } from "./__fixtures__/hook-payload.ts";
import { processFatTools, processHookPayload } from "./gate-fat-tools.ts";
import { rewriteScratchPath, rewriteScratchWrite } from "./gate-rewrites.ts";
import { canonicalPath } from "./workspace-root.ts";

const tmp = useTmp();

// A root that does not exist, in the spelling the product compares in (macOS expands /home).
const ws = canonicalPath("/home/dev/Development/repo-test-2");

function rootsAt(root: string) {
  return { checkout: root, cwd: root, root };
}

const nested = {
  checkout: path.resolve("/r"),
  cwd: path.join(path.resolve("/r"), "packages/a"),
  root: path.resolve("/r"),
};

it("rewriteScratchPath: rewrites outside-ws */.repo/scratch/* into workspace scratch", () => {
  expect(rewriteScratchPath("/tmp/host/.repo/scratch/notes.md", rootsAt(ws))).toBe(
    path.resolve(ws, ".repo/scratch/notes.md"),
  );
  expect(rewriteScratchPath("/var/foo/.repo/handoffs/draft.md", rootsAt(ws))).toBe(
    path.resolve(ws, ".repo/handoffs/draft.md"),
  );
});

it("rewriteScratchPath: rejects empty, .., and escaped rel", () => {
  expect(rewriteScratchPath("", rootsAt(ws))).toBeNull();
  expect(rewriteScratchPath("/tmp/x/.repo/scratch/", rootsAt(ws))).toBeNull();
  expect(rewriteScratchPath("/tmp/x/.repo/scratch/../../etc/passwd", rootsAt(ws))).toBeNull();
  expect(rewriteScratchPath("/tmp/x/.repo/scratch/../escape.md", rootsAt(ws))).toBeNull();
  expect(rewriteScratchPath("/tmp/x/.repo/scratch//abs", rootsAt(ws))).not.toBe("/abs");
});

it("rewriteScratchPath: does not rewrite in-workspace paths or non-scratch", () => {
  expect(rewriteScratchPath(path.join(ws, ".repo/scratch/notes.md"), rootsAt(ws))).toBeNull();
  expect(rewriteScratchPath(path.join(ws, "src/index.ts"), rootsAt(ws))).toBeNull();
  expect(rewriteScratchPath("src/index.ts", rootsAt(ws))).toBeNull();
});

it("Write|Edit rewrites Write/Edit/write/search_replace path fields and never denies", () => {
  const outside = "/tmp/host/.repo/scratch/scratch/notes.md";
  const dest = path.resolve(ws, ".repo/scratch/scratch/notes.md");

  for (const toolName of ["Write", "Edit", "write", "search_replace"]) {
    const out = processFatTools(camelCall(toolName, { content: "x", file_path: outside }, { workspaceRoot: ws }));
    expect(out).toStrictEqual({ type: "rewrite", updatedInput: { content: "x", file_path: dest } });
  }
});

it("Write|Edit leaves a Write that orchestrate-parent persists to that hook", () => {
  for (const rel of ["scratch/notes.md", "plans/x.md", "roadmaps/x.md", "handoffs/x.md", "implementations/x.md"]) {
    const input = { content: "x", file_path: `/tmp/host/.repo/${rel}` };
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
  const input = { content: "nope", file_path: "/tmp/x/.repo/scratch/../../etc/passwd" };
  expect(processFatTools(camelCall("Write", input, { workspaceRoot: ws }))).toBeNull();
});

it("rewrites repo-root notes.md and leaves README", () => {
  const root = tmp.dir("gate-scratch-");

  function write(file: string) {
    return processFatTools(camelCall("Write", { content: "x", file_path: file }, { workspaceRoot: root }));
  }

  expect(rewriteScratchWrite("notes.md", rootsAt(root))).toBe(path.join(root, ".repo", "scratch", "notes.md"));
  expect(rewriteScratchWrite("README.md", rootsAt(root))).toBeNull();
  expect(write("notes.md")?.type).toBe("rewrite");
  expect(updatedInputOf(write("notes.md")).file_path).toBe(path.join(root, ".repo", "scratch", "notes.md"));
  expect(write("README.md")).toBeNull();
});

it("nested scratch: sends a nested or worktree .repo/scratch Write to the root's", () => {
  const r = nested.root;
  const dest = path.join(r, ".repo/scratch/scratch/x.txt");
  expect(rewriteScratchPath(path.join(r, "packages/a/.repo/scratch/scratch/x.txt"), nested)).toBe(dest);
  expect(rewriteScratchPath(path.join(r, ".worktrees/w/.repo/scratch/scratch/x.txt"), nested)).toBe(dest);
  expect(rewriteScratchPath(".repo/scratch/scratch/x.txt", nested)).toBe(dest);
  expect(rewriteScratchPath(path.join(r, ".repo/scratch/verify/S/.repo/scratch/x"), nested)).toBeNull();
  expect(rewriteScratchPath(path.join(r, "packages/a/b.repo/scratch/x"), nested)).toBeNull();
});

it("nested scratch: matches below a root that itself sits under some .repo/scratch", () => {
  const s = path.resolve("/host/.repo/scratch/verify/S");
  const at = { checkout: s, cwd: path.join(s, "packages/a"), root: s };
  const dest = path.join(s, ".repo/scratch/scratch/x.txt");
  expect(rewriteScratchPath(path.join(s, "packages/a/.repo/scratch/scratch/x.txt"), at)).toBe(dest);
  expect(rewriteScratchPath(".repo/scratch/scratch/x.txt", at)).toBe(dest);
  expect(rewriteScratchPath(path.join(s, "packages/a/notes.md"), at)).toBeNull();
});

it("nested scratch: parses Windows paths with path.win32", () => {
  const w = { checkout: "C:\\r", cwd: "C:\\r\\packages\\a", root: "C:\\r" };
  const dest = "C:\\r\\.repo\\scratch\\x.txt";
  expect(rewriteScratchPath("C:\\r\\packages\\a\\.repo\\scratch\\x.txt", w, path.win32)).toBe(dest);
  expect(rewriteScratchPath(".repo\\scratch\\x.txt", w, path.win32)).toBe(dest);
  expect(rewriteScratchPath("C:\\r\\.repo\\scratch\\x.txt", w, path.win32)).toBeNull();
  expect(rewriteScratchPath("C:\\r\\.worktrees\\w\\.repo\\plans\\p.md", w, path.win32)).toBe(
    "C:\\r\\.repo\\plans\\p.md",
  );
  expect(rewriteScratchPath("C:\\r\\.worktrees\\w\\.repo\\tmp\\sync.json", w, path.win32)).toBeNull();
  expect(rewriteScratchPath("C:\\r\\.worktrees\\w\\.repo\\lessons\\l.md", w, path.win32)).toBeNull();
});

it("worktree .repo: ignored dirs land at the root, lessons and per-checkout state stay", () => {
  const r = nested.root;
  const wt = path.join(r, ".worktrees/w");
  expect(rewriteScratchPath(path.join(wt, ".repo/plans/x.md"), nested)).toBe(path.join(r, ".repo/plans/x.md"));
  expect(rewriteScratchPath(path.join(wt, ".repo/tmp/ci/a.json"), nested)).toBe(path.join(r, ".repo/tmp/ci/a.json"));
  expect(rewriteScratchPath(path.join(wt, ".repo/lessons/l.md"), nested)).toBeNull();
  expect(rewriteScratchPath(path.join(wt, ".repo/lint-baseline.json"), nested)).toBeNull();
  expect(rewriteScratchPath(path.join(wt, ".repo/tmp/sync.json"), nested)).toBeNull();
  expect(rewriteScratchPath(path.join(wt, ".repo/tmp/stage/a"), nested)).toBeNull();
  expect(rewriteScratchPath(path.join(r, "packages/a/.repo/tmp/sync.json"), nested)).toBeNull();
});

it("a stray top-level tmp dir lands in the root's .repo/scratch and the .tmp dir is left alone", () => {
  const r = nested.root;
  expect(rewriteScratchWrite(path.join(r, "tmp/n/x.md"), nested)).toBe(path.join(r, ".repo/scratch/n/x.md"));
  expect(rewriteScratchWrite(path.join(r, ".tmp/x.md"), nested)).toBeNull();
});

it("Write from a worktree: a plan moves to the root, a lesson and sync.json stay", () => {
  const root = tmp.dir("gate-wt-");
  const wt = path.join(root, ".worktrees/w");

  function write(file: string) {
    return processFatTools(camelCall("Write", { content: "x", file_path: file }, { workspaceRoot: root }));
  }

  expect(updatedInputOf(write(path.join(wt, ".repo/scratch/d/n.md"))).file_path).toBe(
    path.join(root, ".repo/scratch/d/n.md"),
  );
  expect(write(path.join(wt, ".repo/lessons/l.md"))).toBeNull();
  expect(write(path.join(wt, ".repo/tmp/sync.json"))).toBeNull();
});
