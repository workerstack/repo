import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanBuilds, liveSessions, main, nestedHolds, runClean, size } from "./clean.ts";
import { SESSION_REL } from "./browser.ts";
import { STASH_REL } from "./job.ts";
import { LISTEN_DIR } from "./listen.ts";
import { HANDOFF_DIR } from "./persist-handoff.constants.ts";
import { IMPLEMENTATION_DIR } from "./persist-implementation.constants.ts";
import { nextSerial } from "./persist-doc.ts";
import { PLAN_DIR } from "./persist-plan.constants.ts";
import { ROADMAP_DIR } from "./persist-roadmap.constants.ts";
import { TMP_RESERVED_DIRS } from "./persist-tmp.ts";
import { SPEAK_DIR } from "./speak.ts";
import { ORCHESTRATOR_LOGS_DIR } from "./orchestrate-parent.ts";
import { BUN } from "../../dev/test-paths";
import { childEnv } from "../env.ts";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const HOUR = 3600_000;
const LIVE = "11111111-aaaa-4bbb-8ccc-000000000001";
const DEAD = "22222222-aaaa-4bbb-8ccc-000000000002";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
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
  const root = tempDir("repo-clean-");
  execFileSync("git", ["init", "-q"], { cwd: root });
  fs.writeFileSync(path.join(root, ".gitignore"), ".tmp/\n");
  const t = ".tmp/repo";
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

