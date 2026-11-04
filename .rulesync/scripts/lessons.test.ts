import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { aliasOf } from "../../dev/test-paths";
import {
  LESSONS_DIR,
  checkLessons,
  globToRegExp,
  hitLesson,
  matchLessons,
  persistLesson,
  removeLesson,
  validateLesson,
  writeIndex,
} from "./lessons.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "lessons.mjs");

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) for (const x of [d, `${d}-alias`]) fs.rmSync(x, { recursive: true, force: true });
});

function repo(files: string[] = ["src/a.ts", "src/deep/b.ts", "docs/x.md"]) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lessons-"));
  tmpDirs.push(ws);
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(ws, f)), { recursive: true });
    fs.writeFileSync(path.join(ws, f), "x\n");
  }
  return ws;
}

function lesson({
  name = "plan-forks",
  paths = ["src/**"],
  hits = 1,
  evidence = ["plan 16"],
  summary = "Rewriting a saved plan minted a new serial.",
}: { name?: string; paths?: string[]; hits?: number; evidence?: string[]; summary?: string } = {}) {
  return `---
name: ${name}
paths: ${JSON.stringify(paths)}
hits: ${hits}
last-hit: 2026-10-31
evidence: ${JSON.stringify(evidence)}
---

# Plan rewrites fork serials

${summary}

## Mistake
A full-body Write to a saved plan went through the create path.

## Fix
Update the saved file in place and keep its serial.
`;
}

// The host side of a lesson Write: validate and reindex through persistLesson, then write what it returns.
function save(ws: string, slug: string, text: string) {
  const file = path.join(ws, LESSONS_DIR, `${slug}.md`);
  const r = persistLesson({ workspaceRoot: ws, filePath: file, content: text, today: "2026-11-01" });
  if (r.ok) fs.writeFileSync(file, r.content!);
  return r;
}

function indexText(ws: string) {
  return fs.readFileSync(path.join(ws, LESSONS_DIR, "INDEX.md"), "utf8");
}

