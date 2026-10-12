import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { probeProcess, readBootId } from "./board.mjs";
import { HOOK_CONTEXT_CHARS } from "./session-map.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "session-map.mjs");
const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmp(git: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-map-"));
  tmpDirs.push(root);
  if (git) spawnSync("git", ["init", "-q"], { cwd: root });
  return root;
}

function run(root: string, stdin: string, boardHome = tmpBoard()) {
  const env = { ...process.env };
  delete env.GROK_WORKSPACE_ROOT;
  delete env.CLAUDE_PROJECT_DIR;
  delete env.GROK_SESSION_ID;
  delete env.GROK_HOOK_EVENT;
  env.GRUNT_BOARD_HOME = boardHome;
  env.GRUNT_BOARD_PROVIDER = "claude";
  return spawnSync(process.execPath, [script], { cwd: root, input: stdin, encoding: "utf8", env });
}

function tmpBoard() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-map-board-"));
  tmpDirs.push(dir);
  return dir;
}

describe("session-map hook", () => {
  it("injects the map as SessionStart additionalContext and logs its size", () => {
    const root = tmp(true);
    fs.mkdirSync(path.join(root, "src/lib"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/lib/a.ts"), "");
    const r = run(root, JSON.stringify({ session_id: "s1", cwd: root }));
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput.additionalContext).toBe(
      "Folder map (code folders, complete; `…` = deeper, run `node scripts/folder-map.mjs <dir>`):\nsrc/lib/\n",
    );
    expect(out.decision).toBeUndefined();
    const log = JSON.parse(
      fs.readFileSync(path.join(root, ".tmp/grunt/sessions/s1/map.json"), "utf8"),
    );
    expect(log).toEqual({ rows: 1, tokens: 3, depth: 6 });
  });

  it("keeps additionalContext under the 10,000-char hook cap even with a 5k config budget", () => {
    const root = tmp(true);
    for (let a = 0; a < 40; a++) {
      for (let b = 0; b < 10; b++) {
        const dir = path.join(root, `area-${a}-long-segment-name`, `module-${b}-long-segment-name`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "x.ts"), "");
      }
    }
    fs.mkdirSync(path.join(root, ".rulesync"), { recursive: true });
    fs.writeFileSync(path.join(root, ".rulesync/grunt.map.jsonc"), '{ "budget": 5000 }');
    const r = run(root, JSON.stringify({ session_id: "s2", cwd: root }));
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    // Depth 2 would be ~11k chars, so every area stops at depth 1, marked `…`.
    expect(ctx.length).toBeLessThan(HOOK_CONTEXT_CHARS);
    for (let a = 0; a < 40; a++) expect(ctx).toContain(`area-${a}-long-segment-name/  …\n`);
  });

  it("SessionStart writes the board row and keeps additionalContext to the folder map", () => {
    const root = tmp(true);
    const board = tmpBoard();
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/a.ts"), "");
    const r = run(root, JSON.stringify({ session_id: "s-board", cwd: root }), board);
    expect(r.status).toBe(0);
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    expect(ctx).toBe(
      "Folder map (code folders, complete; `…` = deeper, run `node scripts/folder-map.mjs <dir>`):\nsrc/\n",
    );
    expect(ctx).not.toContain("s-board");
    const dir = path.join(board, ".grunt", "board");
    const names = fs.readdirSync(dir);
    expect(names).toHaveLength(1);
    const row = JSON.parse(fs.readFileSync(path.join(dir, names[0]), "utf8"));
    expect(row.session).toBe("s-board");
    expect(row.work).toBe("active");
    expect(row.provider).toBe("claude");
    const host = probeProcess(row.pid);
    expect(host?.start).toBe(row.start);
    expect(row.boot).toBe(readBootId());
  });

  it("prints nothing outside git, on empty maps, and on bad stdin", () => {
    expect(run(tmp(false), "{}")).toMatchObject({ status: 0, stdout: "" });
    expect(run(tmp(true), "{}")).toMatchObject({ status: 0, stdout: "" });
    const root = tmp(true);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/a.ts"), "");
    const r = run(root, "not json");
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain("src/");
  });
});
