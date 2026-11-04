import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { liveSessions, nestedHolds, runClean } from "./clean.mjs";
import { SESSION_REL } from "./browser.mjs";
import { STASH_REL } from "./grunt-job.mjs";
import { LISTEN_DIR } from "./listen.mjs";
import { HANDOFF_DIR } from "./persist-handoff.mjs";
import { IMPLEMENTATION_DIR } from "./persist-implementation.mjs";
import { PLAN_DIR, nextSerial } from "./persist-plan.mjs";
import { ROADMAP_DIR } from "./persist-roadmap.mjs";
import { TMP_RESERVED_DIRS } from "./persist-tmp.mjs";
import { SPEAK_DIR } from "./speak.mjs";
import { ORCHESTRATOR_LOGS_DIR } from "../../.grok/hooks/orchestrate-parent.js";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const HOUR = 3600_000;
const LIVE = "11111111-aaaa-4bbb-8ccc-000000000001";
const DEAD = "22222222-aaaa-4bbb-8ccc-000000000002";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

// Sets the mtime of a path and everything under it, without following links.
function age(p: string, ms: number) {
  const st = fs.lstatSync(p);
  if (st.isDirectory()) for (const name of fs.readdirSync(p)) age(path.join(p, name), ms);
  if (!st.isSymbolicLink()) fs.utimesSync(p, new Date(NOW - ms), new Date(NOW - ms));
}

function put(root: string, rel: string, ms: number, body = "x") {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  age(file, ms);
  return file;
}

function repo() {
  const root = tempDir("grunt-clean-");
  execFileSync("git", ["init", "-q"], { cwd: root });
  fs.writeFileSync(path.join(root, ".gitignore"), ".tmp/\n");
  const t = ".tmp/grunt";
  put(root, `${t}/plans/1-a-20261103T000000Z.md`, 48 * HOUR);
  put(root, `${t}/roadmaps/1-r-20261103T000000Z.md`, 48 * HOUR);
  put(root, `${t}/handoffs/1-h-20261103T000000Z.md`, 48 * HOUR);
  put(root, `${t}/implementations/1-i-20261103T000000Z.md`, 48 * HOUR);
  put(root, `${t}/3-notes-20261103T120000Z.md`, 48 * HOUR);
  put(root, `${t}/old.log`, 2 * HOUR);
  put(root, `${t}/new.log`, 5 * 60_000);
  put(root, `${t}/review/notes.md`, 2 * HOUR);
  age(path.join(root, t, "review"), 2 * HOUR);
  put(root, `${t}/sessions/${LIVE}/wrote.txt`, 2 * HOUR);
  put(root, `${t}/sessions/${DEAD}/wrote.txt`, 2 * HOUR);
  put(root, `${t}/orchestrator-logs/ask-stop-${LIVE}`, 2 * HOUR);
  put(root, `${t}/orchestrator-logs/ask-stop-${DEAD}`, 2 * HOUR);
  put(root, `${t}/orchestrator-logs/ask-stop-default`, 2 * HOUR);
  put(root, `${t}/stash/old.txt`, 48 * HOUR);
  put(root, `${t}/stash/new.txt`, HOUR);
  put(root, `${t}/browser/session.json`, 48 * HOUR);
  // Adding a file bumps its dir's mtime; the session dirs were last touched with their files.
  age(path.join(root, t, "sessions", LIVE), 2 * HOUR);
  age(path.join(root, t, "sessions", DEAD), 2 * HOUR);
  return root;
}

function clean(root: string, dryRun = false) {
  const lines: string[] = [];
  const code = runClean({ root, now: NOW, liveSessions: new Set([LIVE]), dryRun, out: (l: string) => lines.push(l) });
  return { code, lines };
}

const rel = (root: string) => (p: string) => fs.existsSync(path.join(root, p));

