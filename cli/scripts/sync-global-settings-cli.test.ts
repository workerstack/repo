import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { tempDir, useTempDirs } from "../sync/fixtures/temp-dirs.ts";
import { HOSTS, runYolo } from "./fixtures/sync-global-kit.ts";

useTempDirs();

const HINT = "run `bun repo yolo`";
const ALL_OK = "grok ok · claude ok · codex ok · antigravity ok · cursor ok";
const HOST_STATE_RE = /^\w+ missing [\w.-]+(,[\w.-]+)*$/;

/** A cwd with no manifest but a clean project grok config, so --check has nothing else to complain about. */
function bareCwd(): string {
  const cwd = tempDir("yolo-cwd-");
  fs.mkdirSync(path.join(cwd, ".grok"));
  fs.writeFileSync(path.join(cwd, ".grok/config.toml"), "[plugins]\nenabled = []\n");
  return cwd;
}

/** A home a default `repo yolo` run from `cwd` has filled. */
function appliedHome(prefix: string, cwd: string): string {
  const home = tempDir(prefix);
  runYolo([], home, cwd);
  return home;
}

it("applies by default and prints one apply line per host", () => {
  const home = tempDir("yolo-cli-");
  const r = runYolo([], home, bareCwd());
  expect(r.status).toBe(0);
  expect(r.stdout.trim().split("\n")).toStrictEqual(HOSTS.map((h) => `apply ${h.id} ${h.dest}`));
  for (const h of HOSTS) expect(fs.existsSync(path.join(home, h.dest))).toBe(true);
});

it("--dry-run prints dry-run lines and writes nothing", () => {
  const home = tempDir("yolo-cli-dry-");
  const r = runYolo(["--dry-run"], home);
  expect(r.status).toBe(0);
  expect(r.stdout.trim().split("\n")).toStrictEqual(HOSTS.map((h) => `dry-run ${h.id} ${h.dest}`));
  expect(fs.readdirSync(home)).toStrictEqual([]);
});

it("--host gemini, --apply, and --check with --dry-run exit 1 with their error", () => {
  const cases: [string[], string][] = [
    [["--host", "gemini"], "unknown host: gemini"],
    [["--apply"], "unknown flag: --apply"],
    [["--check", "--dry-run"], "--check and --dry-run do not combine"],
  ];
  for (const [args, error] of cases) {
    const r = runYolo(args, tempDir("yolo-cli-bad-"));
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe(error);
  }
});

it("--check on an empty home lists every host missing, then the hint, and exits 1", () => {
  const r = runYolo(["--check"], tempDir("yolo-cli-empty-"), bareCwd());
  expect(r.status).toBe(1);
  const [line = "", hint, ...rest] = r.stdout.trim().split("\n");
  expect(rest).toStrictEqual([]);
  expect(hint).toBe(HINT);
  const parts = line.split(" · ");
  expect(parts.map((p) => p.split(" ")[0])).toStrictEqual(HOSTS.map((h) => h.id));
  for (const p of parts) expect(p).toMatch(HOST_STATE_RE);
  expect(parts[0]).toContain("ui.permission_mode");
});

it("--check after an apply prints every host ok and exits 0, without the hint", () => {
  const cwd = bareCwd();
  const r = runYolo(["--check"], appliedHome("yolo-cli-ok-", cwd), cwd);
  expect(r.status).toBe(0);
  expect(r.stdout.trim()).toBe(ALL_OK);
  expect(r.stderr).toBe("");
});

it("--check names a changed key as differs", () => {
  const cwd = bareCwd();
  const home = appliedHome("yolo-cli-differs-", cwd);
  const file = path.join(home, ".claude/settings.json");
  const v = JSON.parse(fs.readFileSync(file, "utf8")) /* the claude payload's shape */ as {
    permissions: { defaultMode: string };
  };
  v.permissions.defaultMode = "default";
  fs.writeFileSync(file, JSON.stringify(v));
  const r = runYolo(["--check"], home, cwd);
  expect(r.status).toBe(1);
  expect(r.stdout.trim().split("\n")).toStrictEqual([
    "grok ok · claude differs permissions.defaultMode · codex ok · antigravity ok · cursor ok",
    HINT,
  ]);
});

it("--check marks an unparseable dest unreadable for that host only", () => {
  const cwd = bareCwd();
  const home = appliedHome("yolo-cli-unreadable-", cwd);
  fs.writeFileSync(path.join(home, ".claude/settings.json"), "{broken");
  const r = runYolo(["--check"], home, cwd);
  expect(r.status).toBe(1);
  expect(r.stdout.trim().split("\n")[0]).toBe("grok ok · claude unreadable · codex ok · antigravity ok · cursor ok");
});

it("--check --host claude prints that one host", () => {
  const r = runYolo(["--check", "--host", "claude"], tempDir("yolo-cli-one-"), bareCwd());
  expect(r.status).toBe(1);
  const line = r.stdout.trim().split("\n")[0] ?? "";
  expect(line).toMatch(/^claude missing /);
  expect(line).not.toContain(" · ");
});

it("--check reports a bad project grok config after the host line", () => {
  const cwd = bareCwd();
  const home = appliedHome("yolo-cli-project-", cwd);
  fs.writeFileSync(path.join(cwd, ".grok/config.toml"), "[features]\nx = 1\n");
  const r = runYolo(["--check"], home, cwd);
  expect(r.status).toBe(1);
  expect(r.stdout.trim()).toBe(ALL_OK);
  expect(r.stderr.trim()).toBe("project .grok/config.toml must not set [features] or [agent]");
});
