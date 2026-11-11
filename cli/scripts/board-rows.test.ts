import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { boardDir, boardHome, digest, lines, note, probeProcess, readBootId, sweep } from "./board.ts";
import { BOOT, plantHome, plantRowFile, probeOf, rowsDir } from "./fixtures/board-kit.ts";

afterEach(() => vi.restoreAllMocks());

const probe = probeOf({ 30: {}, 31: { start: "101" } });
const base = { provider: "claude", session: "sid", pid: 30, start: "100", boot: BOOT, probe };

it("boardHome: prefers REPO_BOARD_HOME and falls back to the user's home", () => {
  expect(boardHome({ REPO_BOARD_HOME: "/x" })).toBe("/x");
  vi.spyOn(os, "homedir").mockReturnValue("/planted/home");
  expect(boardHome({})).toBe("/planted/home");
  vi.stubEnv("REPO_BOARD_HOME", "/from/process/env");
  expect(boardHome()).toBe("/from/process/env");
});

it("note: writes nothing without a real session, pid or start time", () => {
  const home = plantHome();
  for (const bad of [
    { session: "" },
    { session: "default" },
    { session: undefined },
    { pid: undefined },
    { start: undefined },
    { start: "" },
  ]) {
    expect(note({ ...base, home, ...bad })).toBeNull();
  }
  expect(fs.existsSync(boardDir(home))).toBe(false);
  expect(note()).toBeNull();
});

it("note: stores an empty boot id when none is given", () => {
  const home = plantHome();
  expect(note({ ...base, home, boot: undefined })).toMatchObject({ boot: "" });
});

it("note: stores model, effort and directory, with a dash for blanks", () => {
  const home = plantHome();
  const row = note({ ...base, home, model: "fable 51", effort: "high", cwd: "/a/b", now: "T1" });
  expect(row).toMatchObject({
    time: "T1",
    provider: "claude",
    model: "fable 51",
    effort: "high",
    cwd: "/a/b",
    pid: 30,
    start: "100",
    boot: BOOT,
  });
  const blank = note({ ...base, home, model: "  ", effort: null, cwd: undefined, now: "T2" });
  expect(blank).toMatchObject({ model: "-", effort: "-", cwd: "-" });
  expect(note({ ...base, home, model: null, effort: " ", now: "T3" })).toMatchObject({ model: "-", effort: "-" });
});

it("note: stamps the time from a Date, a number or the clock", () => {
  const home = plantHome();
  expect(note({ ...base, home, now: new Date("2026-10-09T12:00:00.789Z") })?.time).toBe("2026-10-09T12:00:00Z");
  expect(note({ ...base, home, now: 5 })?.time).toBe("5");
  expect(note({ ...base, home })?.time).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
});

it("note: chooses the work label: forced, sticky, typed, remembered, else active", () => {
  const home = plantHome();
  const work = (w: unknown, extra: Record<string, unknown> = {}) => note({ ...base, home, work: w, ...extra })?.work;
  expect(work("")).toBe("active");
  expect(work("typed one")).toBe("typed one");
  expect(work("")).toBe("typed one");
  expect(work("forced", { forceWork: true })).toBe("forced");
  expect(work("later prompt")).toBe("forced");
  expect(work("", { forceWork: true })).toBe("-");
  expect(work("after dash")).toBe("-");
  plantRowFile(home, "claude-sid.json", JSON.stringify({ sticky: true, work: "", pid: 30, start: "100", boot: BOOT }));
  expect(work("fresh")).toBe("fresh");
});

it("note: returns null when the sweep finds its own process gone", () => {
  const home = plantHome();
  expect(note({ ...base, home, probe: probeOf({}) })).toBeNull();
  expect(fs.readdirSync(rowsDir(home))).toStrictEqual([]);
});

it("note: finds the home from env and checks this very process by default", () => {
  const home = plantHome();
  const self = probeProcess(process.pid);
  const row = note({
    session: "mine",
    pid: process.pid,
    start: self?.start,
    boot: readBootId(),
    env: { REPO_BOARD_HOME: home },
  });
  expect(row?.session).toBe("mine");
  expect(lines({ env: { REPO_BOARD_HOME: home } })).toHaveLength(1);
});

