import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VALID_LESSON, VALID_PLAN } from "./fixtures/persist-bodies.ts";
import { persistLesson } from "./lessons.ts";
import {
  PLAN_DIR,
  persistPlan,
  preparePlanUpdate,
  fencedLineSet,
  sectionBodies,
  slugify,
  utcDateTime,
  validatePlan,
  workspacePaths,
} from "./persist-plan.ts";

const tmpDirs: string[] = [];

// The host side of a plan rewrite: validate through preparePlanUpdate, then write what it returns.
function update(ws: string, abs: string, content: string) {
  const r = preparePlanUpdate({ workspaceRoot: ws, filePath: abs, content });
  if (r.ok) fs.writeFileSync(abs, r.content!);
  return r;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "persist-plan-"));
  tmpDirs.push(dir);
  return dir;
}

describe("slugify", () => {
  it("lowercases, hyphenates, trims to 50", () => {
    expect(slugify("Add Auth!")).toBe("add-auth");
    expect(slugify("")).toBe("unnamed");
  });
});

describe("utcDateTime", () => {
  it("strips milliseconds and keeps Z", () => {
    expect(utcDateTime(new Date("2026-08-26T14:30:00.123Z"))).toBe("2026-08-26T14:30:00Z");
  });
});

describe("persistPlan", () => {
  it("writes a valid plan with unpadded serial, datetime created, and stamp", () => {
    const ws = tmpWs();
    const created = "2026-08-26T14:30:00Z";
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_PLAN,
      created,
    });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(1);
    expect(r.filename).toBe("1-add-tmp-ignore-20260826T143000Z.md");
    expect(r.path).toBe(`${PLAN_DIR}/${r.filename}`);
    expect(path.isAbsolute(r.path!)).toBe(false);
    expect(fs.existsSync(path.join(ws, r.path!))).toBe(true);
    const text = fs.readFileSync(path.join(ws, r.path!), "utf8");
    expect(text).toMatch(/^---\nserial: 1\n/);
    expect(text).toMatch(/^name: add-tmp-ignore$/m);
    expect(text).toMatch(/^created: 2026-08-26T14:30:00Z$/m);
    expect(text).not.toMatch(/serial: 0001/);
    expect(validatePlan(r.filename!, text)).toEqual([]);
  });

  it("never touches .gitignore", () => {
    const ws = tmpWs();
    persistPlan({ workspaceRoot: ws, content: VALID_PLAN });
    expect(fs.existsSync(path.join(ws, ".gitignore"))).toBe(false);
    const kept = tmpWs();
    fs.writeFileSync(path.join(kept, ".gitignore"), "node_modules\n");
    persistPlan({ workspaceRoot: kept, content: VALID_PLAN });
    persistPlan({ workspaceRoot: kept, content: VALID_PLAN });
    expect(fs.readFileSync(path.join(kept, ".gitignore"), "utf8")).toBe("node_modules\n");
  });

  it("stamps filename from created when created is omitted", () => {
    const ws = tmpWs();
    const r = persistPlan({ workspaceRoot: ws, content: VALID_PLAN });
    expect(r.ok).toBe(true);
    expect(r.filename).toMatch(/^1-add-tmp-ignore-\d{8}T\d{6}Z\.md$/);
    const text = fs.readFileSync(path.join(ws, r.path!), "utf8");
    const m = text.match(/^created: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/m);
    expect(m).toBeTruthy();
    expect(r.filename).toBe(`1-add-tmp-ignore-${m![1]!.replace(/[-:]/g, "")}.md`);
  });

  it("accepts legacy unstamped filename and date-only created", () => {
    const ws = tmpWs();
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_PLAN,
      created: "2026-08-26T14:30:00Z",
    });
    expect(r.ok).toBe(true);
    const legacy = String(r.content).replace(/^created: 2026-08-26T14:30:00Z$/m, "created: 2026-08-26");
    expect(validatePlan("1-add-tmp-ignore.md", legacy)).toEqual([]);
  });

  it("increments serial and keeps the same stamp", () => {
    const ws = tmpWs();
    const created = "2026-08-26T14:30:00Z";
    persistPlan({ workspaceRoot: ws, content: VALID_PLAN, created });
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_PLAN,
      created,
    });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(2);
    expect(r.filename).toBe("2-add-tmp-ignore-20260826T143000Z.md");
  });

  it("keeps a valid commit subject, allows a plan with no commit, and rejects a bad subject", () => {
    const ws = tmpWs();
    const good = persistPlan({
      workspaceRoot: ws,
      content: "commit: feat(plans): record the subject\n" + VALID_PLAN,
      created: "2026-08-26T14:30:00Z",
    });
    expect(good.ok).toBe(true);
    const text = fs.readFileSync(path.join(ws, good.path!), "utf8");
    expect(text).toMatch(/^commit: feat\(plans\): record the subject$/m);
    expect(validatePlan(good.filename!, text)).toEqual([]);
    const noCommit = text.replace(/^commit:.*\n/m, "");
    expect(validatePlan(good.filename!, noCommit)).toEqual([]);
    for (const subject of [
      "chore: ignore .tmp",
      "fix(hook): don't reset status",
      "docs: document docs/roadmaps",
      "docs: note plans, roadmaps: split",
    ]) {
      const ok = persistPlan({
        workspaceRoot: ws,
        content: `commit: ${subject}\n` + VALID_PLAN,
        created: "2026-08-26T14:30:00Z",
      });
      expect(ok.ok, subject).toBe(true);
    }
    const bad = persistPlan({
      workspaceRoot: ws,
      content: "commit: Feat: Nope.\n" + VALID_PLAN,
      created: "2026-08-26T14:30:00Z",
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors).toContain("commit");
    const period = persistPlan({
      workspaceRoot: ws,
      content: "commit: feat: nope.\n" + VALID_PLAN,
      created: "2026-08-26T14:30:00Z",
    });
    expect(period.ok).toBe(false);
    expect(period.errors).toContain("commit");
  });

  it("rejects an invalid plan and does not write", () => {
    const ws = tmpWs();
    const r = persistPlan({
      workspaceRoot: ws,
      content: "PLAN_NAME: nope\n\n# nope\n\nnot a plan\n",
    });
    expect(r.ok).toBe(false);
    expect(fs.existsSync(path.join(ws, PLAN_DIR))).toBe(true);
    expect(fs.readdirSync(path.join(ws, PLAN_DIR))).toEqual([]);
  });

  it("writes under PLAN_DIR", () => {
    const ws = tmpWs();
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_PLAN,
      created: "2026-08-26T14:30:00Z",
    });
    expect(r.ok).toBe(true);
    expect(r.path).toBe(`${PLAN_DIR}/${r.filename}`);
    expect(fs.existsSync(path.join(ws, r.path!))).toBe(true);
  });
});

