import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { aliasOf } from "../../dev/test-paths";
import {
  agyEdit,
  claudeSh,
  claudeWrite,
  codexPatch,
  cursorWrite,
  deny,
  reasonOf,
  SID,
} from "./fixtures/checkout-calls.ts";
import { useTmp } from "./fixtures/gate-workspace.ts";
import {
  claudeCall,
  codexCall,
  heredoc,
  inSession,
  notDenied,
  patchAdd,
  patchUpdate,
} from "./fixtures/hook-payload.ts";
import { processFatTools, processHookPayload } from "./gate-fat-tools.ts";
import { mainCheckoutWriteReason } from "./worktree-guards.ts";

const tmp = useTmp();

it("denies a product write in the main checkout from a parent, a scout child and an implementer", () => {
  const r = tmp.committed("gate-main-");
  const file = path.join(r, "src/x.ts");
  for (const extra of [{}, { agent_type: "scout" }, { agent_type: "implementer-fast" }]) {
    expect(processFatTools(claudeWrite(r, file, extra)), JSON.stringify(extra)).toStrictEqual(deny(reasonOf(r)));
    const relative = processFatTools(claudeWrite(r, "src/x.ts", extra));
    expect(relative, `relative ${JSON.stringify(extra)}`).toStrictEqual(deny(reasonOf(r)));
  }
  const edit = inSession(claudeCall(r, "Edit", { file_path: file, new_string: "b", old_string: "a" }), SID);
  expect(processFatTools(edit)).toStrictEqual(deny(reasonOf(r)));
});

it("denies a Codex apply_patch (tool and shell heredoc), a Cursor Write and an Antigravity edit", () => {
  const r = tmp.committed("gate-main-");
  const file = path.join(r, "src/x.ts");
  expect(processFatTools(codexPatch(r, file))).toStrictEqual(deny(reasonOf(r)));
  expect(processFatTools(codexPatch(r, file, { agent_type: "scout" }))).toStrictEqual(deny(reasonOf(r)));
  const update = inSession(codexCall(r, "apply_patch", { command: patchUpdate(file) }), SID);
  expect(processFatTools(update)).toStrictEqual(deny(reasonOf(r)));
  const shell = claudeSh(r, heredoc(patchAdd(file)), { model: "m", turn_id: "t" });
  expect(processFatTools(shell)).toStrictEqual(deny(reasonOf(r)));
  expect(processFatTools(cursorWrite(r, file))).toStrictEqual(deny(reasonOf(r)));
  expect(processFatTools(agyEdit(r, file))).toStrictEqual(deny(reasonOf(r)));
  // The reply shape of each harness carries the reason.
  expect(processHookPayload(cursorWrite(r, file))).toMatchObject({ agent_message: reasonOf(r), permission: "deny" });
  expect(processHookPayload(codexPatch(r, file))).toMatchObject({
    hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: reasonOf(r) },
  });
});

it("lets .tmp, a worktree, scratch redirects and paths outside the root through", () => {
  const r = tmp.committed("gate-main-");
  const outside = path.join(os.tmpdir(), "gate-main-elsewhere", "x.ts");
  for (const file of [
    path.join(r, ".tmp/repo/n.md"),
    path.join(r, ".tmp/x.txt"),
    path.join(r, ".worktrees/a/src/x.ts"),
    path.join(r, "packages/a/.tmp/repo/x.md"),
    path.join(r, "tmp/notes.md"),
    outside,
  ]) {
    expect(notDenied(processFatTools(claudeWrite(r, file))), file).toBe(true);
    expect(notDenied(processFatTools(codexPatch(r, file))), `codex ${file}`).toBe(true);
    expect(notDenied(processFatTools(cursorWrite(r, file))), `cursor ${file}`).toBe(true);
    expect(notDenied(processFatTools(claudeWrite(r, file, { agent_type: "scout" }))), `scout ${file}`).toBe(true);
  }
  // A shell run in a worktree can write there too: the guard reads the write tools, not the cwd.
  expect(notDenied(processFatTools(claudeWrite(path.join(r, ".worktrees/a"), "src/x.ts")))).toBe(true);
});

it("judges the canonical path through a symlink to the root", () => {
  const r = tmp.committed("gate-main-");
  const alias = aliasOf(r);
  expect(processFatTools(claudeWrite(alias, path.join(alias, "src/x.ts")))).toStrictEqual(deny(reasonOf(r)));
  expect(processFatTools(claudeWrite(r, path.join(alias, "src/x.ts")))).toStrictEqual(deny(reasonOf(r)));
  expect(notDenied(processFatTools(claudeWrite(alias, path.join(alias, ".worktrees/a/src/x.ts"))))).toBe(true);
  expect(notDenied(processFatTools(claudeWrite(alias, path.join(alias, ".tmp/repo/n.md"))))).toBe(true);
  expect(processFatTools(claudeSh(alias, "git commit -m x"))).toMatchObject({ type: "deny" });
});

it("passes a non-git dir and a repo with no commit yet, then denies once it has one", () => {
  const plain = tmp.dir("gate-plain-");
  const unborn = tmp.dir("gate-unborn-");
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: unborn });
  for (const dir of [plain, unborn]) {
    expect(processFatTools(claudeWrite(dir, path.join(dir, "src/x.ts"))), dir).toBeNull();
    expect(processFatTools(claudeSh(dir, "git commit -m x")), dir).toBeNull();
    expect(processFatTools(claudeSh(dir, "git push --force")), dir).toBeNull();
  }
  const identity = ["-c", "user.email=t@t", "-c", "user.name=t"];
  spawnSync("git", [...identity, "commit", "-q", "--allow-empty", "-m", "i"], { cwd: unborn });
  expect(processFatTools(claudeWrite(unborn, path.join(unborn, "src/x.ts")))).toStrictEqual(deny(reasonOf(unborn)));
  expect(processFatTools(claudeSh(unborn, "git commit -m x"))).toMatchObject({ type: "deny" });
});

it("reads win32 spellings of the root", () => {
  const roots = { checkout: "C:\\r", cwd: "C:\\r", root: "C:\\r" };
  const check = (target: string) => mainCheckoutWriteReason(target, roots, { committed: () => true, p: path.win32 });
  const reason =
    "the main checkout is shared: run bun repo worktree add <name> and write under C:\\r\\.worktrees\\<name>; only C:\\r\\.tmp\\ is writable here";
  expect(check("C:\\r\\src\\x.ts")).toBe(reason);
  expect(check("c:/R/src/x.ts")).toBe(reason);
  expect(check("src\\x.ts")).toBe(reason);
  expect(check("C:\\r\\.tmp\\repo\\n.md")).toBeNull();
  expect(check("c:/R/.worktrees/a/src/x.ts")).toBeNull();
  expect(check("D:\\other\\x.ts")).toBeNull();
  expect(mainCheckoutWriteReason("C:\\r\\src\\x.ts", roots, { committed: () => false, p: path.win32 })).toBeNull();
});
