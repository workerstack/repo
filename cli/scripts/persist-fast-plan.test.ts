import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { VALID_PLAN, savedOk } from "./__fixtures__/persist-bodies.ts";
import { updateFastPlan as update } from "./__fixtures__/persist-fast-plan-kit.ts";
import { read, useTmpWs } from "./__fixtures__/persist-plan-kit.ts";
import { fastPlanLineCount, validateFastPlan } from "./persist-fast-plan-validate.ts";
import { persistFastPlan } from "./persist-fast-plan.ts";
import { persistPlan } from "./persist-plan.ts";

const tmpWs = useTmpWs("persist-fast-");
const CREATED = "2026-11-13T03:00:00Z";

const BODY = [
  "# anything",
  "",
  "## Goal",
  "Ignore `.tmp/` in git.",
  "",
  "## Steps",
  "1 [ ] add `.tmp/` to `.gitignore`",
  "",
  "## Verify",
  "2 [ ] `git check-ignore .tmp/x` prints it",
  "",
].join("\n");

function filler(n: number) {
  const boxes = Array.from({ length: n }, (_, i) => `${i + 10} [ ] f`).join("\n");

  return BODY.replace("1 [ ]", `${boxes}\n1 [ ]`);
}

const HEAD = "FAST_PLAN_NAME: add tmp ignore\ncommit: chore: ignore .tmp\n";
const SENT = `${HEAD}${BODY}`;

function save(content: string, ws = tmpWs()) {
  return persistFastPlan({ content, created: CREATED, workspaceRoot: ws });
}

function saved(ws = tmpWs()) {
  const r = save(SENT, ws);
  expect(r.ok, r.error).toBe(true);

  return { abs: path.join(ws, savedOk(r).path), r: savedOk(r), ws };
}

function goodPlan() {
  return saved().r.content;
}

describe("fast plan save", () => {
  it("saves the Usage plan under plans-fast with the frontmatter and nothing else", () => {
    const { abs, r } = saved();
    expect(r.path).toBe(".repo/plans-fast/1-add-tmp-ignore-20261113T030000Z.md");
    expect(r.serial).toBe(1);
    expect(read(abs)).toBe(r.content);

    const head = `---\nserial: 1\nname: add-tmp-ignore\nstatus: ready\ncreated: 2026-11-13T03:00:00Z\n`;
    expect(
      r.content.startsWith(`${head}source: "add tmp ignore"\ncommit: chore: ignore .tmp\n---\n\n# add-tmp-ignore`),
    ).toBe(true);
    expect(r.content).not.toMatch(/^(reviews|strategy):/m);
    expect(r.content).not.toContain("FAST_PLAN_NAME");
  });

  it("names the plan from its heading and the source from the caller when sent, and omits an absent commit", () => {
    const r = save(BODY.replace("# anything", "# from heading"));
    expect(r.ok, r.error).toBe(true);
    expect(r.slug).toBe("from-heading");
    expect(r.content).not.toMatch(/^commit:/m);
    expect(r.content).toContain('source: "Ignore `.tmp/` in git."');
    const named = persistFastPlan({ content: SENT, source: "the person asked", workspaceRoot: tmpWs() });
    expect(named.content).toContain('source: "the person asked"');
  });

  it("uses a name line only above the first heading and keeps blank lines tidy", () => {
    const r = save(`\n\nFAST_PLAN_NAME: first\n\n\n${BODY}`);
    expect(r.ok, r.error).toBe(true);
    expect(r.slug).toBe("first");
    const bare = save("FAST_PLAN_NAME: only\n");
    expect(bare.ok).toBe(false);
  });
});

describe("fast plan serials and paths", () => {
  it("counts serials in plans-fast only", () => {
    const ws = tmpWs();
    const full = persistPlan({ content: VALID_PLAN, created: CREATED, workspaceRoot: ws });
    expect(full.ok, full.error).toBe(true);
    expect(save(SENT, ws).serial).toBe(1);
    expect(save(SENT.replace("add tmp ignore", "second one"), ws).serial).toBe(2);
    expect(fs.readdirSync(path.join(ws, ".repo/plans-fast"))).toHaveLength(2);
  });

  it("takes the serial after the highest one in plans-fast", () => {
    const ws = tmpWs();
    expect(save(SENT, ws).ok).toBe(true);
    fs.writeFileSync(path.join(ws, ".repo/plans-fast/9-x-20261113T030000Z.md"), "");
    expect(save(SENT, ws).serial).toBe(10);
  });

  it("saves under a root whose name holds Windows separators and returns a posix path", () => {
    const ws = process.platform === "win32" ? tmpWs() : path.join(tmpWs(), "C:\\Users\\me\\repo");
    fs.mkdirSync(ws, { recursive: true });
    const r = save(SENT, ws);
    expect(r.ok, r.error).toBe(true);
    expect(r.path).toBe(".repo/plans-fast/1-add-tmp-ignore-20261113T030000Z.md");
    expect(fs.existsSync(path.join(ws, savedOk(r).path))).toBe(true);
  });
});

describe("fast plan fence", () => {
  it("denies an unclosed code fence", () => {
    const r = save(`${SENT}\n\`\`\`\n`);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unclosed code fence/);
  });
});

