import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { probeProcess, readBootId } from "./board-process.ts";
import { runHook, spawnHook } from "./fixtures/run-hook.ts";
import { HOOK_CONTEXT_CHARS, fallbackNotice, header, main as sessionMain, sessionContext } from "./session-map.ts";

type MapOutput = {
  hookSpecificOutput: { hookEventName: string; additionalContext: string };
};

type BoardRow = {
  session: string;
  work: string;
  provider: string;
  pid: number;
  start: string;
  boot: string;
};

const tmpDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
});

function tmp(git: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-map-"));
  tmpDirs.push(root);
  if (git) spawnSync("git", ["init", "-q"], { cwd: root });
  return root;
}

const HOOK_ENV = {
  CLAUDE_PROJECT_DIR: undefined,
  GROK_HOOK_EVENT: undefined,
  GROK_SESSION_ID: undefined,
  GROK_WORKSPACE_ROOT: undefined,
  REPO_BOARD_PROVIDER: "claude",
};

/** Runs the hook in-process as if the host started it in `root`. */
function run(root: string, stdin: string, boardHome = tmpBoard()) {
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
  try {
    return runHook(sessionMain, stdin, { ...HOOK_ENV, REPO_BOARD_HOME: boardHome });
  } finally {
    cwd.mockRestore();
  }
}

const tmpBoard = () => tmp(false);

