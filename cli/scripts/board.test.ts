import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { digest, formatLine, hostIdentity, lines, note, otherLines, probeProcess, recordHook } from "./board.ts";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "board.ts");
const homes: string[] = [];
afterEach(() => {
  for (const d of homes.splice(0)) fs.rmSync(d, { force: true, recursive: true });
});

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-board-"));
  homes.push(dir);
  return dir;
}

const boot = "boot-a";
const alive = () => ({ comm: "claude", pid: 30, ppid: 1, start: "100" });

function writeRow(dir: string, extra: Record<string, unknown> = {}) {
  return note({
    boot,
    cwd: "/home/user/x",
    effort: "medium",
    home: dir,
    model: "fable 51",
    now: "2026-10-09T12:00:00Z",
    pid: 30,
    probe: alive,
    provider: "claude",
    session: "sid",
    start: "100",
    work: "updating auth",
    ...extra,
  });
}

describe("board", () => {
  it("prints time, provider, model, effort, session, directory, and work", () => {
    expect(
      formatLine({
        cwd: "/home/user/x",
        effort: "medium",
        model: "fable 51",
        provider: "claude",
        session: "sid",
        time: "2026-10-09T12:00:00Z",
        work: "updating auth",
      }),
    ).toBe("2026-10-09T12:00:00Z claude fable-51 medium sid /home/user/x updating auth");
    expect(
      formatLine({
        cwd: "/home/user/x",
        provider: "grok",
        session: "s2",
        time: "2026-10-09T12:00:01Z",
        work: "writing blog",
      }),
    ).toBe("2026-10-09T12:00:01Z grok - - s2 /home/user/x writing blog");
    const long = "w".repeat(90);
    expect(formatLine({ cwd: "/c", provider: "p", session: "s", time: "t", work: long })).toBe(
      `t p - - s /c ${"w".repeat(80)}`,
    );
  });

  it("keeps a row whose pid and start time still match", () => {
    const dir = home();
    writeRow(dir);
    writeRow(dir, { pid: 31, session: "other", start: "101", work: "other work" });
    const printed = lines({
      boot,
      home: dir,
      probe: (pid: number) => (pid === 30 ? { comm: "claude", pid: 30, ppid: 1, start: "100" } : null),
    });
    expect(printed).toStrictEqual(["2026-10-09T12:00:00Z claude fable-51 medium sid /home/user/x updating auth"]);
    const names = fs.readdirSync(path.join(dir, ".workerstack", "board"));
    expect(names.some((n) => n.includes("other"))).toBe(false);
    expect(names.some((n) => n.includes("sid"))).toBe(true);
  });

  it("deletes a row whose pid is gone, a zombie, or has no identity", () => {
    const dir = home();
    writeRow(dir, { pid: 9, session: "gone", work: "gone work" });
    fs.writeFileSync(
      path.join(dir, ".workerstack", "board", "claude-ghost.json"),
      `${JSON.stringify({ boot, provider: "claude", session: "ghost", time: "t", work: "ghost work" })}\n`,
    );
    fs.writeFileSync(path.join(dir, ".workerstack", "board", "bad.json"), "{");
    expect(lines({ boot, home: dir, probe: () => null })).toStrictEqual([]);
    expect(fs.readdirSync(path.join(dir, ".workerstack", "board"))).toStrictEqual([]);
    writeRow(dir, {
      pid: 8,
      probe: () => ({ comm: "claude", pid: 8, ppid: 1, start: "10" }),
      session: "recycled",
      start: "10",
      work: "recycled work",
    });
    expect(fs.readdirSync(path.join(dir, ".workerstack", "board"))).toHaveLength(1);
    expect(
      lines({
        boot,
        home: dir,
        probe: () => ({ comm: "claude", pid: 8, ppid: 1, start: "99" }),
      }),
    ).toStrictEqual([]);

    const stat = "10 (node) Z 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 12345";
    expect(probeProcess(10, { platform: "linux", readFile: () => stat })).toBeNull();
    expect(
      probeProcess(10, {
        platform: "linux",
        readFile: () => {
          throw new Error("enoent");
        },
      }),
    ).toBeNull();
  });

  it("deletes a row whose boot id does not match", () => {
    const dir = home();
    writeRow(dir, { boot: "old-boot", work: "stale boot" });
    expect(lines({ boot: "new-boot", home: dir, probe: alive })).toStrictEqual([]);
    expect(fs.readdirSync(path.join(dir, ".workerstack", "board"))).toStrictEqual([]);
  });

  it("keeps a set --work label across a later note", () => {
    const dir = home();
    writeRow(dir, { forceWork: true, work: "updating auth" });
    writeRow(dir, { now: "2026-10-09T12:05:00Z", work: "write the blog post" });
    expect(lines({ boot, home: dir, probe: alive })).toStrictEqual([
      "2026-10-09T12:05:00Z claude fable-51 medium sid /home/user/x updating auth",
    ]);
  });

  it("omits the current session from the digest and caps other lines at 8", () => {
    const dir = home();
    const roster = (pid: number) => {
      if (pid === 30) return { comm: "claude", pid, ppid: 1, start: "100" };
      if (pid >= 100) return { comm: "claude", pid, ppid: 1, start: String(100 + pid) };
      return null;
    };
    writeRow(dir, { now: "2026-10-09T12:00:00Z", probe: roster, session: "self", work: "my work" });
    for (let i = 0; i < 9; i++) {
      writeRow(dir, {
        now: `2026-10-09T12:0${i}:00Z`,
        pid: 100 + i,
        probe: roster,
        session: `o${i}`,
        start: String(200 + i),
        work: `other-${i}`,
      });
    }
    const probe = roster;
    const text = digest({ boot, home: dir, probe, provider: "claude", session: "self" });
    expect(text).not.toContain("my work");
    expect(text).not.toContain("other-0");
    expect(text).toContain("other-1");
    expect(text).toContain("other-8");
    expect(text.split("\n")).toHaveLength(8);
  });

  it("replaces the same session file with the new process before the sweep", () => {
    const dir = home();
    writeRow(dir, {
      pid: 1,
      probe: (pid: number) => (pid === 1 ? { comm: "claude", pid: 1, ppid: 1, start: "10" } : null),
      start: "10",
      work: "old process",
    });
    writeRow(dir, {
      now: "2026-10-09T12:09:00Z",
      pid: 2,
      probe: (pid: number) => (pid === 2 ? { comm: "claude", pid: 2, ppid: 1, start: "99" } : null),
      start: "99",
      work: "new process",
    });
    const printed = lines({
      boot,
      home: dir,
      probe: (pid: number) => (pid === 2 ? { comm: "claude", pid: 2, ppid: 1, start: "99" } : null),
    });
    expect(printed).toStrictEqual(["2026-10-09T12:09:00Z claude fable-51 medium sid /home/user/x new process"]);
  });

  it("walks past a short-lived shell to the host process", () => {
    const probe = (pid: number) => {
      if (pid === 50) return { comm: "node", pid: 50, ppid: 40, start: "1" };
      if (pid === 40) return { comm: "sh", pid: 40, ppid: 30, start: "2" };
      if (pid === 30) return { comm: "claude", pid: 30, ppid: 1, start: "3" };
      return null;
    };
    expect(hostIdentity({ pid: 50, probe })).toStrictEqual({ pid: 30, start: "3" });
    expect(hostIdentity({ pid: 40, probe })).toStrictEqual({ pid: 30, start: "3" });
  });

  it("probes linux, darwin, and windows without process.kill", () => {
    const src = fs.readFileSync(script, "utf8");
    expect(src).not.toMatch(/process\.kill/);
    const live = "10 (my node) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 12345";
    expect(probeProcess(10, { platform: "linux", readFile: () => live })).toStrictEqual({
      comm: "my node",
      pid: 10,
      ppid: 1,
      start: "12345",
    });
    const ps = (cmd: string, args: string[]) => {
      expect(cmd).toBe("ps");
      expect(args).toContain("10");
      return { status: 0, stdout: "11 Thu Oct  9 12:00:00 2026 /bin/zsh\n" };
    };
    expect(probeProcess(10, { platform: "darwin", spawn: ps })).toStrictEqual({
      comm: "zsh",
      pid: 10,
      ppid: 11,
      start: "Thu Oct  9 12:00:00 2026",
    });
    const pwsh = (cmd: string) => {
      expect(cmd).toMatch(/powershell/);
      return { status: 0, stdout: "11\ncmd.exe\n2026-10-09T12:00:00.0000000Z\n" };
    };
    expect(probeProcess(10, { platform: "win32", spawn: pwsh })).toStrictEqual({
      comm: "cmd.exe",
      pid: 10,
      ppid: 11,
      start: "2026-10-09T12:00:00.0000000Z",
    });
    expect(probeProcess(10, { platform: "win32", spawn: () => ({ status: 1, stdout: "" }) })).toBeNull();
  });

  it("recordHook writes the row and otherLines skips that session", () => {
    const dir = home();
    const env = { CLAUDE_PROJECT_DIR: "/home/user/x", REPO_BOARD_HOME: dir };
    const deps = {
      boot,
      identity: { pid: 30, start: "100" },
      now: "2026-10-09T12:00:00Z",
      probe: alive,
    };
    expect(recordHook({ session_id: "" }, env, deps)).toBeNull();
    expect(recordHook({ session_id: "default" }, env, deps)).toBeNull();
    const row = recordHook(
      {
        cwd: "/home/user/x",
        effort: { level: "medium" },
        model: "fable 51",
        prompt: "updating auth",
        session_id: "sid",
      },
      env,
      deps,
    );
    expect(row?.work).toBe("updating auth");
    const both = (pid: number) => {
      if (pid === 30) return { comm: "claude", pid, ppid: 1, start: "100" };
      if (pid === 31) return { comm: "claude", pid, ppid: 1, start: "101" };
      return null;
    };
    writeRow(dir, { pid: 31, probe: both, session: "other", start: "101", work: "other work" });
    const text = otherLines({ session_id: "sid" }, env, { boot, probe: both });
    expect(text).toContain("other work");
    expect(text).not.toContain("updating auth");
  });
});

