import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { alive, BOOT, plantHome, writeRow } from "./__fixtures__/board-kit.ts";
import { formatLine } from "./board-line.ts";
import { digest, lines } from "./board.ts";
import type { ProcessInfo } from "./board.types.ts";

const boot = BOOT;

function onlyPid(pid: number, start: string): (asked: number) => ProcessInfo | null {
  return (asked: number) => (asked === pid ? { comm: "claude", pid, ppid: 1, start } : null);
}

/** Pid 30 started at 100, and every pid from 100 up started at 100 more than its pid. */
function roster(pid: number): ProcessInfo | null {
  if (pid === 30) return { comm: "claude", pid, ppid: 1, start: "100" };
  if (pid >= 100) return { comm: "claude", pid, ppid: 1, start: String(100 + pid) };
  return null;
}

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
  const dir = plantHome();
  writeRow(dir);
  writeRow(dir, { pid: 31, session: "other", start: "101", work: "other work" });
  const printed = lines({ boot, home: dir, probe: onlyPid(30, "100") });
  expect(printed).toStrictEqual(["2026-10-09T12:00:00Z claude fable-51 medium sid /home/user/x updating auth"]);
  const names = fs.readdirSync(path.join(dir, ".workerstack", "board"));
  expect(names.some((n) => n.includes("other"))).toBe(false);
  expect(names.some((n) => n.includes("sid"))).toBe(true);
});

it("deletes a row whose pid is gone, a zombie, or has no identity", () => {
  const dir = plantHome();
  writeRow(dir, { pid: 9, session: "gone", work: "gone work" });
  fs.writeFileSync(
    path.join(dir, ".workerstack", "board", "claude-ghost.json"),
    `${JSON.stringify({ boot, provider: "claude", session: "ghost", time: "t", work: "ghost work" })}\n`,
  );
  fs.writeFileSync(path.join(dir, ".workerstack", "board", "bad.json"), "{");
  expect(lines({ boot, home: dir, probe: () => null })).toStrictEqual([]);
  expect(fs.readdirSync(path.join(dir, ".workerstack", "board"))).toStrictEqual([]);
  writeRow(dir, { pid: 8, probe: onlyPid(8, "10"), session: "recycled", start: "10", work: "recycled work" });
  expect(fs.readdirSync(path.join(dir, ".workerstack", "board"))).toHaveLength(1);
  expect(lines({ boot, home: dir, probe: () => ({ comm: "claude", pid: 8, ppid: 1, start: "99" }) })).toStrictEqual([]);
});

it("deletes a row whose boot id does not match", () => {
  const dir = plantHome();
  writeRow(dir, { boot: "old-boot", work: "stale boot" });
  expect(lines({ boot: "new-boot", home: dir, probe: alive })).toStrictEqual([]);
  expect(fs.readdirSync(path.join(dir, ".workerstack", "board"))).toStrictEqual([]);
});

it("keeps a set --work label across a later note", () => {
  const dir = plantHome();
  writeRow(dir, { forceWork: true, work: "updating auth" });
  writeRow(dir, { now: "2026-10-09T12:05:00Z", work: "write the blog post" });
  expect(lines({ boot, home: dir, probe: alive })).toStrictEqual([
    "2026-10-09T12:05:00Z claude fable-51 medium sid /home/user/x updating auth",
  ]);
});

it("omits the current session from the digest and caps other lines at 8", () => {
  const dir = plantHome();
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
  const text = digest({ boot, home: dir, probe: roster, provider: "claude", session: "self" });
  expect(text).not.toContain("my work");
  expect(text).not.toContain("other-0");
  expect(text).toContain("other-1");
  expect(text).toContain("other-8");
  expect(text.split("\n")).toHaveLength(8);
});

it("replaces the same session file with the new process before the sweep", () => {
  const dir = plantHome();
  writeRow(dir, { pid: 1, probe: onlyPid(1, "10"), start: "10", work: "old process" });
  writeRow(dir, { now: "2026-10-09T12:09:00Z", pid: 2, probe: onlyPid(2, "99"), start: "99", work: "new process" });
  const printed = lines({ boot, home: dir, probe: onlyPid(2, "99") });
  expect(printed).toStrictEqual(["2026-10-09T12:09:00Z claude fable-51 medium sid /home/user/x new process"]);
});
