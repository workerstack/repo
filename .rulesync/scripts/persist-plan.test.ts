import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPersistCli } from "./fixtures/run-persist-cli.mjs";
import { VALID_LESSON, VALID_PLAN } from "./fixtures/persist-bodies.mjs";
import { persistLesson } from "./lessons.mjs";
import {
  LEGACY_PLAN_DIR,
  PLAN_DIR,
  migrateLegacyPlansDir,
  persistPlan,
  preparePlanUpdate,
  slugify,
  utcDateTime,
  validatePlan,
  workspacePaths,
} from "./persist-plan.mjs";

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
    expect(utcDateTime(new Date("2026-08-26T14:30:00.123Z"))).toBe(
      "2026-08-26T14:30:00Z",
    );
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
    expect(path.isAbsolute(r.path)).toBe(false);
    expect(fs.existsSync(path.join(ws, r.path))).toBe(true);
    const text = fs.readFileSync(path.join(ws, r.path), "utf8");
    expect(text).toMatch(/^---\nserial: 1\n/);
    expect(text).toMatch(/^name: add-tmp-ignore$/m);
    expect(text).toMatch(/^created: 2026-08-26T14:30:00Z$/m);
    expect(text).not.toMatch(/serial: 0001/);
    expect(validatePlan(r.filename, text)).toEqual([]);
    expect(fs.readFileSync(path.join(ws, ".gitignore"), "utf8")).toMatch(
      /^\.tmp\/$/m,
    );
  });

  it("stamps filename from created when created is omitted", () => {
    const ws = tmpWs();
    const r = persistPlan({ workspaceRoot: ws, content: VALID_PLAN });
    expect(r.ok).toBe(true);
    expect(r.filename).toMatch(/^1-add-tmp-ignore-\d{8}T\d{6}Z\.md$/);
    const text = fs.readFileSync(path.join(ws, r.path!), "utf8");
    const m = text.match(/^created: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/m);
    expect(m).toBeTruthy();
    expect(r.filename).toBe(
      `1-add-tmp-ignore-${m![1].replace(/[-:]/g, "")}.md`,
    );
  });

  it("accepts legacy unstamped filename and date-only created", () => {
    const ws = tmpWs();
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_PLAN,
      created: "2026-08-26T14:30:00Z",
    });
    expect(r.ok).toBe(true);
    const legacy = String(r.content).replace(
      /^created: 2026-08-26T14:30:00Z$/m,
      "created: 2026-08-26",
    );
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

  it("writes under PLAN_DIR not legacy", () => {
    const ws = tmpWs();
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_PLAN,
      created: "2026-08-26T14:30:00Z",
    });
    expect(r.ok).toBe(true);
    expect(r.path).toBe(`${PLAN_DIR}/${r.filename}`);
    expect(fs.existsSync(path.join(ws, LEGACY_PLAN_DIR))).toBe(false);
  });

  it("renames legacy plans dir when new is missing", () => {
    const ws = tmpWs();
    const legacy = path.join(ws, LEGACY_PLAN_DIR);
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, "9-old-20260826T143000Z.md"), "x");
    expect(migrateLegacyPlansDir(ws)).toBe(path.join(ws, PLAN_DIR));
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.existsSync(path.join(ws, PLAN_DIR, "9-old-20260826T143000Z.md"))).toBe(
      true,
    );
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_PLAN,
      created: "2026-08-26T14:30:00Z",
    });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(10);
    expect(r.path).toBe(`${PLAN_DIR}/${r.filename}`);
  });

  it("leaves legacy plans when both dirs exist", () => {
    const ws = tmpWs();
    const legacy = path.join(ws, LEGACY_PLAN_DIR);
    const next = path.join(ws, PLAN_DIR);
    fs.mkdirSync(legacy, { recursive: true });
    fs.mkdirSync(next, { recursive: true });
    fs.writeFileSync(path.join(legacy, "9-old-20260826T143000Z.md"), "x");
    migrateLegacyPlansDir(ws);
    expect(fs.existsSync(path.join(legacy, "9-old-20260826T143000Z.md"))).toBe(
      true,
    );
    const r = persistPlan({
      workspaceRoot: ws,
      content: VALID_PLAN,
      created: "2026-08-26T14:30:00Z",
    });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(1);
    expect(fs.existsSync(path.join(legacy, "9-old-20260826T143000Z.md"))).toBe(
      true,
    );
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
    const r = persistPlan({ workspaceRoot: ws, content: VALID_PLAN.replace(/\n## Previous mistakes\n\(none\)\n$/, "\n") });
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
});

describe("lesson citations", () => {
  function wsWithLesson() {
    const ws = tmpWs();
    fs.mkdirSync(path.join(ws, "src"), { recursive: true });
    fs.writeFileSync(path.join(ws, "src/a.ts"), "x\n");
    const file = path.join(ws, ".rulesync/lessons/plan-forks.md");
    const r = persistLesson({ workspaceRoot: ws, filePath: file, content: VALID_LESSON });
    expect(r.ok, r.error).toBe(true);
    fs.writeFileSync(file, r.content!);
    return ws;
  }

  function touching(ws: string, cite = false) {
    const leaf = VALID_PLAN.replace("1.1 [ ] read the gitignore if it exists", `1.1 [ ] edit ${path.join(ws, "src/a.ts")}`);
    return cite
      ? leaf.replace("## Watch-outs\n", "## Watch-outs\n- .rulesync/lessons/plan-forks.md: keep the saved serial\n")
      : leaf;
  }

  it("denies a new plan that touches a file a lesson matches and names the lesson", () => {
    const ws = wsWithLesson();
    const r = persistPlan({ workspaceRoot: ws, content: touching(ws) });
    expect(r.ok).toBe(false);
    expect(r.error).toContain(".rulesync/lessons/plan-forks.md");
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

describe("persist-plan CLI", () => {
  it("prints the absolute path of the saved file for a relative --workspace", () => {
    const r = runPersistCli("persist-plan.mjs", VALID_PLAN);
    tmpDirs.push(r.cwd);
    expect(r.status, r.stderr).toBe(0);
    expect(r.json.absPath).toBe(path.join(r.ws, r.json.path));
    expect(fs.existsSync(r.json.absPath)).toBe(true);
  });
});