describe("work label", () => {
  const env = (dir: string) => ({ CLAUDE_PROJECT_DIR: "/home/user/x", REPO_BOARD_HOME: dir });
  const deps = { boot, identity: { pid: 30, start: "100" }, now: "2026-10-09T12:00:00Z", probe: alive };
  const rendered = (dir: string) => lines({ boot, home: dir, probe: alive }).join("\n");
  const label = (prompt: string) => {
    const dir = home();
    recordHook({ prompt, session_id: "sid" }, env(dir), deps);
    return rendered(dir).replace("2026-10-09T12:00:00Z claude - - sid /home/user/x ", "");
  };

  it("keeps pasted content out of other sessions' lines", () => {
    const dir = home();
    recordHook(
      {
        prompt:
          'check this <pasted_content id="ab12">Username alice9 Password hunter2hunter2</pasted_content id="ab12"> now',
        session_id: "sid",
      },
      env(dir),
      deps,
    );
    const both = (pid: number) => {
      if (pid === 30) return { comm: "claude", pid, ppid: 1, start: "100" };
      if (pid === 31) return { comm: "claude", pid, ppid: 1, start: "101" };
      return null;
    };
    const text = otherLines({ session_id: "viewer" }, env(dir), { boot, probe: both });
    expect(text).toContain("check this now");
    expect(text).not.toContain("alice9");
    expect(text).not.toContain("hunter2");
  });

  it("redacts secret-shaped values", () => {
    expect(label("deploy with token ghp_abcdefghijklmnopqrstuvwxyz0123")).toBe("deploy with token [redacted]");
    expect(label("password: s3cr3t")).toBe("password: [redacted]");
    expect(label("key Xk9pQ2mN7vR4tL8wZ3yB6cD1")).toBe("key [redacted]");
  });

  it("leaves ordinary words, paths, slugs and SHAs intact", () => {
    for (const text of [
      "ship the auth fix",
      "bypass the cache",
      "ask the user which flow",
      "fix task-list and disk-usage",
      "look at /home/lovro/Development/monorepo/projects/anyrow",
      "plan 20-board-drops-pasted-secrets",
      "revert 9fb96064c3a1e2b5d7f8091a2b3c4d5e6f708192",
    ])
      expect(label(text)).toBe(text);
  });

  it("drops image markers and keeps the previous label for a paste-only prompt", () => {
    expect(label("[Image #9] review this")).toBe("review this");
    const dir = home();
    recordHook({ prompt: "write the blog post", session_id: "sid" }, env(dir), deps);
    recordHook(
      { prompt: '<pasted_content id="x1">Username alice9</pasted_content id="x1">', session_id: "sid" },
      env(dir),
      deps,
    );
    expect(rendered(dir)).toContain("write the blog post");
    expect(rendered(dir)).not.toContain("alice9");
  });

  it("cleans a cut-off row already on disk", () => {
    const dir = home();
    const board = path.join(dir, ".workerstack", "board");
    fs.mkdirSync(board, { recursive: true });
    fs.writeFileSync(
      path.join(board, "claude-old.json"),
      `${JSON.stringify({
        boot,
        cwd: "/home/user/x",
        effort: "-",
        model: "-",
        pid: 30,
        provider: "claude",
        session: "old",
        start: "100",
        time: "2026-10-09T12:00:00Z",
        work: '[Image #9] <pasted_content id="c3cb"> Username alice9 Password hunter2',
      })}\n`,
    );
    const text = rendered(dir);
    expect(text).toContain("old");
    expect(text).not.toContain("pasted_content");
    expect(text).not.toContain("alice9");
    expect(text).not.toContain("hunter2");
  });

  it("drops every injected block and keeps the typed slash command", () => {
    expect(label('<cross-session-message from="uds:/run/x.sock">Area D done</cross-session-message> ok')).toBe("ok");
    expect(label('<agent-message from="a1">secret notes')).toBe("active");
    expect(label('<cross-session-message from="uds:/run/user/1000/cc-socks/2679701.sock" from-name')).toBe("active");
    expect(label("<command-name>/review-plan</command-name> <command-args>23</command-args>")).toBe("/review-plan 23");
  });

  it("redacts each secret once across write and render", () => {
    const out = label("use password=abc123 and sk-abcdefghijklmnopqrstuv");
    expect(out).toBe("use password=[redacted] and [redacted]");
    expect(out.match(/\[redacted\]/g)).toHaveLength(2);
  });
});