describe("plan updates", () => {
  const created = "2026-08-26T14:30:00Z";
  const entry = "- feedback: ignore entry lacked the slash → writes `.tmp/`";

  function saved(ws: string) {
    const r = persistPlan({ workspaceRoot: ws, content: VALID_PLAN, created });
    expect(r.ok, r.error).toBe(true);
    return { ...r, abs: path.join(ws, r.path!) };
  }

  function read(p: string) {
    return fs.readFileSync(p, "utf8");
  }

  function withEntries(text: string, ...entries: string[]) {
    return text.replace(/## Previous mistakes\n[\s\S]*$/, `## Previous mistakes\n${entries.join("\n")}\n`);
  }

  it("rewrites an existing plan in place, keeping serial, created, and the given status", () => {
    const ws = tmpWs();
    const s = saved(ws);
    const body = read(s.abs)
      .replace("status: ready", "status: in-progress")
      .replace("reviews: 0", "reviews: 1")
      .replace("1.1 [ ]", "1.1 [x]");
    const r = update(ws, s.abs, body);
    expect(r.ok, r.error).toBe(true);
    expect(r.path).toBe(s.path);
    expect(r.serial).toBe(1);
    expect(fs.readdirSync(path.join(ws, PLAN_DIR))).toEqual([s.filename]);
    const text = read(s.abs);
    expect(text).toMatch(/^status: in-progress$/m);
    expect(text).toMatch(/^created: 2026-08-26T14:30:00Z$/m);
    expect(text).toMatch(/^1\.1 \[x\] /m);
  });

  it("keeps the saved frontmatter when a revision sends only the body", () => {
    const ws = tmpWs();
    const s = saved(ws);
    const revised = VALID_PLAN.replace("Existing ignore entries stay.", "Other entries stay.");
    const r = update(ws, s.abs, revised);
    expect(r.ok, r.error).toBe(true);
    expect(fs.readdirSync(path.join(ws, PLAN_DIR))).toEqual([s.filename]);
    const text = read(s.abs);
    expect(text).toMatch(/^serial: 1$/m);
    expect(text).toMatch(/^created: 2026-08-26T14:30:00Z$/m);
    expect(text).toContain("Other entries stay.");
  });

  it("denies a fresh plan without Previous mistakes and says how to fix it", () => {
    const ws = tmpWs();
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_PLAN.replace(/\n## Previous mistakes\n\(none\)\n$/, "\n"),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/## Previous mistakes/);
    expect(r.error).toMatch(/\(none\)/);
  });

  it("denies a body-only rewrite of a saved file that has no frontmatter instead of throwing", () => {
    const ws = tmpWs();
    const s = saved(ws);
    fs.writeFileSync(s.abs, "# add-tmp-ignore\n\nhand-written\n");
    const r = update(ws, s.abs, VALID_PLAN);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/frontmatter/);
  });

  it("updates a legacy plan that has no Previous mistakes", () => {
    const ws = tmpWs();
    const s = saved(ws);
    const legacy = read(s.abs).replace(/\n## Previous mistakes\n\(none\)\n$/, "\n");
    fs.writeFileSync(s.abs, legacy);
    const r = update(ws, s.abs, legacy.replace("1.1 [ ]", "1.1 [x]"));
    expect(r.ok, r.error).toBe(true);
  });

  it("denies Previous mistakes anywhere but last", () => {
    const ws = tmpWs();
    const s = saved(ws);
    const moved = read(s.abs)
      .replace(/\n## Previous mistakes\n\(none\)\n$/, "\n")
      .replace("## Verify", "## Previous mistakes\n(none)\n\n## Verify");
    expect(validatePlan(s.filename!, moved).join("; ")).toMatch(/Previous mistakes.*last/);
  });

  it("accepts an update that appends an entry", () => {
    const ws = tmpWs();
    const s = saved(ws);
    const one = update(ws, s.abs, withEntries(read(s.abs), entry));
    expect(one.ok, one.error).toBe(true);
    const next = "- verify: check-ignore ran from the wrong dir → runs from the repo root (lesson: run-from-root)";
    const two = update(ws, s.abs, withEntries(read(s.abs), entry, next));
    expect(two.ok, two.error).toBe(true);
    expect(read(s.abs)).toContain(next);
  });

  it("denies an update that changes or drops an existing entry and names it", () => {
    const ws = tmpWs();
    const s = saved(ws);
    update(ws, s.abs, withEntries(read(s.abs), entry));
    const before = read(s.abs);
    for (const content of [
      withEntries(before, "(none)"),
      withEntries(before, entry.replace("slash", "dot")),
      before.replace(/\n## Previous mistakes\n[\s\S]*$/, "\n"),
    ]) {
      const r = update(ws, s.abs, content);
      expect(r.ok).toBe(false);
      expect(r.error).toContain("ignore entry lacked the slash");
    }
    expect(read(s.abs)).toBe(before);
  });

  it("denies an entry with an unknown source or no arrow", () => {
    const ws = tmpWs();
    const s = saved(ws);
    for (const bad of ["- oops: wrong thing → fixed", "- feedback: wrong thing, fixed"]) {
      const r = update(ws, s.abs, withEntries(read(s.abs), bad));
      expect(r.ok, bad).toBe(false);
      expect(r.error).toContain(bad);
    }
  });
});

describe("plan entry kinds", () => {
  it("rejects a roadmap-only slice entry on a plan", () => {
    const ws = tmpWs();
    const body = VALID_PLAN.replace("## Previous mistakes\n(none)", "## Previous mistakes\n- slice: a → b");
    const r = persistPlan({ workspaceRoot: ws, content: body });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/feedback\|verify\|review\|premise\|decision\}/);
  });
});

describe("review rounds", () => {
  function fresh(ws: string) {
    const r = persistPlan({ workspaceRoot: ws, content: VALID_PLAN, created: "2026-08-26T14:30:00Z" });
    expect(r.ok, r.error).toBe(true);
    return path.join(ws, r.path!);
  }
  const read = (p: string) => fs.readFileSync(p, "utf8");
  const start = (t: string) => t.replace("status: ready", "status: in-progress");
  const reviews = (t: string, n: string) => t.replace(/^reviews: .*$/m, `reviews: ${n}`);
  const legacy = (t: string) => t.replace(/^reviews: .*\n/m, "");

  it("saves a new plan with reviews: 0", () => {
    expect(read(fresh(tmpWs()))).toMatch(/^reviews: 0$/m);
  });

  it("refuses to start an unreviewed plan and says how to fix it", () => {
    const ws = tmpWs();
    const abs = fresh(ws);
    const r = update(ws, abs, start(read(abs)));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/\/review-plan/);
    expect(r.error).toMatch(/reviews/);
  });

  it("starts a plan after one review round", () => {
    const ws = tmpWs();
    const abs = fresh(ws);
    const r = update(ws, abs, start(reviews(read(abs), "1")));
    expect(r.ok, r.error).toBe(true);
  });

  it("denies lowering or dropping the count", () => {
    const ws = tmpWs();
    const abs = fresh(ws);
    expect(update(ws, abs, reviews(read(abs), "2")).ok).toBe(true);
    for (const content of [reviews(read(abs), "1"), legacy(read(abs))]) {
      const r = update(ws, abs, content);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/reviews/);
    }
  });

  it("denies a count that is not a plain whole number", () => {
    const ws = tmpWs();
    const abs = fresh(ws);
    for (const n of ["-1", "x", "01"]) {
      const r = update(ws, abs, reviews(read(abs), n));
      expect(r.ok, n).toBe(false);
      expect(r.error, n).toMatch(/reviews/);
    }
  });

  it("keeps a legacy plan already in progress editable without reviews", () => {
    const ws = tmpWs();
    const abs = fresh(ws);
    fs.writeFileSync(abs, start(legacy(read(abs))));
    const r = update(ws, abs, read(abs).replace("1.1 [ ]", "1.1 [x]"));
    expect(r.ok, r.error).toBe(true);
  });

  it("gates a legacy ready plan without reviews", () => {
    const ws = tmpWs();
    const abs = fresh(ws);
    fs.writeFileSync(abs, legacy(read(abs)));
    const r = update(ws, abs, start(read(abs)));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/\/review-plan/);
  });
});