describe("fast plan denials", () => {
  it("denies a strategy line", () => {
    const r = save(`${HEAD}strategy: spawn-fast\n${BODY}`);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("a fast plan has no strategy");
  });
});

describe("fast plan section and size denials", () => {
  it("denies a section beyond Goal, Steps and Verify, and a missing one", () => {
    const extra = save(`${SENT}\n## Context\n- x\n`);
    expect(extra.errors).toContain("a fast plan holds only Goal, Steps and Verify, then an optional Previous mistakes");
    const missing = save(SENT.replace(/## Verify[\s\S]*$/, ""));
    expect(missing.errors).toContain(
      "a fast plan holds only Goal, Steps and Verify, then an optional Previous mistakes",
    );
  });

  it("denies more than 40 lines counting the frontmatter, and allows exactly 40", () => {
    // Pad so the saved file is exactly 40 lines, then 41.
    const room = 40 - fastPlanLineCount(save(SENT).content ?? "");
    expect(save(`${HEAD}${filler(room)}`).ok).toBe(true);
    const over = save(`${HEAD}${filler(room + 1)}`);
    expect(over.errors).toContain("a fast plan is at most 40 lines; write a plan (/write-plan-deep)");
  });

  it("denies a ticked box on a new plan", () => {
    const r = save(SENT.replace("1 [ ]", "1 [x]"));
    expect(r.errors).toContain("a new fast plan has only [ ] boxes");
  });
});

describe("fast plan updates", () => {
  it("allows ticking boxes and moving ready to in-progress to done with no reviews key", () => {
    const { abs, ws } = saved();
    const going = read(abs).replace("status: ready", "status: in-progress").replace("1 [ ]", "1 [x]");
    expect(update(ws, abs, going).ok).toBe(true);
    expect(read(abs)).toMatch(/^status: in-progress$/m);
    const done = going.replace("status: in-progress", "status: done").replace("2 [ ]", "2 [x]");
    const r = update(ws, abs, done);
    expect(r.ok, r.error).toBe(true);
    expect(r.serial).toBe(1);
    expect(r.slug).toBe("add-tmp-ignore");
    expect(r.path).toBe(".repo/plans-fast/1-add-tmp-ignore-20261113T030000Z.md");
    expect(read(abs)).not.toMatch(/^reviews:/m);
    expect(read(abs)).toMatch(/^2 \[x\] /m);
  });
});

describe("fast plan status updates", () => {
  it("allows blocked and denies an unknown status", () => {
    const { abs, ws } = saved();
    expect(update(ws, abs, read(abs).replace("status: ready", "status: blocked")).ok).toBe(true);
    const r = update(ws, abs, read(abs).replace("status: blocked", "status: shipped"));
    expect(r.errors).toContain("status");
  });
});

describe("fast plan revisions", () => {
  it("keeps the saved head when a revision sends only the body", () => {
    const { abs, ws } = saved();
    const r = update(ws, abs, `FAST_PLAN_NAME: renamed\n${BODY.replace("Ignore", "Hide")}`);
    expect(r.ok, r.error).toBe(true);
    const text = read(abs);
    expect(text).toMatch(/^serial: 1$/m);
    expect(text).toMatch(/^created: 2026-11-13T03:00:00Z$/m);
    expect(text).toContain("Hide `.tmp/`");
  });

  it("denies a strategy added by an update and an unclosed fence", () => {
    const { abs, ws } = saved();
    const r = update(ws, abs, read(abs).replace("status: ready", "status: ready\nstrategy: spawn-fast"));
    expect(r.errors).toContain("a fast plan has no strategy");
    expect(update(ws, abs, `${read(abs)}\n\`\`\`\n`).ok).toBe(false);
  });

  it("denies a body-only rewrite of a file without frontmatter", () => {
    const { abs, ws } = saved();
    fs.writeFileSync(abs, "# add-tmp-ignore\n");
    expect(update(ws, abs, BODY).error).toMatch(/frontmatter/);
  });
});

describe("validateFastPlan head checks", () => {
  const name = "1-add-tmp-ignore-20261113T030000Z.md";

  it("passes a saved plan and names each head fault", () => {
    const text = goodPlan();
    expect(validateFastPlan(name, text)).toStrictEqual([]);
    expect(validateFastPlan("bad.md", text)).toContain("filename");
    expect(validateFastPlan(name, text.replace("serial: 1", "serial: 2"))).toContain("serial/filename");
    expect(validateFastPlan(name, text.replace("commit: chore: ignore .tmp", "commit: Nope"))).toContain("commit");
    expect(validateFastPlan(name, text.replace("name: add-tmp-ignore\n", ""))).toContain("missing name");
    expect(validateFastPlan(name, text.replace("# add-tmp-ignore", "# other"))).toContain("h1 slug");
    expect(validateFastPlan(name, "# no frontmatter\n")).toContain("missing frontmatter");
    expect(validateFastPlan(name, text.replace("\n---\n", "\n"))).toContain("unterminated frontmatter");
  });

  it("stops at an unclosed fence", () => {
    expect(validateFastPlan(name, `${goodPlan()}\n\`\`\`\n`).join()).toMatch(/unclosed code fence/);
  });

  it("counts a file without a final newline the same", () => {
    expect(validateFastPlan(name, goodPlan().replace(/\n$/, ""))).toStrictEqual([]);
  });
});
