import path from "node:path";

import { describe, expect, it } from "vitest";

import { savedOk } from "./__fixtures__/persist-bodies.ts";
import { updateFastPlan as update } from "./__fixtures__/persist-fast-plan-kit.ts";
import { read, useTmpWs } from "./__fixtures__/persist-plan-kit.ts";
import { fastPlanLineCount, validateFastPlan } from "./persist-fast-plan-validate.ts";
import { persistFastPlan } from "./persist-fast-plan.ts";

const tmpWs = useTmpWs("persist-fast-mistakes-");
const CREATED = "2026-11-13T03:00:00Z";
const HEAD = "FAST_PLAN_NAME: add tmp ignore\n";
const ENTRY = "- decision: which file → .gitignore, because git reads it";
const LOG = `\n## Previous mistakes\n${ENTRY}\n- review: missed a case → added it\n`;
const APPEND_ONLY = `Previous mistakes is append-only; keep this entry unchanged: ${ENTRY}`;

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

function save(content: string, ws = tmpWs()) {
  return persistFastPlan({ content, created: CREATED, workspaceRoot: ws });
}

/** The body padded so the saved plan is exactly `40 + extra` lines. */
function atCap(extra = 0) {
  const room = 40 - fastPlanLineCount(save(`${HEAD}${BODY}`).content ?? "") + extra;
  const boxes = Array.from({ length: room }, (_, i) => `${i + 10} [ ] f`).join("\n");

  return `${HEAD}${BODY.replace("1 [ ]", `${boxes}\n1 [ ]`)}`;
}

function savedAtCap(log = LOG) {
  const ws = tmpWs();
  const r = save(`${atCap()}${log}`, ws);
  expect(r.ok, r.error).toBe(true);

  return { abs: path.join(ws, savedOk(r).path), ws };
}

describe("fast plan Previous mistakes saves", () => {
  it("saves a new plan at its 40-line cap with a trailing log, and still caps the lines above it", () => {
    savedAtCap();
    const over = save(`${atCap(1)}${LOG}`);
    expect(over.errors).toContain("a fast plan is at most 40 lines; write a plan (/write-plan-deep)");
  });

  it("adds a log to a saved plan at its cap and appends to it", () => {
    const { abs, ws } = savedAtCap("");
    const logged = update(ws, abs, `${read(abs)}${LOG}`);
    expect(logged.ok, logged.error).toBe(true);
    const more = update(ws, abs, `${read(abs)}- verify: c → d\n`);
    expect(more.ok, more.error).toBe(true);
    expect(read(abs).endsWith("- verify: c → d\n")).toBe(true);
  });
});

/** A fast plan body whose Goal shows a fenced `## Previous mistakes` line, padded with `boxes` steps. */
function fencedLog(boxes: number) {
  const steps = Array.from({ length: boxes }, (_, i) => `${i + 10} [ ] f`).join("\n");
  const goal = "Ignore `.tmp/` in git.\n\n```md\n## Previous mistakes\n(none)\n```";

  return `${HEAD}${BODY.replace("Ignore `.tmp/` in git.", goal).replace("1 [ ]", `${steps}\n1 [ ]`)}`;
}

describe("fast plan Previous mistakes fenced heading", () => {
  it("counts the lines past a fenced ## Previous mistakes line", () => {
    const text = fencedLog(0);
    expect(fastPlanLineCount(text)).toBe(text.replace(/\n$/, "").split("\n").length);
  });

  it("denies a plan over the cap whose only Previous mistakes heading is fenced", () => {
    expect(save(fencedLog(40)).errors).toContain("a fast plan is at most 40 lines; write a plan (/write-plan-deep)");
  });
});

describe("fast plan Previous mistakes denials", () => {
  it("denies a changed or dropped entry on update", () => {
    const { abs, ws } = savedAtCap();
    expect(update(ws, abs, read(abs).replace("because git reads it", "because")).errors).toContain(APPEND_ONLY);
    expect(update(ws, abs, read(abs).replace(`${ENTRY}\n`, "")).errors).toContain(APPEND_ONLY);
    expect(update(ws, abs, read(abs).replace(/\n## Previous mistakes[\s\S]*$/, "\n")).errors).toContain(APPEND_ONLY);
  });

  it("denies a malformed entry and a log that is not last", () => {
    const bad = save(`${HEAD}${BODY}\n## Previous mistakes\n- nope: a → b\n`);
    expect(bad.errors?.join()).toMatch(/Previous mistakes entry must be "- \{feedback\|.*decision\}/);
    const early = save(`${HEAD}${BODY.replace("## Verify", "## Previous mistakes\n(none)\n\n## Verify")}`);
    expect(early.errors).toContain("## Previous mistakes must be the last heading, once");
  });

  it("checks against the previous text it is given", () => {
    const { abs } = savedAtCap();
    const text = read(abs);
    const name = path.basename(abs);
    expect(validateFastPlan(name, text, { fresh: false, previous: text })).toStrictEqual([]);
    const dropped = text.replace(`${ENTRY}\n`, "");
    expect(validateFastPlan(name, dropped, { fresh: false, previous: text })).toContain(APPEND_ONLY);
  });
});