describe("workspacePaths", () => {
  it("finds absolute workspace paths with either separator on Windows and drops outside ones", () => {
    const ws = "C:\\Users\\me\\repo";
    const text = [
      "1.1 [ ] edit `C:\\Users\\me\\repo\\src\\a.ts`.",
      "1.2 [ ] edit C:/Users/me/repo/src/b.ts and c:\\users\\me\\repo\\src\\c.ts",
      "1.3 [ ] leave C:\\Users\\me\\other\\x.ts and C:\\Users\\me\\repository\\y.ts",
    ].join("\n");
    expect(workspacePaths(ws, text, path.win32)).toEqual([
      "C:\\Users\\me\\repo\\src\\a.ts",
      "C:/Users/me/repo/src/b.ts",
      "c:\\users\\me\\repo\\src\\c.ts",
    ]);
  });

  it("finds posix workspace paths and drops a sibling with the same prefix", () => {
    const text = "edit /home/me/repo/src/a.ts: and /home/me/repo2/x.ts";
    expect(workspacePaths("/home/me/repo", text, path.posix)).toEqual(["/home/me/repo/src/a.ts"]);
  });

  it("resolves repo-relative paths against the root and keeps worktree paths", () => {
    const text = [
      "1.1 [ ] edit `src/a.ts` and ./docs/x.md, then cli/scripts/w.mjs.",
      "1.2 [ ] also /home/me/repo/.worktrees/w/src/b.ts, https://example.com/a.ts and wt/<name>, and/or main/master",
      "1.3 [ ] not ../outside/y.ts",
    ].join("\n");
    expect(workspacePaths("/home/me/repo", text, path.posix)).toEqual([
      "/home/me/repo/.worktrees/w/src/b.ts",
      "/home/me/repo/src/a.ts",
      "/home/me/repo/docs/x.md",
      "/home/me/repo/cli/scripts/w.mjs",
    ]);
  });

  it("resolves repo-relative paths with Windows separators", () => {
    const ws = "C:\\Users\\me\\repo";
    const text = "edit src\\a.ts and C:\\Users\\me\\other\\x.ts";
    expect(workspacePaths(ws, text, path.win32)).toEqual(["C:\\Users\\me\\repo\\src\\a.ts"]);
  });
});