it("sweep: is empty when the board directory does not exist", () => {
  expect(sweep({ home: plantHome() })).toStrictEqual([]);
});

it("sweep: drops unreadable rows and ignores other files", () => {
  const home = plantHome();
  const junk = ["bad.json", "null.json", "empty.json"];
  plantRowFile(home, "bad.json", "{not json");
  plantRowFile(home, "null.json", "null");
  plantRowFile(home, "empty.json", "{}");
  const other = plantRowFile(home, "notes.txt", "keep me");
  note({ ...base, home, now: "T1" });
  const kept = sweep({ home, boot: BOOT, probe });
  expect(kept.map((r) => r.session)).toStrictEqual(["sid"]);
  expect(fs.readdirSync(rowsDir(home)).sort()).toStrictEqual(["claude-sid.json", "notes.txt"]);
  expect(fs.readFileSync(other, "utf8")).toBe("keep me");
  expect(junk.every((name) => !fs.existsSync(path.join(rowsDir(home), name)))).toBe(true);
});

it("sweep: reads a sparse live row with empty fields and orders rows by time", () => {
  const home = plantHome();
  plantRowFile(home, "sparse.json", JSON.stringify({ pid: 31, start: 101, boot: BOOT }));
  note({ ...base, home, now: "2026-01-01T00:00:00Z" });
  const rows = sweep({ home, boot: BOOT, probe });
  expect(rows.map((r) => r.time)).toStrictEqual(["", "2026-01-01T00:00:00Z"]);
  expect(rows[0]).toMatchObject({ provider: "", sticky: false, pid: 31, start: "101", boot: BOOT });
});

it("sweep: drops a row with no pid, start or boot", () => {
  const home = plantHome();
  plantRowFile(home, "nopid.json", JSON.stringify({ start: "100" }));
  expect(sweep({ home, boot: "", probe })).toStrictEqual([]);
  plantRowFile(home, "nostart.json", JSON.stringify({ pid: 30 }));
  expect(sweep({ home, boot: "", probe })).toStrictEqual([]);
  plantRowFile(home, "noboot.json", JSON.stringify({ pid: 30, start: "100" }));
  expect(sweep({ home, boot: "", probe })).toHaveLength(1);
  expect(sweep({ home, probe })).toHaveLength(1);
});

it("sweep: checks with the default probe", () => {
  const home = plantHome();
  expect(sweep({ home, boot: BOOT })).toStrictEqual([]);
  const self = probeProcess(process.pid);
  plantRowFile(home, "self.json", JSON.stringify({ pid: process.pid, start: self?.start, boot: BOOT }));
  expect(sweep({ home, boot: BOOT })).toHaveLength(1);
});

it("lines and digest: lists live rows through the env home with the machine boot id", () => {
  const home = plantHome();
  const self = probeProcess(process.pid);
  note({ session: "mine", provider: "p", pid: process.pid, start: self?.start, boot: readBootId(), home, now: "T1" });
  vi.stubEnv("REPO_BOARD_HOME", home);
  expect(lines()).toStrictEqual(["T1 p - - mine - active"]);
  expect(digest()).toBe("T1 p - - mine - active");
  expect(digest({ provider: "p", session: "mine" })).toBe("");
});

it("lines and digest: shows the newest rows first and honours a cap", () => {
  const home = plantHome();
  for (const [i, session] of ["a", "b", "c"].entries()) note({ ...base, home, session, now: `T${i}`, boot: BOOT });
  const opts = { home, boot: BOOT, probe, session: "zzz", provider: "claude" };
  expect(
    digest(opts)
      .split("\n")
      .map((l) => l.split(" ")[0]),
  ).toStrictEqual(["T2", "T1", "T0"]);
  expect(digest({ ...opts, cap: 2 }).split("\n")).toHaveLength(2);
  expect(digest({ ...opts, cap: 0 })).toBe("");
});
