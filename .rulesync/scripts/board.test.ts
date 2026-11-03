import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  digest,
  formatLine,
  hostIdentity,
  lines,
  note,
  otherLines,
  probeProcess,
  recordHook,
} from "./board.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "board.mjs");
const homes: string[] = [];
afterEach(() => {
  for (const d of homes.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grunt-board-"));
  homes.push(dir);
  return dir;
}

const boot = "boot-a";
const alive = () => ({ pid: 30, start: "100", comm: "claude", ppid: 1 });

function writeRow(dir: string, extra: Record<string, unknown> = {}) {
  return note({
    home: dir,
    provider: "claude",
    model: "fable 51",
    effort: "medium",
    session: "sid",
    cwd: "/home/user/x",
    work: "updating auth",
    pid: 30,
    start: "100",
    boot,
    now: "2026-10-09T12:00:00Z",
    probe: alive,
    ...extra,
  });
}

describe("board", () => {
  it("prints time, provider, model, effort, session, directory, and work", () => {
    expect(
      formatLine({
        time: "2026-10-09T12:00:00Z",
        provider: "claude",
        model: "fable 51",
        effort: "medium",
        session: "sid",
        cwd: "/home/user/x",
        work: "updating auth",
      }),
    ).toBe("2026-10-09T12:00:00Z claude fable-51 medium sid /home/user/x updating auth");
    expect(
      formatLine({
        time: "2026-10-09T12:00:01Z",
        provider: "grok",
        session: "s2",
        cwd: "/home/user/x",
        work: "writing blog",
      }),
    ).toBe("2026-10-09T12:00:01Z grok - - s2 /home/user/x writing blog");
    const long = "w".repeat(90);
    expect(formatLine({ time: "t", provider: "p", session: "s", cwd: "/c", work: long })).toBe(
      `t p - - s /c ${"w".repeat(80)}`,
    );
  });

  it("keeps a row whose pid and start time still match", () => {
    const dir = home();
    writeRow(dir);
    writeRow(dir, { session: "other", pid: 31, start: "101", work: "other work" });
    const printed = lines({
      home: dir,
      boot,
      probe: (pid: number) => (pid === 30 ? { pid: 30, start: "100", comm: "claude", ppid: 1 } : null),
    });
    expect(printed).toEqual([
      "2026-10-09T12:00:00Z claude fable-51 medium sid /home/user/x updating auth",
    ]);
    const names = fs.readdirSync(path.join(dir, ".grunt", "board"));
    expect(names.some((n) => n.includes("other"))).toBe(false);
    expect(names.some((n) => n.includes("sid"))).toBe(true);
  });

  it("deletes a row whose pid is gone, a zombie, or has no identity", () => {
    const dir = home();
    writeRow(dir, { session: "gone", pid: 9, work: "gone work" });
    fs.writeFileSync(
      path.join(dir, ".grunt", "board", "claude-ghost.json"),
      JSON.stringify({ provider: "claude", session: "ghost", work: "ghost work", boot, time: "t" }) + "\n",
    );
    fs.writeFileSync(path.join(dir, ".grunt", "board", "bad.json"), "{");
    expect(lines({ home: dir, boot, probe: () => null })).toEqual([]);
    expect(fs.readdirSync(path.join(dir, ".grunt", "board"))).toEqual([]);
    writeRow(dir, {
      session: "recycled",
      pid: 8,
      start: "10",
      work: "recycled work",
      probe: () => ({ pid: 8, start: "10", comm: "claude", ppid: 1 }),
    });
    expect(fs.readdirSync(path.join(dir, ".grunt", "board"))).toHaveLength(1);
    expect(
      lines({
        home: dir,
        boot,
        probe: () => ({ pid: 8, start: "99", comm: "claude", ppid: 1 }),
      }),
    ).toEqual([]);

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
    expect(lines({ home: dir, boot: "new-boot", probe: alive })).toEqual([]);
    expect(fs.readdirSync(path.join(dir, ".grunt", "board"))).toEqual([]);
  });

  it("keeps a set --work label across a later note", () => {
    const dir = home();
    writeRow(dir, { work: "updating auth", forceWork: true });
    writeRow(dir, { work: "write the blog post", now: "2026-10-09T12:05:00Z" });
    expect(lines({ home: dir, boot, probe: alive })).toEqual([
      "2026-10-09T12:05:00Z claude fable-51 medium sid /home/user/x updating auth",
    ]);
  });

  it("omits the current session from the digest and caps other lines at 8", () => {
    const dir = home();
    const roster = (pid: number) => {
      if (pid === 30) return { pid, start: "100", comm: "claude", ppid: 1 };
      if (pid >= 100) return { pid, start: String(100 + pid), comm: "claude", ppid: 1 };
      return null;
    };
    writeRow(dir, { session: "self", work: "my work", now: "2026-10-09T12:00:00Z", probe: roster });
    for (let i = 0; i < 9; i++) {
      writeRow(dir, {
        session: `o${i}`,
        pid: 100 + i,
        start: String(200 + i),
        work: `other-${i}`,
        now: `2026-10-09T12:0${i}:00Z`,
        probe: roster,
      });
    }
    const probe = roster;
    const text = digest({ home: dir, provider: "claude", session: "self", boot, probe });
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
      start: "10",
      work: "old process",
      probe: (pid: number) => (pid === 1 ? { pid: 1, start: "10", comm: "claude", ppid: 1 } : null),
    });
    writeRow(dir, {
      pid: 2,
      start: "99",
      work: "new process",
      now: "2026-10-09T12:09:00Z",
      probe: (pid: number) => (pid === 2 ? { pid: 2, start: "99", comm: "claude", ppid: 1 } : null),
    });
    const printed = lines({
      home: dir,
      boot,
      probe: (pid: number) => (pid === 2 ? { pid: 2, start: "99", comm: "claude", ppid: 1 } : null),
    });
    expect(printed).toEqual([
      "2026-10-09T12:09:00Z claude fable-51 medium sid /home/user/x new process",
    ]);
  });

  it("walks past a short-lived shell to the host process", () => {
    const probe = (pid: number) => {
      if (pid === 50) return { pid: 50, start: "1", comm: "node", ppid: 40 };
      if (pid === 40) return { pid: 40, start: "2", comm: "sh", ppid: 30 };
      if (pid === 30) return { pid: 30, start: "3", comm: "claude", ppid: 1 };
      return null;
    };
    expect(hostIdentity({ pid: 50, probe })).toEqual({ pid: 30, start: "3" });
    expect(hostIdentity({ pid: 40, probe })).toEqual({ pid: 30, start: "3" });
  });

  it("probes linux, darwin, and windows without process.kill", () => {
    const src = fs.readFileSync(script, "utf8");
    expect(src).not.toMatch(/process\.kill/);
    const live = "10 (my node) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 12345";
    expect(probeProcess(10, { platform: "linux", readFile: () => live })).toEqual({
      pid: 10,
      start: "12345",
      comm: "my node",
      ppid: 1,
    });
    const ps = (cmd: string, args: string[]) => {
      expect(cmd).toBe("ps");
      expect(args).toContain("10");
      return { status: 0, stdout: "11 Thu Oct  9 12:00:00 2026 /bin/zsh\n" };
    };
    expect(probeProcess(10, { platform: "darwin", spawn: ps })).toEqual({
      pid: 10,
      start: "Thu Oct  9 12:00:00 2026",
      comm: "zsh",
      ppid: 11,
    });
    const pwsh = (cmd: string) => {
      expect(cmd).toMatch(/powershell/);
      return { status: 0, stdout: "11\ncmd.exe\n2026-10-09T12:00:00.0000000Z\n" };
    };
    expect(probeProcess(10, { platform: "win32", spawn: pwsh })).toEqual({
      pid: 10,
      start: "2026-10-09T12:00:00.0000000Z",
      comm: "cmd.exe",
      ppid: 11,
    });
    expect(probeProcess(10, { platform: "win32", spawn: () => ({ status: 1, stdout: "" }) })).toBeNull();
  });

  it("recordHook writes the row and otherLines skips that session", () => {
    const dir = home();
    const env = { GRUNT_BOARD_HOME: dir, CLAUDE_PROJECT_DIR: "/home/user/x" };
    const deps = {
      identity: { pid: 30, start: "100" },
      boot,
      probe: alive,
      now: "2026-10-09T12:00:00Z",
    };
    expect(recordHook({ session_id: "" }, env, deps)).toBeNull();
    expect(recordHook({ session_id: "default" }, env, deps)).toBeNull();
    const row = recordHook(
      {
        session_id: "sid",
        model: "fable 51",
        effort: { level: "medium" },
        prompt: "updating auth",
        cwd: "/home/user/x",
      },
      env,
      deps,
    );
    expect(row?.work).toBe("updating auth");
    const both = (pid: number) => {
      if (pid === 30) return { pid, start: "100", comm: "claude", ppid: 1 };
      if (pid === 31) return { pid, start: "101", comm: "claude", ppid: 1 };
      return null;
    };
    writeRow(dir, { session: "other", pid: 31, start: "101", work: "other work", probe: both });
    const text = otherLines({ session_id: "sid" }, env, { boot, probe: both });
    expect(text).toContain("other work");
    expect(text).not.toContain("updating auth");
  });

  it("CLI prints a live fixture line and drops a dead pid", () => {
    if (process.platform !== "linux") return;
    const dir = home();
    const board = path.join(dir, ".grunt", "board");
    fs.mkdirSync(board, { recursive: true });
    const stat = fs.readFileSync("/proc/self/stat", "utf8");
    const end = stat.lastIndexOf(")");
    const start = stat.slice(end + 1).trim().split(/\s+/)[19];
    const bootId = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    fs.writeFileSync(
      path.join(board, "claude-live.json"),
      JSON.stringify({
        time: "2026-10-09T12:00:00Z",
        provider: "claude",
        model: "fable-51",
        effort: "medium",
        session: "live",
        cwd: "/home/user/x",
        work: "live fixture",
        pid: process.pid,
        start,
        boot: bootId,
      }) + "\n",
    );
    fs.writeFileSync(
      path.join(board, "claude-dead.json"),
      JSON.stringify({
        time: "2026-10-09T11:00:00Z",
        provider: "claude",
        model: "-",
        effort: "-",
        session: "dead",
        cwd: "/home/user/x",
        work: "dead fixture",
        pid: 2147483646,
        start: "1",
        boot: bootId,
      }) + "\n",
    );
    const r = spawnSync(process.execPath, [script, "--home", dir], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("live fixture");
    expect(r.stdout).not.toContain("dead fixture");
    expect(fs.existsSync(path.join(board, "claude-dead.json"))).toBe(false);
    expect(fs.existsSync(path.join(board, "claude-live.json"))).toBe(true);
  });
});

describe("work label", () => {
  const env = (dir: string) => ({ GRUNT_BOARD_HOME: dir, CLAUDE_PROJECT_DIR: "/home/user/x" });
  const deps = { identity: { pid: 30, start: "100" }, boot, probe: alive, now: "2026-10-09T12:00:00Z" };
  const rendered = (dir: string) => lines({ home: dir, boot, probe: alive }).join("\n");
  const label = (prompt: string) => {
    const dir = home();
    recordHook({ session_id: "sid", prompt }, env(dir), deps);
    return rendered(dir).replace("2026-10-09T12:00:00Z claude - - sid /home/user/x ", "");
  };

  it("keeps pasted content out of other sessions' lines", () => {
    const dir = home();
    recordHook(
      {
        session_id: "sid",
        prompt:
          'check this <pasted_content id="ab12">Username alice9 Password hunter2hunter2</pasted_content id="ab12"> now',
      },
      env(dir),
      deps,
    );
    const both = (pid: number) => {
      if (pid === 30) return { pid, start: "100", comm: "claude", ppid: 1 };
      if (pid === 31) return { pid, start: "101", comm: "claude", ppid: 1 };
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
    ]) {
      expect(label(text)).toBe(text);
    }
  });

  it("drops image markers and keeps the previous label for a paste-only prompt", () => {
    expect(label("[Image #9] review this")).toBe("review this");
    const dir = home();
    recordHook({ session_id: "sid", prompt: "write the blog post" }, env(dir), deps);
    recordHook({ session_id: "sid", prompt: '<pasted_content id="x1">Username alice9</pasted_content id="x1">' }, env(dir), deps);
    expect(rendered(dir)).toContain("write the blog post");
    expect(rendered(dir)).not.toContain("alice9");
  });

  it("cleans a cut-off row already on disk", () => {
    const dir = home();
    const board = path.join(dir, ".grunt", "board");
    fs.mkdirSync(board, { recursive: true });
    fs.writeFileSync(
      path.join(board, "claude-old.json"),
      JSON.stringify({
        time: "2026-10-09T12:00:00Z",
        provider: "claude",
        model: "-",
        effort: "-",
        session: "old",
        cwd: "/home/user/x",
        work: '[Image #9] <pasted_content id="c3cb"> Username alice9 Password hunter2',
        pid: 30,
        start: "100",
        boot,
      }) + "\n",
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