describe("grunt clean", () => {
  it("removes agent scratch, dead sessions, stale stamps and old stash; keeps what grunt owns", () => {
    const root = repo();
    const has = rel(root);
    const { code, lines } = clean(root);
    expect(code).toBe(0);
    for (const gone of [
      ".tmp/grunt/old.log",
      ".tmp/grunt/review",
      `.tmp/grunt/sessions/${DEAD}`,
      `.tmp/grunt/orchestrator-logs/ask-stop-${DEAD}`,
      ".tmp/grunt/orchestrator-logs/ask-stop-default",
      ".tmp/grunt/stash/old.txt",
    ]) {
      expect(has(gone), gone).toBe(false);
    }
    for (const kept of [
      ".tmp/grunt/plans/1-a-20261103T000000Z.md",
      ".tmp/grunt/roadmaps/1-r-20261103T000000Z.md",
      ".tmp/grunt/handoffs/1-h-20261103T000000Z.md",
      ".tmp/grunt/implementations/1-i-20261103T000000Z.md",
      ".tmp/grunt/3-notes-20261103T120000Z.md",
      ".tmp/grunt/new.log",
      `.tmp/grunt/sessions/${LIVE}/wrote.txt`,
      `.tmp/grunt/orchestrator-logs/ask-stop-${LIVE}`,
      ".tmp/grunt/stash/new.txt",
      ".tmp/grunt/browser/session.json",
    ]) {
      expect(has(kept), kept).toBe(true);
    }
    expect(lines.some((l) => l.startsWith("removed "))).toBe(true);
    expect(lines.some((l) => l.startsWith("kept "))).toBe(true);
  });

  it("--dry-run lists what it would remove and deletes nothing", () => {
    const root = repo();
    const { code, lines } = clean(root, true);
    expect(code).toBe(0);
    expect(rel(root)(".tmp/grunt/old.log")).toBe(true);
    expect(lines).toContain(".tmp/grunt/old.log");
    expect(lines).toContain(".tmp/grunt/review");
    expect(lines).toContain(`.tmp/grunt/sessions/${DEAD}`);
    expect(lines).toContain(".tmp/grunt/stash/old.txt");
    expect(lines.some((l) => l.includes("plans/"))).toBe(false);
    expect(lines.some((l) => l.startsWith("would remove "))).toBe(true);
    expect(lines.some((l) => l.startsWith("would keep "))).toBe(true);
  });

  it("removes stray nested .tmp/grunt dirs and keeps one that holds plans", () => {
    const root = repo();
    put(root, "packages/a/.tmp/grunt/sessions/x/wrote.txt", 2 * HOUR);
    put(root, "packages/b/.tmp/grunt/plans/1-x.md", 2 * HOUR);
    const { lines } = clean(root);
    expect(rel(root)("packages/a/.tmp/grunt")).toBe(false);
    expect(rel(root)("packages/b/.tmp/grunt/plans/1-x.md")).toBe(true);
    expect(lines).toContain("kept nested packages/b/.tmp/grunt: holds plans");
  });

  it("converges: a second run removes nothing and exits 0", () => {
    const root = repo();
    clean(root);
    const again = clean(root);
    expect(again.code).toBe(0);
    expect(again.lines[0]).toMatch(/^removed 0 /);
  });

  it("removes a symlink as a link and leaves its target", () => {
    const root = repo();
    const outside = tempDir("grunt-clean-target-");
    fs.writeFileSync(path.join(outside, "keep.txt"), "x");
    const link = path.join(root, ".tmp/grunt/linked");
    fs.symlinkSync(outside, link, "dir");
    fs.lutimesSync(link, new Date(NOW - 2 * HOUR), new Date(NOW - 2 * HOUR));
    clean(root);
    expect(fs.existsSync(link)).toBe(false);
    expect(fs.existsSync(path.join(outside, "keep.txt"))).toBe(true);
  });

  it("from a linked worktree, cleans the main checkout's scratch", () => {
    const root = fs.realpathSync(tempDir("grunt-clean-wt-"));
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "ignore" });
    git(root, "init", "-q");
    fs.writeFileSync(path.join(root, ".gitignore"), ".tmp/\n.worktrees/\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "init");
    git(root, "worktree", "add", "-q", ".worktrees/w", "-b", "wt/w");
    put(root, ".tmp/grunt/old.log", 48 * HOUR);
    put(root, ".tmp/grunt/plans/1-a-20261103T000000Z.md", 48 * HOUR);
    const cli = path.join(import.meta.dirname, "clean.mjs");
    execFileSync(process.execPath, [cli], {
      cwd: path.join(root, ".worktrees/w"),
      env: { ...process.env, GRUNT_BOARD_HOME: tempDir("grunt-clean-wt-board-") },
      stdio: "ignore",
    });
    expect(rel(root)(".tmp/grunt/old.log")).toBe(false);
    expect(rel(root)(".tmp/grunt/plans/1-a-20261103T000000Z.md")).toBe(true);
  });

  it("outside git, cleans the given root and skips the nested scan", () => {
    const root = tempDir("grunt-clean-nogit-");
    put(root, ".tmp/grunt/old.log", 2 * HOUR);
    const { code } = clean(root);
    expect(code).toBe(0);
    expect(rel(root)(".tmp/grunt/old.log")).toBe(false);
  });

  it("every grunt-owned dir constant is in the reserved set", () => {
    const owned = [
      PLAN_DIR,
      ROADMAP_DIR,
      HANDOFF_DIR,
      IMPLEMENTATION_DIR,
      STASH_REL,
      SESSION_REL,
      ORCHESTRATOR_LOGS_DIR,
      LISTEN_DIR,
      SPEAK_DIR,
    ].map((d) => path.posix.basename(d));
    expect(new Set([...owned, "sessions"])).toEqual(TMP_RESERVED_DIRS);
  });

  it("reads live sessions without wiping the board", () => {
    if (process.platform !== "linux") return;
    const home = tempDir("grunt-clean-board-");
    const board = path.join(home, ".grunt", "board");
    fs.mkdirSync(board, { recursive: true });
    const stat = fs.readFileSync("/proc/self/stat", "utf8");
    const start = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/)[19];
    const row = path.join(board, `claude-${LIVE}.json`);
    fs.writeFileSync(
      row,
      JSON.stringify({
        time: "2026-11-03T12:00:00Z",
        provider: "claude",
        model: "-",
        effort: "-",
        session: LIVE,
        cwd: "/x",
        work: "live",
        pid: process.pid,
        start,
        boot: fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
      }) + "\n",
    );
    const live = liveSessions({ GRUNT_BOARD_HOME: home });
    expect(live).toEqual(new Set([LIVE]));
    const root = repo();
    runClean({ root, now: NOW, liveSessions: live, dryRun: false, out: () => {} });
    expect(fs.existsSync(row)).toBe(true);
    expect(rel(root)(`.tmp/grunt/sessions/${LIVE}/wrote.txt`)).toBe(true);
  });
});