describe("repo clean", () => {
  it("removes agent scratch, dead sessions, stale stamps and old stash; keeps what repo owns", () => {
    const root = repo();
    const has = rel(root);
    const { code, lines } = clean(root);
    expect(code).toBe(0);
    for (const gone of [
      ".tmp/repo/old.log",
      ".tmp/repo/review",
      `.tmp/repo/sessions/${DEAD}`,
      `.tmp/repo/orchestrator-logs/ask-stop-${DEAD}`,
      ".tmp/repo/orchestrator-logs/ask-stop-default",
      ".tmp/repo/stash/old.txt",
    ]) {
      expect(has(gone), gone).toBe(false);
    }
    for (const kept of [
      ".tmp/repo/plans/1-a-20261103T000000Z.md",
      ".tmp/repo/roadmaps/1-r-20261103T000000Z.md",
      ".tmp/repo/handoffs/1-h-20261103T000000Z.md",
      ".tmp/repo/implementations/1-i-20261103T000000Z.md",
      ".tmp/repo/3-notes-20261103T120000Z.md",
      ".tmp/repo/new.log",
      `.tmp/repo/sessions/${LIVE}/wrote.txt`,
      `.tmp/repo/orchestrator-logs/ask-stop-${LIVE}`,
      ".tmp/repo/stash/new.txt",
      ".tmp/repo/browser/session.json",
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
    expect(rel(root)(".tmp/repo/old.log")).toBe(true);
    expect(lines).toContain(".tmp/repo/old.log");
    expect(lines).toContain(".tmp/repo/review");
    expect(lines).toContain(`.tmp/repo/sessions/${DEAD}`);
    expect(lines).toContain(".tmp/repo/stash/old.txt");
    expect(lines.some((l) => l.includes("plans/"))).toBe(false);
    expect(lines.some((l) => l.startsWith("would remove "))).toBe(true);
    expect(lines.some((l) => l.startsWith("would keep "))).toBe(true);
  });

  it("removes stray nested .tmp/repo dirs and keeps one that holds plans", () => {
    const root = repo();
    put(root, "packages/a/.tmp/repo/sessions/x/wrote.txt", 2 * HOUR);
    put(root, "packages/b/.tmp/repo/plans/1-x.md", 2 * HOUR);
    const { lines } = clean(root);
    expect(rel(root)("packages/a/.tmp/repo")).toBe(false);
    expect(rel(root)("packages/b/.tmp/repo/plans/1-x.md")).toBe(true);
    expect(lines).toContain("kept nested packages/b/.tmp/repo: holds plans");
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
    const outside = tempDir("repo-clean-target-");
    fs.writeFileSync(path.join(outside, "keep.txt"), "x");
    const link = path.join(root, ".tmp/repo/linked");
    fs.symlinkSync(outside, link, "dir");
    fs.lutimesSync(link, new Date(NOW - 2 * HOUR), new Date(NOW - 2 * HOUR));
    clean(root);
    expect(fs.existsSync(link)).toBe(false);
    expect(fs.existsSync(path.join(outside, "keep.txt"))).toBe(true);
  });

  it("from a linked worktree, cleans the main checkout's scratch", () => {
    const root = fs.realpathSync(tempDir("repo-clean-wt-"));
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "ignore" });
    git(root, "init", "-q");
    fs.writeFileSync(path.join(root, ".gitignore"), ".tmp/\n.worktrees/\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "init");
    git(root, "worktree", "add", "-q", ".worktrees/w", "-b", "wt/w");
    put(root, ".tmp/repo/old.log", 48 * HOUR);
    put(root, ".tmp/repo/plans/1-a-20261103T000000Z.md", 48 * HOUR);
    const cli = fileURLToPath(new URL("../../bin/repo.ts", import.meta.url));
    execFileSync(BUN, [cli, "clean"], {
      cwd: path.join(root, ".worktrees/w"),
      env: childEnv({ REPO_BOARD_HOME: tempDir("repo-clean-wt-board-") }),
      stdio: "ignore",
    });
    expect(rel(root)(".tmp/repo/old.log")).toBe(false);
    expect(rel(root)(".tmp/repo/plans/1-a-20261103T000000Z.md")).toBe(true);
  });

  it("outside git, cleans the given root and skips the nested scan", () => {
    const root = tempDir("repo-clean-nogit-");
    put(root, ".tmp/repo/old.log", 2 * HOUR);
    const { code } = clean(root);
    expect(code).toBe(0);
    expect(rel(root)(".tmp/repo/old.log")).toBe(false);
  });

  it("every repo-owned dir constant is in the reserved set", () => {
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
    const home = tempDir("repo-clean-board-");
    const board = path.join(home, ".workerstack", "board");
    fs.mkdirSync(board, { recursive: true });
    const stat = fs.readFileSync("/proc/self/stat", "utf8");
    const start = stat
      .slice(stat.lastIndexOf(")") + 1)
      .trim()
      .split(/\s+/)[19];
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
    const live = liveSessions({ REPO_BOARD_HOME: home });
    expect(live).toEqual(new Set([LIVE]));
    const root = repo();
    runClean({ root, now: NOW, liveSessions: live, dryRun: false, out: () => {} });
    expect(fs.existsSync(row)).toBe(true);
    expect(rel(root)(`.tmp/repo/sessions/${LIVE}/wrote.txt`)).toBe(true);
  });
});

describe("nestedHolds", () => {
  it("names the first durable dir holding a file", () => {
    const held = tempDir("repo-holds-");
    put(held, "plans/1-p.md", 0);
    expect(nestedHolds(held)).toBe("plans");
    const loose = tempDir("repo-holds-loose-");
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
    const root = tempDir("repo-age-");
    execFileSync("git", ["init", "-q"], { cwd: root });
    fs.writeFileSync(path.join(root, ".gitignore"), ".tmp/\n");
    const t = ".tmp/repo";
    const plan = (n: number) => `${t}/plans/${n}-p${n}-20260901T000000Z.md`;
    put(root, plan(1), OLD, fm("done"));
    put(root, plan(2), OLD, fm("ready"));
    put(root, plan(3), OLD, fm("done"));
    put(root, plan(4), DAY, fm("done"));
    put(root, plan(5), OLD, "# no frontmatter\n");
    put(root, plan(6), OLD, fm("done"));
    put(root, `${t}/plans/9-x.txt`, OLD);
    put(root, `${t}/roadmaps/1-r1-20260901T000000Z.md`, OLD, fm("done"));
    put(
      root,
      `${t}/roadmaps/2-r2-20260901T000000Z.md`,
      OLD,
      `${fm("in-progress")}\n## Order\n1 [x] Title: a\n      Location: ${path.join(root, plan(3))}\n`,
    );
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
    ".tmp/repo/plans/1-p1-20260901T000000Z.md",
    ".tmp/repo/roadmaps/1-r1-20260901T000000Z.md",
    ".tmp/repo/implementations/1-i1-20260901T000000Z.md",
    ".tmp/repo/handoffs/1-h1-20260901T000000Z.md",
    ".tmp/repo/1-a-20260901T000000Z.md",
  ];

  it("removes finished repo files untouched for 30 days and keeps live work and the newest serials", () => {
    const root = aged();
    const all = (dir: string): string[] =>
      fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((e) => (e.isDirectory() ? all(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const before = all(path.join(root, ".tmp/repo"))
      .map((p) => path.relative(root, p).split(path.sep).join("/"))
      .sort();
    const { code, lines } = clean(root);
    expect(code).toBe(0);
    const after = all(path.join(root, ".tmp/repo"))
      .map((p) => path.relative(root, p).split(path.sep).join("/"))
      .sort();
    expect(after).toEqual(before.filter((p) => !GONE.includes(p)));
    expect(lines.find((l) => l.startsWith("removed "))).toMatch(
      /^removed 1 old plan, 1 old roadmap, 1 old journal, 1 old handoff, 1 old tmp artifact \(/,
    );
    expect(nextSerial(path.join(root, ".tmp/repo/plans"))).toBe(7);
    expect(clean(root).lines[0]).toMatch(/^removed 0 entries/);
  });

  it("--dry-run lists exactly the aged-out files and deletes nothing", () => {
    const root = aged();
    const { code, lines } = clean(root, true);
    expect(code).toBe(0);
    const summary = lines.findIndex((l) => l.startsWith("would remove "));
    expect(lines.slice(0, summary).sort()).toEqual([...GONE].sort());
    expect(lines[summary]).toMatch(
      /^would remove 1 old plan, 1 old roadmap, 1 old journal, 1 old handoff, 1 old tmp artifact \(/,
    );
    for (const p of GONE) expect(rel(root)(p), p).toBe(true);
  });
});

const BUILD_FILES: Record<string, string> = {
  ".gitignore": ".next\n.turbo/\n.flare\nnode_modules\n*.tsbuildinfo\n.tmp/\n",
  "src/a.ts": "x",
  ".next/a": "abc",
  "apps/.turbo/b": "de",
  "x.tsbuildinfo": "f",
  "node_modules/m/i": "ghij",
  ".flare/s": "k",
  ".tmp/repo/old.log": "l",
};

/** A git repo with a real .gitignore, caches and node_modules under it, and a scratch dir. */
function buildRepo(): string {
  const root = fs.realpathSync(tempDir("repo-clean-build-"));
  execFileSync("git", ["init", "-q"], { cwd: root, env: childEnv({ GIT_DIR: undefined, GIT_INDEX_FILE: undefined }) });
  for (const [name, text] of Object.entries(BUILD_FILES)) put(root, name, 0, text);
  return root;
}

type BuildOptions = { deps?: boolean; dryRun?: boolean; names?: string[]; rm?: typeof fs.rmSync };

function build(root: string, { deps = false, dryRun = false, names = [], rm }: BuildOptions = {}) {
  const lines: string[] = [];
  const code = cleanBuilds({ root, deps, dryRun, names, out: (l) => lines.push(l), rm });
  return { code, lines };
}

describe("repo clean --build", () => {
  it("removes the ignored caches and tsbuildinfo, prints the counts and size, and leaves the sweep's dir alone", () => {
    const root = buildRepo();
    expect(build(root)).toEqual({ code: 0, lines: ["removed 2 build dirs and 1 tsbuildinfo file (6 B)"] });
    expect(rel(root)(".next")).toBe(false);
    for (const kept of ["node_modules/m/i", ".flare/s", ".tmp/repo/old.log", "src/a.ts"])
      expect(rel(root)(kept)).toBe(true);
  });

  it("takes the dir names the config adds", () => {
    const root = buildRepo();
    expect(build(root, { names: [".flare"] }).lines).toEqual(["removed 3 build dirs and 1 tsbuildinfo file (7 B)"]);
  });

  it("says why a path it cannot remove was skipped, and exits 1", () => {
    const busy = (() => {
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    }) /* the stand-in takes the path and options the report passes */ as typeof fs.rmSync;
    const second = build(buildRepo(), { rm: busy });
    expect(second.code).toBe(1);
    expect(second.lines).toContain("skipped .next: EBUSY");
    expect(second.lines.at(-1)).toBe("removed 0 build dirs");
  });

  it("refuses outside a git repo", () => {
    const { code, lines } = build(tempDir("repo-clean-plain-"));
    expect(code).toBe(1);
    expect(lines[0]).toMatch(/^repo clean: git ls-files failed: /);
  });
});

describe("repo clean --deps", () => {
  it("--dry-run lists the paths, counts node_modules too, removes nothing, and says to install", () => {
    const root = buildRepo();
    const { code, lines } = build(root, { deps: true, dryRun: true });
    expect(code).toBe(0);
    expect(lines.slice(0, -1).sort()).toEqual([".next", "apps/.turbo", "node_modules", "x.tsbuildinfo"]);
    expect(lines.at(-1)).toBe(
      "would remove 2 build dirs, 1 tsbuildinfo file and 1 node_modules (10 B); then run `bun install`",
    );
    expect(rel(root)("node_modules/m/i")).toBe(true);
  });

  it("removes node_modules, and a second run finds nothing", () => {
    const root = buildRepo();
    expect(build(root, { deps: true }).lines.at(-1)).toMatch(
      /^removed 2 build dirs, .* and 1 node_modules \(10 B\); then run/,
    );
    expect(rel(root)("node_modules")).toBe(false);
    expect(build(root, { deps: true }).lines).toEqual(["removed 0 build dirs"]);
    expect(build(root, { deps: true, dryRun: true }).lines).toEqual(["would remove 0 build dirs"]);
  });
});

describe("repo clean's flags", () => {
  const inRepo = (root: string) => vi.spyOn(process, "cwd").mockReturnValue(root);

  it("main refuses --build with --deps, exit 2, and removes nothing", async () => {
    const root = buildRepo();
    inRepo(root);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["--build", "--deps"])).toBe(2);
    expect(err).toHaveBeenCalledWith("repo clean: use one of --build or --deps (--deps includes --build)");
    expect(rel(root)(".next")).toBe(true);
  });
});

describe("repo clean's flags with a config", () => {
  const inRepo = (root: string) => vi.spyOn(process, "cwd").mockReturnValue(root);

  it("main --build runs only the cache removal, with the names in the config", async () => {
    const root = buildRepo();
    put(root, "workerstack.config.ts", 0, 'export default { clean: { build: [".flare"] } };\n');
    inRepo(root);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(["--build"])).toBe(0);
    expect(log.mock.calls.map((c) => c[0])).toEqual(["removed 3 build dirs and 1 tsbuildinfo file (7 B)"]);
    expect(rel(root)(".tmp/repo/old.log")).toBe(true);
  });

  it("main works with a config that has no clean section", async () => {
    const root = buildRepo();
    put(root, "workerstack.config.ts", 0, "export default {};\n");
    inRepo(root);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(["--build"])).toBe(0);
    expect(log.mock.calls[0]?.[0]).toBe("removed 2 build dirs and 1 tsbuildinfo file (6 B)");
  });
});

describe("repo clean's flags without a usable config", () => {
  const inRepo = (root: string) => vi.spyOn(process, "cwd").mockReturnValue(root);

  it("main --deps works without a config, and a broken config stops it, exit 1", async () => {
    const root = buildRepo();
    inRepo(root);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(["--deps", "--dry-run"])).toBe(0);
    expect(log.mock.calls.at(-1)?.[0]).toMatch(/^would remove 2 build dirs, .* 1 node_modules/);
    put(root, "workerstack.config.ts", 0, "export default { clean: { build: 1 } };\n");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["--build"])).toBe(1);
    expect(err.mock.calls[0]?.[0]).toMatch(/^workerstack.config.ts: clean/);
  });
});

it("size prints GB from 1024 MB", () => {
  const MB = 1024 * 1024;
  expect([size(1023 * MB), size(1024 * MB), size(1536 * MB), size(2.9 * 1024 * MB)]).toEqual([
    "1023.0 MB",
    "1.0 GB",
    "1.5 GB",
    "2.9 GB",
  ]);
});