describe("validateLesson", () => {
  const files = ["src/a.ts"];

  it("accepts a valid lesson", () => {
    expect(validateLesson("plan-forks.md", lesson(), { files })).toEqual([]);
  });

  it("rejects each broken shape with a reason that names the fix", () => {
    const cases: [string, string, RegExp][] = [
      ["plan-forks.md", lesson() + "\n".repeat(60), /60 lines/],
      ["plan-forks.md", lesson().replace(/\n## Fix[\s\S]*$/, "\n"), /## Fix/],
      ["plan-forks.md", lesson() + "\n## Notes\nmore\n", /## Mistake.*## Fix/],
      ["plan-forks.md", lesson({ paths: [] }), /paths/],
      ["other-name.md", lesson(), /other-name/],
      ["plan-forks.md", lesson({ paths: ["lib/**"] }), /lib\/\*\* matches no file/],
    ];
    for (const [file, text, reason] of cases) {
      expect(validateLesson(file, text, { files }).join("; "), String(reason)).toMatch(reason);
    }
  });
});

describe("globToRegExp", () => {
  it("handles **, *, and ?", () => {
    expect(globToRegExp("src/**").test("src/deep/b.ts")).toBe(true);
    expect(globToRegExp("src/**/b.ts").test("src/b.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/deep/b.ts")).toBe(false);
    expect(globToRegExp("src/?.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/?.ts").test("src/ab.ts")).toBe(false);
    expect(globToRegExp("a.b").test("axb")).toBe(false);
  });
});

describe("persistLesson", () => {
  it("writes the lesson, fills defaults, and regenerates the index", () => {
    const ws = repo();
    const bare = lesson().replace(/^hits: 1\nlast-hit: 2026-10-31\n/m, "");
    const r = save(ws, "plan-forks", bare);
    expect(r.ok, r.error).toBe(true);
    const text = fs.readFileSync(path.join(ws, LESSONS_DIR, "plan-forks.md"), "utf8");
    expect(text).toMatch(/^hits: 1$/m);
    expect(text).toMatch(/^last-hit: 2026-11-01$/m);
    expect(indexText(ws)).toContain("| .rulesync/lessons/plan-forks.md | src/** | 1 | 2026-11-01 | Rewriting a saved plan minted a new serial. |");
  });

  it("denies an invalid lesson and writes nothing", () => {
    const ws = repo();
    const r = save(ws, "plan-forks", lesson({ paths: ["lib/**"] }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/matches no file/);
    expect(fs.existsSync(path.join(ws, LESSONS_DIR, "plan-forks.md"))).toBe(false);
  });

  it("denies a write to the generated index", () => {
    const ws = repo();
    const r = persistLesson({ workspaceRoot: ws, filePath: path.join(ws, LESSONS_DIR, "INDEX.md"), content: "x" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/generated/);
  });
});

describe("matchLessons", () => {
  it("returns only matching rows, sorted by hits, capped", () => {
    const ws = repo();
    save(ws, "low", lesson({ name: "low", paths: ["src/**"], summary: "Low." }));
    save(ws, "high", lesson({ name: "high", paths: ["src/*.ts"], hits: 3, summary: "High." }));
    save(ws, "docs-only", lesson({ name: "docs-only", paths: ["docs/**"], hits: 9, summary: "Docs." }));
    const rows = matchLessons({ workspaceRoot: ws, files: [path.join(ws, "src/a.ts")] });
    expect(rows.map((r) => r.file)).toEqual([".rulesync/lessons/high.md", ".rulesync/lessons/low.md"]);
    expect(rows[0]).toMatchObject({ hits: 3, summary: "High.", paths: ["src/*.ts"] });
    expect(matchLessons({ workspaceRoot: ws, files: ["src/a.ts"], cap: 1 }).map((r) => r.file)).toEqual([
      ".rulesync/lessons/high.md",
    ]);
    expect(matchLessons({ workspaceRoot: ws, files: ["/elsewhere/src/a.ts"] })).toEqual([]);
  });

  it("returns nothing when there is no index", () => {
    expect(matchLessons({ workspaceRoot: repo(), files: ["src/a.ts"] })).toEqual([]);
  });
});

describe("hitLesson and removeLesson", () => {
  it("counts each new evidence once, keeps the 5 most recent, and updates the index", () => {
    const ws = repo();
    save(ws, "plan-forks", lesson({ evidence: [] }));
    for (const ev of ["plan 1", "plan 2"]) {
      expect(hitLesson({ workspaceRoot: ws, slug: "plan-forks", evidence: ev, today: "2026-11-02" }).ok).toBe(true);
    }
    let text = fs.readFileSync(path.join(ws, LESSONS_DIR, "plan-forks.md"), "utf8");
    expect(text).toMatch(/^hits: 3$/m);
    expect(text).toMatch(/^last-hit: 2026-11-02$/m);
    hitLesson({ workspaceRoot: ws, slug: "plan-forks", evidence: "plan 2", today: "2026-11-03" });
    text = fs.readFileSync(path.join(ws, LESSONS_DIR, "plan-forks.md"), "utf8");
    expect(text).toMatch(/^hits: 3$/m);
    for (const ev of ["plan 3", "plan 4", "plan 5", "plan 6"]) {
      hitLesson({ workspaceRoot: ws, slug: "plan-forks", evidence: ev, today: "2026-11-03" });
    }
    text = fs.readFileSync(path.join(ws, LESSONS_DIR, "plan-forks.md"), "utf8");
    expect(text).toMatch(/^evidence: \["plan 2","plan 3","plan 4","plan 5","plan 6"\]$/m);
    expect(indexText(ws)).toContain("| 7 | 2026-11-03 |");
  });

  it("removes the file and its row", () => {
    const ws = repo();
    save(ws, "plan-forks", lesson());
    expect(removeLesson({ workspaceRoot: ws, slug: "plan-forks" }).ok).toBe(true);
    expect(fs.existsSync(path.join(ws, LESSONS_DIR, "plan-forks.md"))).toBe(false);
    expect(indexText(ws)).not.toContain("plan-forks");
    expect(removeLesson({ workspaceRoot: ws, slug: "plan-forks" }).ok).toBe(false);
  });
});

describe("writeIndex and checkLessons", () => {
  it("writes the same index on a rerun", () => {
    const ws = repo();
    save(ws, "plan-forks", lesson());
    const first = indexText(ws);
    writeIndex({ workspaceRoot: ws });
    expect(indexText(ws)).toBe(first);
  });

  it("reports index drift, an invalid file, and a stale glob", () => {
    const ws = repo();
    save(ws, "plan-forks", lesson());
    expect(checkLessons({ workspaceRoot: ws })).toEqual([]);
    fs.writeFileSync(path.join(ws, LESSONS_DIR, "INDEX.md"), "stale\n");
    expect(checkLessons({ workspaceRoot: ws }).join("; ")).toMatch(/INDEX\.md is out of date/);
    writeIndex({ workspaceRoot: ws });
    fs.writeFileSync(path.join(ws, LESSONS_DIR, "broken.md"), "no frontmatter\n");
    fs.rmSync(path.join(ws, "src"), { recursive: true });
    const errors = checkLessons({ workspaceRoot: ws }).join("; ");
    expect(errors).toMatch(/broken\.md/);
    expect(errors).toMatch(/src\/\*\* matches no file/);
  });

  it("is clean when there is no lessons dir", () => {
    expect(checkLessons({ workspaceRoot: repo() })).toEqual([]);
  });
});

describe("lessons CLI", () => {
  function run(ws: string, ...args: string[]) {
    return spawnSync(process.execPath, [cli, ...args], { cwd: ws, encoding: "utf8" });
  }

  it("matches, hits, and checks from the command line", () => {
    const ws = repo();
    save(ws, "plan-forks", lesson());
    const m = run(ws, "match", "src/a.ts");
    expect(m.status, m.stderr).toBe(0);
    expect(m.stdout).toContain(".rulesync/lessons/plan-forks.md");
    expect(run(ws, "hit", "plan-forks", "--evidence", "plan 17").status).toBe(0);
    expect(run(ws, "check").status).toBe(0);
  });

  it("matches against the checkout's lessons from a subdir and from a worktree", () => {
    const ws = fs.realpathSync(repo(["packages/a/src/x.ts"]));
    const git = (cwd: string, ...args: string[]) =>
      spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });
    git(ws, "init", "-q");
    save(ws, "pkg-a", lesson({ name: "pkg-a", paths: ["packages/a/**"] }));
    git(ws, "add", "-A");
    git(ws, "commit", "-qm", "init");
    const sub = run(path.join(ws, "packages/a"), "match", "src/x.ts");
    expect(sub.status, sub.stderr).toBe(0);
    expect(sub.stdout).toContain(".rulesync/lessons/pkg-a.md");
    const typed = run(ws, "match", path.join(aliasOf(ws), "packages/a/src/x.ts"));
    expect(typed.stdout).toContain(".rulesync/lessons/pkg-a.md");
    git(ws, "worktree", "add", "-q", ".worktrees/w", "-b", "wt/w");
    fs.rmSync(path.join(ws, LESSONS_DIR), { recursive: true });
    const wt = run(path.join(ws, ".worktrees/w/packages/a"), "match", "src/x.ts");
    expect(wt.status, wt.stderr).toBe(0);
    expect(wt.stdout).toContain(".rulesync/lessons/pkg-a.md");
  });

  it("exits non-zero on bad args", () => {
    const ws = repo();
    for (const args of [[], ["nope"], ["hit", "plan-forks"], ["match"], ["rm"]]) {
      const r = run(ws, ...args);
      expect(r.status, args.join(" ")).not.toBe(0);
      expect(r.stderr).toMatch(/usage/);
    }
  });
});
