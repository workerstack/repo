import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { spawnHook } from "./__fixtures__/run-hook.ts";
import { HOOK_ENV, mapOf, run, tmp, tmpBoard, type BoardRow } from "./__fixtures__/session-map-kit.ts";
import { probeProcess, readBootId } from "./board-process.ts";
import { HOOK_CONTEXT_CHARS, main as sessionMain } from "./session-map.ts";

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
    const out = mapOf(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput.additionalContext).toBe(
      "Folder map (code folders, complete; `…` = deeper, run `bun repo map <dir>`):\nsrc/lib/\n",
    );
    const log = JSON.parse(fs.readFileSync(path.join(root, ".tmp/repo/sessions/s1/map.json"), "utf8"));
    expect(log).toStrictEqual({ depth: 6, rows: 1, tokens: 3 });
  });
});

describe("session-map hook", () => {
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
    const ctx = mapOf(r.stdout).hookSpecificOutput.additionalContext;
    // Depth 2 would be ~11k chars, so every area stops at depth 1, marked `…`.
    expect(ctx.length).toBeLessThan(HOOK_CONTEXT_CHARS);

    for (let a = 0; a < 40; a++) expect(ctx).toContain(`area-${a}-long-segment-name/  …\n`);
  });
});

describe("session-map hook", () => {
  it("SessionStart writes the board row and keeps additionalContext to the folder map", () => {
    const root = tmp(true);
    const board = tmpBoard();
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/a.ts"), "");
    const r = run(root, JSON.stringify({ cwd: root, session_id: "s-board" }), board);
    expect(r.status).toBe(0);
    const ctx = mapOf(r.stdout).hookSpecificOutput.additionalContext;
    expect(ctx).toBe("Folder map (code folders, complete; `…` = deeper, run `bun repo map <dir>`):\nsrc/\n");
    expect(ctx).not.toContain("s-board");
    const dir = path.join(board, ".workerstack", "board");
    const names = fs.readdirSync(dir);
    expect(names).toHaveLength(1);
    const [name = ""] = names;
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    const row = JSON.parse(text) /* the board writes one row per session file */ as BoardRow;
    expect(row.session).toBe("s-board");
    expect(row.work).toBe("active");
    expect(row.provider).toBe("claude");
    const host = probeProcess(row.pid);
    expect(host?.start).toBe(row.start);
    expect(row.boot).toBe(readBootId());
  });
});

describe("session-map hook", () => {
  it("prints nothing outside git, on empty maps, and on bad stdin", () => {
    expect(run(tmp(false), "{}")).toMatchObject({ status: 0, stdout: "" });
    expect(run(tmp(true), "{}")).toMatchObject({ status: 0, stdout: "" });
    const root = tmp(true);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/a.ts"), "");
    const r = run(root, "not json");
    expect(r.status).toBe(0);
    expect(mapOf(r.stdout).hookSpecificOutput.additionalContext).toContain("src/");
  });
});