describe("repo hook session-map (spawned)", () => {
  it("answers a SessionStart payload through the real entry", () => {
    const root = tmp(true);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/a.ts"), "");
    const r = spawnHook(
      "session-map",
      { cwd: root, session_id: "s-spawn" },
      { cwd: root, env: { ...HOOK_ENV, REPO_BOARD_HOME: tmpBoard() } },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("SessionStart");
    expect(r.stdout).toContain("src/");
  });
});

describe("session-map hook on the process stdin", () => {
  it("reads the payload from stdin and answers on stdout, logging under the camelCase id", () => {
    const root = tmp(true);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/a.ts"), "");
    const payload = Buffer.from(JSON.stringify({ cwd: root, sessionId: "s-stdin" }));
    vi.spyOn(fs, "readSync").mockImplementationOnce((_fd, into) =>
      payload.copy(new Uint8Array(into.buffer, into.byteOffset, into.byteLength)),
    );
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.stubEnv("REPO_BOARD_HOME", tmpBoard());
    expect(sessionMain()).toBe(0);
    expect(String(out.mock.calls[0]?.[0])).toContain("src/");
    expect(fs.existsSync(path.join(root, ".tmp/repo/sessions/s-stdin/map.json"))).toBe(true);
  });
});

describe("session-map hook", () => {
  it("injects the map as SessionStart additionalContext and logs its size", () => {
    const root = tmp(true);
    fs.mkdirSync(path.join(root, "src/lib"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/lib/a.ts"), "");
    const r = run(root, JSON.stringify({ cwd: root, session_id: "s1" }));
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as MapOutput;
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput.additionalContext).toBe(
      "Folder map (code folders, complete; `…` = deeper, run `bun repo map <dir>`):\nsrc/lib/\n",
    );
    const log = JSON.parse(fs.readFileSync(path.join(root, ".tmp/repo/sessions/s1/map.json"), "utf8"));
    expect(log).toStrictEqual({ depth: 6, rows: 1, tokens: 3 });
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
    fs.mkdirSync(path.join(root, ".repo"), { recursive: true });
    fs.writeFileSync(path.join(root, ".repo/map.jsonc"), '{ "budget": 5000 }');
    const r = run(root, JSON.stringify({ cwd: root, session_id: "s2" }));
    const ctx = (JSON.parse(r.stdout) as MapOutput).hookSpecificOutput.additionalContext;
    // Depth 2 would be ~11k chars, so every area stops at depth 1, marked `…`.
    expect(ctx.length).toBeLessThan(HOOK_CONTEXT_CHARS);
    for (let a = 0; a < 40; a++) expect(ctx).toContain(`area-${a}-long-segment-name/  …\n`);
  });

  it("SessionStart writes the board row and keeps additionalContext to the folder map", () => {
    const root = tmp(true);
    const board = tmpBoard();
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/a.ts"), "");
    const r = run(root, JSON.stringify({ cwd: root, session_id: "s-board" }), board);
    expect(r.status).toBe(0);
    const ctx = (JSON.parse(r.stdout) as MapOutput).hookSpecificOutput.additionalContext;
    expect(ctx).toBe("Folder map (code folders, complete; `…` = deeper, run `bun repo map <dir>`):\nsrc/\n");
    expect(ctx).not.toContain("s-board");
    const dir = path.join(board, ".workerstack", "board");
    const names = fs.readdirSync(dir);
    expect(names).toHaveLength(1);
    // names has exactly one entry (asserted above)
    const row = JSON.parse(fs.readFileSync(path.join(dir, names[0]!), "utf8")) as BoardRow;
    expect(row.session).toBe("s-board");
    expect(row.work).toBe("active");
    expect(row.provider).toBe("claude");
    const host = probeProcess(row.pid);
    expect(host?.start).toBe(row.start);
    expect(row.boot).toBe(readBootId());
  });

  describe("in a linked worktree", () => {
    function worktree(withOwnInstall: boolean) {
      const main = fs.realpathSync(tmp(true));
      const git = (...a: string[]) =>
        spawnSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", ...a], { cwd: main, encoding: "utf8" });
      git("commit", "-q", "--allow-empty", "-m", "i");
      const wt = path.join(main, "..", `${path.basename(main)}-wt`);
      git("worktree", "add", "-q", wt);
      tmpDirs.push(wt);
      for (const dir of withOwnInstall ? [main, wt] : [main]) {
        fs.mkdirSync(path.join(dir, "node_modules", ".bin"), { recursive: true });
        fs.writeFileSync(path.join(dir, "node_modules", ".bin", "repo"), "");
      }
      fs.mkdirSync(path.join(wt, "src"), { recursive: true });
      fs.writeFileSync(path.join(wt, "src", "a.ts"), "");
      return { main, wt };
    }
    const ctxOf = (stdout: string) => (JSON.parse(stdout) as MapOutput).hookSpecificOutput.additionalContext;

    it("builds the notice only for the fallback bin", () => {
      const fallback = worktree(false);
      expect(fallbackNotice(fallback.wt)).toBe(
        `repo: hooks run ${path.join(fallback.main, "node_modules", ".bin", "repo")} (this worktree has no install); run \`bun install\` here to use its own code\n`,
      );
      expect(fallbackNotice(worktree(true).wt)).toBe("");
    });

    it("puts the notice before the map, and alone when there is no map", () => {
      const map = { depth: 6, rows: 1, text: "src/\n", tokens: 1 };
      expect(sessionContext("note\n", map)).toBe(`note\n${header(null)}\nsrc/\n`);
      expect(sessionContext("note\n", { ...map, text: "a/  …\n" })).toBe(`note\n${header(6)}\na/  …\n`);
      expect(sessionContext("note\n", null)).toBe("note\n");
      expect(sessionContext("", { ...map, text: "" })).toBe("");
    });

    it("says once which bin runs when the worktree has no install", () => {
      const { main, wt } = worktree(false);
      const r = run(wt, JSON.stringify({ cwd: wt, session_id: "s-wt" }));
      expect(r.status).toBe(0);
      const ctx = ctxOf(r.stdout);
      const notice = `repo: hooks run ${path.join(main, "node_modules", ".bin", "repo")} (this worktree has no install); run \`bun install\` here to use its own code\n`;
      expect(ctx.startsWith(notice)).toBe(true);
      expect(ctx.split("hooks run").length).toBe(2);
      expect(ctx).toContain("Folder map (");
    });

    it("stays quiet when the worktree has its own install", () => {
      const { wt } = worktree(true);
      const ctx = ctxOf(run(wt, JSON.stringify({ cwd: wt, session_id: "s-own" })).stdout);
      expect(ctx).not.toContain("hooks run");
      expect(ctx.startsWith("Folder map (")).toBe(true);
    });

    it("still says it when the map is empty", () => {
      const { wt } = worktree(false);
      fs.rmSync(path.join(wt, "src"), { recursive: true });
      const ctx = ctxOf(run(wt, JSON.stringify({ cwd: wt, session_id: "s-empty" })).stdout);
      expect(ctx).toContain("(this worktree has no install)");
      expect(ctx).not.toContain("Folder map (");
    });
  });

  it("prints nothing outside git, on empty maps, and on bad stdin", () => {
    expect(run(tmp(false), "{}")).toMatchObject({ status: 0, stdout: "" });
    expect(run(tmp(true), "{}")).toMatchObject({ status: 0, stdout: "" });
    const root = tmp(true);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/a.ts"), "");
    const r = run(root, "not json");
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as MapOutput).hookSpecificOutput.additionalContext).toContain("src/");
  });
});
