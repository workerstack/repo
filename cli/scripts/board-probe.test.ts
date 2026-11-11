import { expect, it } from "vitest";

import { tryChmod } from "./board-files.ts";
import { hostIdentity, parseProcStat, probeProcess, readBootId, rowAlive } from "./board-process.ts";
import { probeOf } from "./fixtures/board-kit.ts";

// 22 fields after "(comm)": state, ppid, then filler up to field 22 (starttime).
const stat = (comm: string, state: string, ppid: string) => `7 (${comm}) ${state} ${ppid} ${"0 ".repeat(17)}77`;

it("readBootId: reads the trimmed Linux boot id", () => {
  expect(readBootId({ platform: "linux", readFile: () => " abc-123\n" })).toBe("abc-123");
});

it("readBootId: is a dash on other platforms, an empty file, or an unreadable file", () => {
  expect(readBootId({ platform: "darwin", readFile: () => "abc" })).toBe("-");
  expect(readBootId({ platform: "linux", readFile: () => "  \n" })).toBe("-");
  expect(
    readBootId({
      platform: "linux",
      readFile: () => {
        throw new Error("ENOENT");
      },
    }),
  ).toBe("-");
});

it("readBootId: reads this machine's boot id by default", () => {
  expect(readBootId()).toMatch(/\S/);
});

it("parseProcStat: takes the command between the first ( and the last )", () => {
  expect(parseProcStat(stat("a (b) c", "S", "42"))).toStrictEqual({
    comm: "a (b) c",
    ppid: 42,
    start: "77",
    state: "S",
  });
});

it("parseProcStat: rejects text that is not a stat line", () => {
  expect(parseProcStat("no parens here")).toBeNull();
  expect(parseProcStat(") before (")).toBeNull();
  expect(parseProcStat("7 (short) S 1 2 3")).toBeNull();
  expect(parseProcStat(stat("x", "S", "not-a-number"))).toBeNull();
  expect(parseProcStat(undefined)).toBeNull();
});

it("probeProcess: answers null for pids that can never be a host", () => {
  for (const pid of [0, 1, -4, 2.5, "x", undefined])
    expect(probeProcess(pid, { platform: "linux", readFile: () => stat("x", "S", "1") })).toBeNull();
});

it("probeProcess: reads linux stat and drops zombies, garbage and unreadable processes", () => {
  const linux = (text: () => string) => probeProcess(10, { platform: "linux", readFile: text });
  expect(linux(() => stat("node", "S", "4"))).toStrictEqual({ comm: "node", pid: 10, ppid: 4, start: "77" });
  expect(linux(() => stat("node", "Z", "4"))).toBeNull();
  expect(linux(() => "garbage")).toBeNull();
  expect(
    linux(() => {
      throw new Error("ESRCH");
    }),
  ).toBeNull();
});

it("probeProcess: describes a live process of this runtime", () => {
  const info = probeProcess(process.pid);
  expect(info).toMatchObject({ pid: process.pid });
  expect(info?.start).toMatch(/\S/);
});

it("probeProcess: parses mac ps output and rejects failures and odd lines", () => {
  const ps = (stdout: string | undefined, status: number | null = 0) => ({ status, stdout });
  const mac = (r: ReturnType<typeof ps> | null | undefined) => probeProcess(10, { platform: "darwin", spawn: () => r });
  expect(mac(ps("11 Thu Oct  9 12:00:00 2026 /usr/bin/Node.exe\n"))?.comm).toBe("node");
  expect(mac(null)).toBeNull();
  expect(mac(undefined)).toBeNull();
  expect(mac(ps("", 1))).toBeNull();
  expect(mac(ps(undefined))).toBeNull();
  expect(mac(ps("not a ps line"))).toBeNull();
});

it("probeProcess: parses windows output and rejects failures and short or odd output", () => {
  const ps = (stdout: string | undefined, status: number | null = 0) => ({ status, stdout });
  const win = (r: ReturnType<typeof ps> | null) => probeProcess(10, { platform: "win32", spawn: () => r });
  expect(win(ps("11\r\ncmd.exe\r\n2026-10-09T12:00:00Z\r\n"))).toStrictEqual({
    comm: "cmd.exe",
    pid: 10,
    ppid: 11,
    start: "2026-10-09T12:00:00Z",
  });
  expect(win(null)).toBeNull();
  expect(win(ps("11\ncmd.exe\n", 0))).toBeNull();
  expect(win(ps(undefined))).toBeNull();
  expect(win(ps("x\ncmd.exe\n2026\n"))).toBeNull();
});

it("probeProcess: knows no other platform", () => {
  expect(probeProcess(10, { platform: "aix" })).toBeNull();
});