describe("lesson citations", () => {
  function wsWithLesson() {
    const ws = tmpWs();
    fs.mkdirSync(path.join(ws, "src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "src/a.ts"), "x\n");
    const file = path.join(ws, ".repo/lessons/plan-forks.md");
    const r = persistLesson({ workspaceRoot: ws, filePath: file, content: VALID_LESSON });
    expect(r.ok, r.error).toBe(true);
    fs.writeFileSync(file, r.content!);
    return ws;
  }

  function touching(ws: string, cite = false) {
    const leaf = VALID_PLAN.replace(
      "1.1 [ ] read the gitignore if it exists",
      `1.1 [ ] edit ${path.join(ws, "src/a.ts")}`,
    );
    return cite
      ? leaf.replace("## Watch-outs\n", "## Watch-outs\n- .repo/lessons/plan-forks.md: keep the saved serial\n")
      : leaf;
  }

  it("denies a new plan that touches a file a lesson matches and names the lesson", () => {
    const ws = wsWithLesson();
    const r = persistPlan({ workspaceRoot: ws, content: touching(ws) });
    expect(r.ok).toBe(false);
    expect(r.error).toContain(".repo/lessons/plan-forks.md");
    expect(r.error).toMatch(/Watch-outs/);
  });

  it("accepts the plan once Watch-outs cites the lesson", () => {
    const ws = wsWithLesson();
    const r = persistPlan({ workspaceRoot: ws, content: touching(ws, true) });
    expect(r.ok, r.error).toBe(true);
  });

  it("never checks citations on an update", () => {
    const ws = wsWithLesson();
    const plain = persistPlan({ workspaceRoot: ws, content: VALID_PLAN });
    expect(plain.ok, plain.error).toBe(true);
    const abs = path.join(ws, plain.path!);
    const r = update(ws, abs, touching(ws));
    expect(r.ok, r.error).toBe(true);
  });
});

// A committed repo: lessons are written before the first commit (a later save belongs in a worktree).
describe("lesson citations across worktrees", () => {
  const git = (cwd: string, ...args: string[]) =>
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });
  function committedWithLesson() {
    const ws = fs.realpathSync(tmpWs());
    git(ws, "init", "-q");
    fs.mkdirSync(path.join(ws, "src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "src/a.ts"), "x\n");
    const file = path.join(ws, ".repo/lessons/plan-forks.md");
    const r = persistLesson({ workspaceRoot: ws, filePath: file, content: VALID_LESSON });
    expect(r.ok, r.error).toBe(true);
    fs.writeFileSync(file, r.content!);
    git(ws, "add", "-A");
    git(ws, "commit", "-qm", "init");
    git(ws, "worktree", "add", "-q", ".worktrees/w", "-b", "wt/w");
    return { ws, w: path.join(ws, ".worktrees/w") };
  }
  const naming = (file: string, cite = false) => {
    const leaf = VALID_PLAN.replace("1.1 [ ] read the gitignore if it exists", `1.1 [ ] edit ${file}`);
    return cite
      ? leaf.replace("## Watch-outs\n", "## Watch-outs\n- .repo/lessons/plan-forks.md: keep the saved serial\n")
      : leaf;
  };

  it("denies a plan naming a worktree file until it cites the lesson that worktree holds", () => {
    const { ws, w } = committedWithLesson();
    const file = path.join(w, "src/a.ts");
    const denied = persistPlan({ workspaceRoot: ws, content: naming(file) });
    expect(denied.ok).toBe(false);
    expect(denied.error).toContain(".repo/lessons/plan-forks.md");
    expect(persistPlan({ workspaceRoot: ws, content: naming(file, true) }).ok).toBe(true);
  });

  it("denies a plan naming a repo-relative file a lesson matches until it cites the lesson", () => {
    const { ws } = committedWithLesson();
    const denied = persistPlan({ workspaceRoot: ws, content: naming("src/a.ts") });
    expect(denied.ok).toBe(false);
    expect(denied.error).toContain(".repo/lessons/plan-forks.md");
    expect(persistPlan({ workspaceRoot: ws, content: naming("src/a.ts", true) }).ok).toBe(true);
  });

  it("matches the worktree's own lessons, not the root's", () => {
    const { ws, w } = committedWithLesson();
    fs.rmSync(path.join(w, ".repo/lessons/plan-forks.md"));
    fs.writeFileSync(
      path.join(w, ".repo/lessons/INDEX.md"),
      "<!-- Generated by lessons.ts. Do not hand-edit. -->\n\n# Lessons\n\n| lesson | paths | hits | last-hit | summary |\n| --- | --- | --- | --- | --- |\n",
    );
    expect(persistPlan({ workspaceRoot: ws, content: naming(path.join(w, "src/a.ts")) }).ok).toBe(true);
  });
});

describe("usage section", () => {
  const F = "```";
  const noUsage = VALID_PLAN.replace(/## Usage\n[\s\S]*?(?=## Context)/, "");
  const withUsage = (usage: string) => noUsage.replace("## Context", `## Usage\n${usage}\n\n## Context`);
  const save = (content: string) => persistPlan({ workspaceRoot: tmpWs(), content });

  it("denies a fresh plan without Usage and says what to show", () => {
    const r = save(noUsage);
    expect(r.ok).toBe(false);
    expect(r.error).toContain(
      'missing ## Usage after ## Goal: show what a person types and sees, before and after, in fenced blocks, or one "No visible change:" line',
    );
  });

  it("denies a Usage that holds only prose", () => {
    const r = save(withUsage("Run the thing and it works."));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('## Usage needs a fenced example or a "No visible change:" line');
  });

  it("saves a No visible change line", () => {
    expect(save(withUsage("No visible change: internal refactor")).ok).toBe(true);
  });

  it("ignores headings and boxes inside a Usage fence", () => {
    const r = save(withUsage(`${F}markdown\n## Example\n1 [x] done\n${F}`));
    expect(r.ok, r.error).toBe(true);
  });

  it("keeps an inner fence inside a longer outer fence", () => {
    const r = save(withUsage(`${F}\`markdown\n${F}console\n$ x\n${F}\n## Goal\n${F}\``));
    expect(r.ok, r.error).toBe(true);
  });

  it("names an unclosed fence instead of unrelated heading errors", () => {
    const text = withUsage(`${F}console\n$ x`);
    const r = save(text);
    expect(r.ok).toBe(false);
    const line = text.split("\n").findIndex((l) => l === `${F}console`) + 1;
    expect(r.error).toContain(`unclosed code fence at line ${line}: close it with the same fence`);
    expect(r.error).not.toContain("heading order");
  });

  it("finds sections and fences per CommonMark", () => {
    const text = `## A\n${F}\n## Inside\n${F}\n## B\n`;
    expect(sectionBodies(text).order).toEqual(["A", "B"]);
    const lines = [`${F}${F.slice(0, 1)}md`, F, "## x", F, `${F}${F.slice(0, 1)}`, "after"];
    const { fenced, unclosed } = fencedLineSet(lines);
    expect([...fenced].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(unclosed).toBeNull();
  });

  it("lets an update to a saved plan without Usage pass, and denies Usage below Context", () => {
    const ws = tmpWs();
    const r = persistPlan({ workspaceRoot: ws, content: withUsage("No visible change: x") });
    expect(r.ok, r.error).toBe(true);
    const abs = path.join(ws, r.path!);
    const legacy = fs.readFileSync(abs, "utf8").replace(/## Usage\n[\s\S]*?(?=## Context)/, "");
    fs.writeFileSync(abs, legacy);
    const flipped = legacy.replace("1.1 [ ]", "1.1 [x]");
    expect(preparePlanUpdate({ workspaceRoot: ws, filePath: abs, content: flipped }).ok).toBe(true);
    const moved = legacy.replace("## Constraints", "## Usage\nNo visible change: x\n\n## Constraints");
    const bad = preparePlanUpdate({ workspaceRoot: ws, filePath: abs, content: moved });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("## Usage must come right after ## Goal");
  });
});

describe("plan strategy", () => {
  const created = "2026-08-26T14:30:00Z";
  const NO_KEY = "strategy: default|review-fast|review-deep";
  const without = (body: string) => body.replace(/^strategy:.*\n/m, "");
  const withStrategy = (body: string, value: string) => body.replace(/^strategy:.*$/m, `strategy: ${value}`);
  const read = (p: string) => fs.readFileSync(p, "utf8");

  it("moves a body strategy line into the frontmatter after commit and out of the body", () => {
    const ws = tmpWs();
    const r = persistPlan({
      workspaceRoot: ws,
      content: `commit: feat: add the thing\n${withStrategy(VALID_PLAN, "review-deep")}`,
      created,
    });
    expect(r.ok, r.error).toBe(true);
    const text = read(path.join(ws, r.path!));
    const [head, ...body] = text.split("\n---\n");
    expect(head).toMatch(/commit: feat: add the thing\nstrategy: review-deep$/);
    expect(body.join("\n---\n")).not.toMatch(/^strategy:/m);
    expect(validatePlan(r.filename!, text)).toEqual([]);
  });

  it("leaves a strategy line inside a code fence alone", () => {
    const ws = tmpWs();
    const fenced = VALID_PLAN.replace("## Context", "```console\nstrategy: review-fast\n```\n\n## Context");
    const r = persistPlan({ workspaceRoot: ws, content: fenced, created });
    expect(r.ok, r.error).toBe(true);
    const text = read(path.join(ws, r.path!));
    expect(text).toMatch(/^strategy: default$/m);
    expect(text).toMatch(/^```console\nstrategy: review-fast\n```$/m);
  });

  it("denies a save without it and says the three values", () => {
    const ws = tmpWs();
    const r = persistPlan({ workspaceRoot: ws, content: without(VALID_PLAN), created });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain(NO_KEY);
    expect(fs.existsSync(path.join(ws, PLAN_DIR))).toBe(true);
    expect(fs.readdirSync(path.join(ws, PLAN_DIR))).toEqual([]);
  });

  it("denies an unknown or empty value", () => {
    const ws = tmpWs();
    for (const v of ["review-medium", "Default", ""]) {
      const r = persistPlan({ workspaceRoot: ws, content: withStrategy(VALID_PLAN, v), created });
      expect(r.ok, v).toBe(false);
      expect(r.errors, v).toContain(NO_KEY);
    }
  });

  it("denies an update whose frontmatter drops the key", () => {
    const ws = tmpWs();
    const r = persistPlan({ workspaceRoot: ws, content: withStrategy(VALID_PLAN, "review-fast"), created });
    const abs = path.join(ws, r.path!);
    const u = update(ws, abs, without(read(abs).replace(/^strategy:.*\n/m, "")));
    expect(u.ok).toBe(false);
    expect(u.errors).toContain(NO_KEY);
  });

  it("keeps the key on a body-only update and takes a new one from a body line", () => {
    const ws = tmpWs();
    const r = persistPlan({ workspaceRoot: ws, content: withStrategy(VALID_PLAN, "review-fast"), created });
    const abs = path.join(ws, r.path!);
    const kept = update(ws, abs, without(VALID_PLAN).replace("Existing ignore entries stay.", "Other entries stay."));
    expect(kept.ok, kept.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: review-fast$/m);
    const changed = update(ws, abs, withStrategy(VALID_PLAN, "review-deep"));
    expect(changed.ok, changed.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: review-deep$/m);
    expect(read(abs).match(/^strategy:/gm)).toHaveLength(1);
    const bad = update(ws, abs, withStrategy(VALID_PLAN, "review-medium"));
    expect(bad.ok).toBe(false);
    expect(bad.errors).toContain(NO_KEY);
  });

  it("adds the key to a saved head that lacks it only from a body line", () => {
    const ws = tmpWs();
    const r = persistPlan({ workspaceRoot: ws, content: withStrategy(VALID_PLAN, "default"), created });
    const abs = path.join(ws, r.path!);
    fs.writeFileSync(abs, read(abs).replace(/^strategy:.*\n/m, ""));
    expect(update(ws, abs, without(VALID_PLAN)).errors).toContain(NO_KEY);
    const ok = update(ws, abs, withStrategy(VALID_PLAN, "review-fast"));
    expect(ok.ok, ok.error).toBe(true);
    expect(read(abs)).toMatch(/^source: .*\nstrategy: review-fast\n---$/m);
  });
});

describe("plan mode", () => {
  const created = "2026-08-26T14:30:00Z";
  const MODE_KEY = "mode: ask|auto|away";
  const withMode = (body: string, value: string) => body.replace(/^strategy:.*$/m, (l) => `${l}\nmode: ${value}`);
  const read = (p: string) => fs.readFileSync(p, "utf8");

  it("moves a body mode line into the frontmatter right after strategy and out of the body", () => {
    const ws = tmpWs();
    const r = persistPlan({ workspaceRoot: ws, content: withMode(VALID_PLAN, "away"), created });
    expect(r.ok, r.error).toBe(true);
    const text = read(path.join(ws, r.path!));
    const [head, ...body] = text.split("\n---\n");
    expect(head).toMatch(/\nstrategy: default\nmode: away$/);
    expect(body.join("\n---\n")).not.toMatch(/^mode:/m);
    expect(validatePlan(r.filename!, text)).toEqual([]);
  });

  it("leaves a mode line inside a code fence alone", () => {
    const ws = tmpWs();
    const fenced = VALID_PLAN.replace("## Context", "```console\nmode: later\n```\n\n## Context");
    const r = persistPlan({ workspaceRoot: ws, content: fenced, created });
    expect(r.ok, r.error).toBe(true);
    const text = read(path.join(ws, r.path!));
    expect(text.split("\n---\n")[0]).not.toMatch(/^mode:/m);
    expect(text).toMatch(/^```console\nmode: later\n```$/m);
  });

  it("denies an unknown mode on a body line or in the frontmatter and says the three values", () => {
    const ws = tmpWs();
    const r = persistPlan({ workspaceRoot: ws, content: withMode(VALID_PLAN, "later"), created });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain(MODE_KEY);
    const ok = persistPlan({ workspaceRoot: ws, content: VALID_PLAN, created });
    expect(ok.ok, ok.error).toBe(true);
    const abs = path.join(ws, ok.path!);
    const full = update(ws, abs, withMode(read(abs), "later"));
    expect(full.ok).toBe(false);
    expect(full.errors).toContain(MODE_KEY);
    const body = update(ws, abs, withMode(VALID_PLAN, "later"));
    expect(body.ok).toBe(false);
    expect(body.errors).toContain(MODE_KEY);
  });

  it("stays valid with no mode and keeps a saved mode on a body-only update", () => {
    const ws = tmpWs();
    const none = persistPlan({ workspaceRoot: ws, content: VALID_PLAN, created });
    expect(none.ok, none.error).toBe(true);
    expect(read(path.join(ws, none.path!))).not.toMatch(/^mode:/m);
    const r = persistPlan({ workspaceRoot: ws, content: withMode(VALID_PLAN, "auto"), created });
    expect(r.ok, r.error).toBe(true);
    const abs = path.join(ws, r.path!);
    const kept = update(ws, abs, VALID_PLAN.replace("Existing ignore entries stay.", "Other entries stay."));
    expect(kept.ok, kept.error).toBe(true);
    expect(read(abs)).toMatch(/^strategy: default\nmode: auto$/m);
    const changed = update(ws, abs, withMode(VALID_PLAN, "away"));
    expect(changed.ok, changed.error).toBe(true);
    expect(read(abs).match(/^mode:/gm)).toEqual(["mode:"]);
    expect(read(abs)).toMatch(/^mode: away$/m);
  });
});

describe("plan decision entries", () => {
  const created = "2026-08-26T14:30:00Z";
  const entry = "- decision: a → b because c";
  const withEntries = (text: string, ...entries: string[]) =>
    text.replace(/## Previous mistakes\n[\s\S]*$/, `## Previous mistakes\n${entries.join("\n")}\n`);
  const read = (p: string) => fs.readFileSync(p, "utf8");

  it("saves a decision entry and denies an update that edits or drops it", () => {
    const ws = tmpWs();
    const r = persistPlan({ workspaceRoot: ws, content: withEntries(VALID_PLAN, entry), created });
    expect(r.ok, r.error).toBe(true);
    const abs = path.join(ws, r.path!);
    const before = read(abs);
    for (const content of [
      withEntries(before, "(none)"),
      withEntries(before, entry.replace("because c", "because d")),
    ]) {
      const u = update(ws, abs, content);
      expect(u.ok).toBe(false);
      expect(u.error).toContain(`keep this entry unchanged: ${entry}`);
    }
    expect(read(abs)).toBe(before);
  });
});

describe("lean plan format", () => {
  const created = "2026-08-26T14:30:00Z";
  const CARD = [
    "WHAT   .gitignore ignores .tmp/",
    "WHY    plans stay untracked",
    "RISK   other ignore lines must survive",
    "TOUCH  .gitignore",
    "DONE   git check-ignore reports .tmp/repo/plans",
  ];
  const H1 = "# add-tmp-ignore\n\n";
  const read = (p: string) => fs.readFileSync(p, "utf8");
  const stripCard = (t: string) => t.replace(/(# add-tmp-ignore\n\n)(?:(?:WHAT|WHY|RISK|TOUCH|DONE) .*\n)+\n/, "$1");
  const withCard = (t: string, card: string[]) => stripCard(t).replace(H1, `${H1}${card.join("\n")}\n\n`);
  const CARDED = withCard(VALID_PLAN, CARD);
  const above = (t: string) => t.split("\n").indexOf("## Previous mistakes");
  const pad = (t: string, n: number) =>
    t.replace("## Context\n", `## Context\n${Array.from({ length: n }, (_, i) => `- filler ${i}\n`).join("")}`);
  const withSteps = (t: string, steps: string[], verify: string[]) =>
    t.replace(
      /## Steps\n[\s\S]*?(?=## Previous mistakes)/,
      `## Steps\n${steps.join("\n")}\n\n## Verify\n${verify.join("\n")}\n\n`,
    );
  const save = (content: string, ws = tmpWs()) => persistPlan({ workspaceRoot: ws, content, created });
  function saved(content = CARDED) {
    const ws = tmpWs();
    const r = save(content, ws);
    expect(r.ok, r.error).toBe(true);
    return { ws, abs: path.join(ws, r.path!) };
  }
  // A saved plan whose file was written before these rules: whatever is on disk is the previous version.
  function legacy(text: (saved: string) => string) {
    const s = saved();
    fs.writeFileSync(s.abs, text(read(s.abs)));
    return s;
  }

  describe("card", () => {
    it("saves a plan whose card follows the title", () => {
      const r = save(CARDED);
      expect(r.ok, r.error).toBe(true);
    });

    it("denies a fresh plan without a card", () => {
      const r = save(stripCard(VALID_PLAN));
      expect(r.ok).toBe(false);
      expect(r.errors).toContain("start with the 5-line card after the title: WHAT, WHY, RISK, TOUCH, DONE");
    });

    it("denies labels out of order and names the line", () => {
      const r = save(withCard(VALID_PLAN, [CARD[0]!, CARD[2]!, CARD[1]!, CARD[3]!, CARD[4]!]));
      expect(r.ok).toBe(false);
      expect(r.errors).toContain("card line 2 must start with WHY");
    });

    it("denies a card line over 120 characters and keeps one at 120", () => {
      const touch = (len: number) => "TOUCH  " + "x".repeat(len - "TOUCH  ".length);
      const long = save(withCard(VALID_PLAN, [CARD[0]!, CARD[1]!, CARD[2]!, touch(121), CARD[4]!]));
      expect(long.ok).toBe(false);
      expect(long.errors).toContain("card line 4 (TOUCH) is 121 characters; the limit is 120");
      const edge = save(withCard(VALID_PLAN, [CARD[0]!, CARD[1]!, CARD[2]!, touch(120), CARD[4]!]));
      expect(edge.ok, edge.error).toBe(true);
    });

    it("drops a PLAN_NAME sent after commit and strategy so the card sits under the title", () => {
      const body = CARDED.split("\n").slice(2).join("\n");
      const r = save(`commit: feat: add the thing\nstrategy: default\nPLAN_NAME: add tmp ignore\n${body}`);
      expect(r.ok, r.error).toBe(true);
      expect(r.content).not.toMatch(/^PLAN_NAME:/m);
      expect(r.content).toContain(`${H1}${CARD.join("\n")}\n\n## Goal`);
      expect(validatePlan(r.filename!, r.content!)).toEqual([]);
    });

    it("denies a label without its 7-column padding or text", () => {
      for (const why of ["WHY  plans stay untracked", "WHY    "]) {
        const r = save(withCard(VALID_PLAN, [CARD[0]!, why, CARD[2]!, CARD[3]!, CARD[4]!]));
        expect(r.ok, why).toBe(false);
        expect(r.errors, why).toContain('card line 2 (WHY) needs its text at column 8: "WHY    <text>"');
      }
    });

    it("denies a card longer than 5 lines", () => {
      const r = save(withCard(VALID_PLAN, [...CARD, "NOTE   one more"]));
      expect(r.ok).toBe(false);
      expect(r.errors).toContain("the card is 5 lines; end it with a blank line after DONE");
    });

    it("drops a PLAN_NAME under the title but keeps one inside a fence", () => {
      const under = save(
        CARDED.replace("PLAN_NAME: add tmp ignore\n", "").replace(H1, `${H1}PLAN_NAME: add tmp ignore\n\n`),
      );
      expect(under.ok, under.error).toBe(true);
      expect(under.content).not.toMatch(/^PLAN_NAME:/m);
      expect(under.filename).toMatch(/^1-add-tmp-ignore-/);
      const F = "```";
      const unnamed = CARDED.replace("PLAN_NAME: add tmp ignore\n", "");
      const fenced = save(unnamed.replace("\n\n## Goal", `\n\n${F}text\nPLAN_NAME: example\n${F}\n\n## Goal`));
      expect(fenced.ok, fenced.error).toBe(true);
      expect(fenced.filename).toMatch(/^1-add-tmp-ignore-/);
      expect(fenced.content).toMatch(/^PLAN_NAME: example$/m);
      const below = save(unnamed.replace("## Context\n", "## Context\nPLAN_NAME: example\n"));
      expect(below.filename).toMatch(/^1-add-tmp-ignore-/);
      expect(below.content).toMatch(/^PLAN_NAME: example$/m);
    });

    it("denies a body with no sections, named or not", () => {
      for (const content of ["PLAN_NAME: lone\n", "# lone\n\nno sections\n"]) {
        const r = save(content);
        expect(r.ok, content).toBe(false);
        expect(r.errors, content).toContain("heading order");
      }
    });

    it("names each line a short card is missing", () => {
      const r = save(withCard(VALID_PLAN, CARD.slice(0, 4)));
      expect(r.ok).toBe(false);
      expect(r.errors).toContain("card line 5 must start with DONE");
    });

    it("updates a saved plan that has no card", () => {
      const s = legacy(stripCard);
      const r = update(s.ws, s.abs, read(s.abs).replace("1.1 [ ]", "1.1 [x]"));
      expect(r.ok, r.error).toBe(true);
    });
  });

  describe("100-line cap", () => {
    const capError = (n: number) =>
      `${n} lines above ## Previous mistakes, the cap is 100; split it into a roadmap (/write-roadmap)`;
    // Lines the saved frontmatter and the carded body put above Previous mistakes.
    function baseline() {
      return above(read(saved().abs));
    }

    it("saves a fresh plan at exactly 100 lines and denies 101", () => {
      const base = baseline();
      const at = save(pad(CARDED, 100 - base));
      expect(at.ok, at.error).toBe(true);
      expect(above(at.content!)).toBe(100);
      const over = save(pad(CARDED, 101 - base));
      expect(over.ok).toBe(false);
      expect(over.errors).toContain(capError(101));
    });

    it("lets a 438-line legacy plan flip a box but not grow", () => {
      const s = legacy((t) => {
        const bare = stripCard(t);
        return pad(bare, 438 - above(bare));
      });
      expect(above(read(s.abs))).toBe(438);
      const flipped = read(s.abs).replace("1.1 [ ]", "1.1 [x]");
      const r = update(s.ws, s.abs, flipped);
      expect(r.ok, r.error).toBe(true);
      const grown = update(s.ws, s.abs, pad(flipped, 1));
      expect(grown.ok).toBe(false);
      expect(grown.errors).toContain(capError(439));
    });

    it("never counts Previous mistakes", () => {
      const entries = Array.from({ length: 150 }, (_, i) => `- review: miss ${i} → fix ${i}`).join("\n");
      const r = save(
        pad(CARDED, 100 - baseline()).replace("## Previous mistakes\n(none)", `## Previous mistakes\n${entries}`),
      );
      expect(r.ok, r.error).toBe(true);
    });
  });

  describe("principle reads", () => {
    const READS_PHASE = [
      "1 [ ] Read principles",
      "1.1 [ ] read `principle-test-behavior-not-implementation`",
      "1.2 [ ] read `principle-boundary-discipline`",
      "2 [ ] gitignore",
      "2.1 [ ] read the gitignore if it exists",
      "2.2 [ ] append .tmp/ when absent",
    ];
    const VERIFY = ["3 [ ] Verify", "3.1 [ ] git check-ignore reports ignored"];

    it("denies a fresh plan with a phase that only reads principles", () => {
      const r = save(withSteps(CARDED, READS_PHASE, VERIFY));
      expect(r.ok).toBe(false);
      expect(r.errors).toContain("phase 1 only reads principles; move each read into the phase it gates");
    });

    it("lets a saved plan that already has a reads phase flip a box", () => {
      const s = legacy((t) => withSteps(t, READS_PHASE, VERIFY));
      const r = update(s.ws, s.abs, read(s.abs).replace("2.1 [ ]", "2.1 [x]"));
      expect(r.ok, r.error).toBe(true);
    });

    it("denies an update that adds a reads phase the saved plan did not have", () => {
      const s = saved();
      const r = update(s.ws, s.abs, withSteps(read(s.abs), READS_PHASE, VERIFY));
      expect(r.ok).toBe(false);
      expect(r.errors).toContain("phase 1 only reads principles; move each read into the phase it gates");
    });

    it("saves a Verify that reads a principle and runs a command", () => {
      const r = save(
        withSteps(
          CARDED,
          ["1 [ ] gitignore", "1.1 [ ] append .tmp/ when absent"],
          ["2 [ ] Verify", "2.1 [ ] read `principle-prove-it-works`", "2.2 [ ] git check-ignore reports ignored"],
        ),
      );
      expect(r.ok, r.error).toBe(true);
    });
  });

  describe("parallel phases", () => {
    const phase = (n: number, title: string, files?: string) => [
      `${n} [ ] ${title}${files ? ` (parallel: ${files})` : ""}`,
      `${n}.1 [ ] do the ${title.toLowerCase()} work`,
    ];
    const verify = (n: number) => [`${n} [ ] Verify`, `${n}.1 [ ] git check-ignore reports ignored`];

    it("saves adjacent parallel phases with disjoint files", () => {
      const steps = [
        ...phase(1, "Setup"),
        ...phase(2, "Parser", "src/parse.ts, src/parse.test.ts"),
        ...phase(3, "Printer", "src/print.ts, src/print.test.ts"),
      ];
      const r = save(withSteps(CARDED, steps, verify(4)));
      expect(r.ok, r.error).toBe(true);
    });

    it("denies parallel phases that share a file, whichever separator it uses", () => {
      const steps = [
        ...phase(1, "Setup"),
        ...phase(2, "Parser", "src/cli.ts, src/parse.ts"),
        ...phase(3, "Printer", "src\\cli.ts, src/print.ts"),
      ];
      const r = save(withSteps(CARDED, steps, verify(4)));
      expect(r.ok).toBe(false);
      expect(r.errors).toContain("parallel phases 2 and 3 both list src/cli.ts; parallel phases need disjoint files");
    });

    it("denies a parallel phase that lists no files", () => {
      const steps = [
        ...phase(1, "Parser", "src/parse.ts"),
        `2 [ ] Printer (parallel: )`,
        "2.1 [ ] do the printer work",
      ];
      const r = save(withSteps(CARDED, steps, verify(3)));
      expect(r.ok).toBe(false);
      expect(r.errors).toContain("phase 2 is parallel with no files; list the files it writes after parallel:");
    });

    it("denies a parallel phase with no adjacent parallel phase", () => {
      const alone = [
        ...phase(1, "Setup"),
        ...phase(2, "Parser"),
        ...phase(3, "Wire"),
        ...phase(4, "Printer", "src/print.ts"),
      ];
      const r = save(withSteps(CARDED, alone, verify(5)));
      expect(r.ok).toBe(false);
      expect(r.errors).toContain("phase 4 is parallel alone; parallel needs two or more adjacent phases");
      const apart = [
        ...phase(1, "Setup"),
        ...phase(2, "Parser", "src/parse.ts"),
        ...phase(3, "Wire"),
        ...phase(4, "Printer", "src/print.ts"),
      ];
      const split = save(withSteps(CARDED, apart, verify(5)));
      expect(split.ok).toBe(false);
      expect(split.errors).toContain("phase 2 is parallel alone; parallel needs two or more adjacent phases");
      expect(split.errors).toContain("phase 4 is parallel alone; parallel needs two or more adjacent phases");
    });
  });
});