describe("nestedHolds", () => {
  it("names the first durable dir holding a file", () => {
    const held = tempDir("grunt-holds-");
    put(held, "plans/1-p.md", 0);
    expect(nestedHolds(held)).toBe("plans");
    const loose = tempDir("grunt-holds-loose-");
    put(loose, "x.txt", 0);
    fs.mkdirSync(path.join(loose, "plans"));
    expect(nestedHolds(loose)).toBe(null);
  });
});

describe("age-out", () => {
  const DAY = 24 * HOUR;
  const OLD = 40 * DAY;
  const fm = (status: string) => `---\nserial: 1\nstatus: ${status}\n---\n\n# x\n`;
  function aged() {
    const root = tempDir("grunt-age-");
    execFileSync("git", ["init", "-q"], { cwd: root });
    fs.writeFileSync(path.join(root, ".gitignore"), ".tmp/\n");
    const t = ".tmp/grunt";
    const plan = (n: number) => `${t}/plans/${n}-p${n}-20260901T000000Z.md`;
    put(root, plan(1), OLD, fm("done"));
    put(root, plan(2), OLD, fm("ready"));
    put(root, plan(3), OLD, fm("done"));
    put(root, plan(4), DAY, fm("done"));
    put(root, plan(5), OLD, "# no frontmatter\n");
    put(root, plan(6), OLD, fm("done"));
    put(root, `${t}/plans/9-x.txt`, OLD);
    put(root, `${t}/roadmaps/1-r1-20260901T000000Z.md`, OLD, fm("done"));
    put(root, `${t}/roadmaps/2-r2-20260901T000000Z.md`, OLD, `${fm("in-progress")}\n## Order\n1 [x] Title: a\n      Location: ${path.join(root, plan(3))}\n`);
    put(root, `${t}/implementations/1-i1-20260901T000000Z.md`, OLD, fm("done"));
    put(root, `${t}/implementations/2-i2-20260901T000000Z.md`, OLD, fm("in-progress"));
    put(root, `${t}/implementations/3-i3-20260901T000000Z.md`, OLD, fm("done"));
    put(root, `${t}/handoffs/1-h1-20260901T000000Z.md`, OLD, fm("open"));
    put(root, `${t}/handoffs/2-h2-20260901T000000Z.md`, OLD, fm("done"));
    put(root, `${t}/1-a-20260901T000000Z.md`, OLD);
    put(root, `${t}/2-b-20260901T000000Z.md`, OLD);
    for (const d of ["plans", "roadmaps", "implementations", "handoffs"]) age(path.join(root, t, d), OLD);
    age(path.join(root, plan(4)), DAY);
    return root;
  }
  const GONE = [
    ".tmp/grunt/plans/1-p1-20260901T000000Z.md",
    ".tmp/grunt/roadmaps/1-r1-20260901T000000Z.md",
    ".tmp/grunt/implementations/1-i1-20260901T000000Z.md",
    ".tmp/grunt/handoffs/1-h1-20260901T000000Z.md",
    ".tmp/grunt/1-a-20260901T000000Z.md",
  ];

  it("removes finished grunt files untouched for 30 days and keeps live work and the newest serials", () => {
    const root = aged();
    const all = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const before = all(path.join(root, ".tmp/grunt")).map((p) => path.relative(root, p).split(path.sep).join("/")).sort();
    const { code, lines } = clean(root);
    expect(code).toBe(0);
    const after = all(path.join(root, ".tmp/grunt")).map((p) => path.relative(root, p).split(path.sep).join("/")).sort();
    expect(after).toEqual(before.filter((p) => !GONE.includes(p)));
    expect(lines.find((l) => l.startsWith("removed "))).toMatch(/^removed 1 old plan, 1 old roadmap, 1 old journal, 1 old handoff, 1 old tmp artifact \(/);
    expect(nextSerial(path.join(root, ".tmp/grunt/plans"))).toBe(7);
    expect(clean(root).lines[0]).toMatch(/^removed 0 entries/);
  });

  it("--dry-run lists exactly the aged-out files and deletes nothing", () => {
    const root = aged();
    const { code, lines } = clean(root, true);
    expect(code).toBe(0);
    const summary = lines.findIndex((l) => l.startsWith("would remove "));
    expect(lines.slice(0, summary).sort()).toEqual([...GONE].sort());
    expect(lines[summary]).toMatch(/^would remove 1 old plan, 1 old roadmap, 1 old journal, 1 old handoff, 1 old tmp artifact \(/);
    for (const p of GONE) expect(rel(root)(p), p).toBe(true);
  });
});