it("hostIdentity: is the first parent that is not a shell", () => {
  const probe = probeOf({
    20: { comm: "/bin/Bash", ppid: 30, start: "20s" },
    30: { comm: "claude", ppid: 1, start: "30s" },
    5: { ppid: 20 },
  });
  expect(hostIdentity({ pid: 5, probe })).toStrictEqual({ pid: 30, start: "30s" });
});

it("hostIdentity: is null when the chain ends, breaks, loops or never leaves the shells", () => {
  expect(hostIdentity({ pid: 5, probe: probeOf({}) })).toBeNull();
  expect(hostIdentity({ pid: 5, probe: probeOf({ 5: { ppid: 1 } }) })).toBeNull();
  expect(hostIdentity({ pid: 5, probe: probeOf({ 5: { ppid: 20 } }) })).toBeNull();
  expect(hostIdentity({ pid: 5, probe: probeOf({ 20: { start: "" }, 5: { ppid: 20 } }) })).toBeNull();
  expect(hostIdentity({ pid: 5, probe: probeOf({ 20: { comm: "claude", pid: 1 }, 5: { ppid: 20 } }) })).toBeNull();
  expect(hostIdentity({ pid: 5, probe: probeOf({ 20: { comm: "sh", ppid: 1 }, 5: { ppid: 20 } }) })).toBeNull();
  expect(hostIdentity({ pid: 5, probe: probeOf({ 20: { comm: "sh", ppid: 20 }, 5: { ppid: 20 } }) })).toBeNull();
  const shells = probeOf({
    20: { comm: "sh", ppid: 21 },
    21: { comm: "zsh", ppid: 22 },
    22: { comm: "dash", ppid: 23 },
    23: { comm: "ash", ppid: 24 },
    24: { comm: "claude", ppid: 1 },
    5: { ppid: 20 },
  });
  expect(hostIdentity({ pid: 5, probe: shells })).toBeNull();
});

it("hostIdentity: takes a parent with no command name as the host", () => {
  expect(hostIdentity({ pid: 5, probe: probeOf({ 20: { comm: "", start: "7" }, 5: { ppid: 20 } }) })).toStrictEqual({
    pid: 20,
    start: "7",
  });
});

it("hostIdentity: walks this process's own ancestry by default", () => {
  const found = hostIdentity();
  if (found) expect(found.pid).toBeGreaterThan(1);
  expect(hostIdentity({ probe: probeOf({ [process.pid]: { ppid: 40 }, 40: { comm: "claude" } }) })?.pid).toBe(40);
});

const row = { boot: "b", pid: 30, start: "100" };
const probe = probeOf({ 30: {} });

it("rowAlive: is true only when pid, start time and boot id all match", () => {
  expect(rowAlive(row, { boot: "b", probe })).toBe(true);
  expect(rowAlive({ ...row, start: "101" }, { boot: "b", probe })).toBe(false);
  expect(rowAlive(row, { boot: "other", probe })).toBe(false);
  expect(rowAlive(row, { probe })).toBe(false);
  expect(rowAlive({ pid: 30, start: "100" }, { probe })).toBe(true);
});

it("rowAlive: is false for a missing row, pid or start", () => {
  expect(rowAlive(null)).toBe(false);
  expect(rowAlive({ ...row, pid: null }, { boot: "b", probe })).toBe(false);
  expect(rowAlive({ ...row, start: null }, { boot: "b", probe })).toBe(false);
  expect(rowAlive({ ...row, start: "" }, { boot: "b", probe })).toBe(false);
});

it("rowAlive: is false when the probe throws, finds nothing or finds no start", () => {
  const boom = () => {
    throw new Error("probe failed");
  };
  expect(rowAlive(row, { boot: "b", probe: boom })).toBe(false);
  expect(rowAlive(row, { boot: "b", probe: probeOf({}) })).toBe(false);
  expect(rowAlive(row, { boot: "b", probe: probeOf({ 30: { start: "" } }) })).toBe(false);
});

it("rowAlive: recognises this very process with the default probe", () => {
  const self = probeProcess(process.pid);
  expect(rowAlive({ boot: "-", pid: process.pid, start: self?.start }, { boot: "-" })).toBe(true);
});

it("tryChmod: applies the mode and swallows a failure", () => {
  const calls: [string, number][] = [];
  tryChmod("/x", 0o600, (target, mode) => calls.push([target, mode]));
  expect(calls).toStrictEqual([["/x", 0o600]]);
  expect(() =>
    tryChmod("/x", 0o600, () => {
      throw new Error("EPERM");
    }),
  ).not.toThrow();
});
