import { describe, expect, it } from "vitest";

import {
  BODY,
  NAME,
  PLAN_ABS,
  SENT,
  saveRoadmap,
  savedRoadmap,
  updateRoadmap,
  withExtraBoxes,
  withLocation,
} from "./__fixtures__/persist-fast-roadmap-kit.ts";
import { read, useTmpWs } from "./__fixtures__/persist-plan-kit.ts";
import { fastRoadmapLineCount, validateFastRoadmap } from "./persist-fast-roadmap-validate.ts";

const tmpWs = useTmpWs("persist-fast-roadmap-up-");
const SLICE_2 = "2 [ ] ignore logs: add *.log to .gitignore";

describe("fast roadmap updates", () => {
  it("allows Locations that take the file past 20 raw lines", () => {
    const ws = tmpWs();
    const first = saveRoadmap(withExtraBoxes(4), ws);
    expect(first.ok, first.error).toBe(true);
    const abs = `${ws}/${first.path}`;
    const located = withLocation(read(abs), PLAN_ABS).replace(SLICE_2, `${SLICE_2}\n      Location: ${PLAN_ABS}`);
    expect(located.split("\n").length).toBeGreaterThan(20);
    expect(updateRoadmap(ws, abs, located).ok).toBe(true);
  });
});

describe("fast roadmap status moves", () => {
  it("allows ticks and draft, locked, in-progress, done with no reviews key", () => {
    const { abs, ws } = savedRoadmap(tmpWs());
    let text = read(abs);

    for (const [from, to] of [
      ["draft", "locked"],
      ["locked", "in-progress"],
    ] as const) {
      text = text.replace(`status: ${from}`, `status: ${to}`);
      expect(updateRoadmap(ws, abs, text).ok).toBe(true);
    }

    const done = text
      .replace("status: in-progress", "status: done")
      .replace("1 [ ]", "1 [x]")
      .replace("3 [ ]", "3 [x]");

    const r = updateRoadmap(ws, abs, done);

    expect(r.ok, r.error).toBe(true);
    expect(r.serial).toBe(1);
    expect(read(abs)).not.toMatch(/^reviews:/m);
    expect(read(abs)).toMatch(/^3 \[x\] /m);
  });
});

describe("fast roadmap status and revisions", () => {
  it("allows blocked and denies an unknown status or a strategy", () => {
    const { abs, ws } = savedRoadmap(tmpWs());
    expect(updateRoadmap(ws, abs, read(abs).replace("status: draft", "status: blocked")).ok).toBe(true);
    expect(updateRoadmap(ws, abs, read(abs).replace("status: blocked", "status: ready")).errors).toContain("status");
    const strategic = read(abs).replace("status: blocked", "status: draft\nstrategy: spawn-fast");
    expect(updateRoadmap(ws, abs, strategic).errors).toContain("a fast roadmap has no strategy");
  });

  it("keeps the saved head when a revision sends only the body", () => {
    const { abs, ws } = savedRoadmap(tmpWs());
    const r = updateRoadmap(ws, abs, `FAST_ROADMAP_NAME: renamed\n${BODY.replace("ignore tmp", "hide tmp")}`);
    expect(r.ok, r.error).toBe(true);
    expect(read(abs)).toMatch(/^serial: 1$/m);
    expect(read(abs)).toContain("hide tmp");
    expect(updateRoadmap(ws, abs, `${read(abs)}\n\`\`\`\n`).ok).toBe(false);
  });
});

describe("validateFastRoadmap head checks", () => {
  it("passes a saved roadmap and names each head fault", () => {
    const text = savedRoadmap(tmpWs()).r.content;
    expect(validateFastRoadmap(NAME, text)).toStrictEqual([]);
    expect(validateFastRoadmap("bad.md", text)).toContain("filename");
    expect(validateFastRoadmap(NAME, text.replace("serial: 1", "serial: 2"))).toContain("serial/filename");
    expect(validateFastRoadmap(NAME, text.replace("name: tidy-ignores\n", ""))).toContain("missing name");
    expect(validateFastRoadmap(NAME, text.replace("# tidy-ignores", "# other"))).toContain("h1 slug");
    expect(validateFastRoadmap(NAME, "# no frontmatter\n")).toContain("missing frontmatter");
    expect(validateFastRoadmap(NAME, `${text}\n\`\`\`\n`).join()).toMatch(/unclosed code fence/);
    expect(validateFastRoadmap(NAME, text.replace(/\n$/, ""))).toStrictEqual([]);
  });
});

const LOG = "\n## Previous mistakes\n- slice: split too thin → merged two slices\n";
const KEPT = "Previous mistakes is append-only; keep this entry unchanged: - slice: split too thin → merged two slices";

/** The Usage roadmap padded to exactly `20 + extra` counted lines. */
function atCap(extra = 0) {
  return withExtraBoxes(20 - fastRoadmapLineCount(savedRoadmap(tmpWs()).r.content) + extra);
}

describe("fast roadmap Previous mistakes saves", () => {
  it("saves a new roadmap at its 20-line cap with a trailing log, and still caps the lines above it", () => {
    const r = saveRoadmap(`${atCap()}${LOG}`, tmpWs());
    expect(r.ok, r.error).toBe(true);
    expect(saveRoadmap(`${atCap(1)}${LOG}`, tmpWs()).errors).toContain(
      "a fast roadmap is at most 20 lines; write a roadmap (/write-roadmap)",
    );
  });

  it("adds a log to a saved roadmap at its cap and appends to it", () => {
    const ws = tmpWs();
    const first = saveRoadmap(atCap(), ws);
    expect(first.ok, first.error).toBe(true);
    const abs = `${ws}/${first.path}`;
    expect(updateRoadmap(ws, abs, `${read(abs)}${LOG}`).ok).toBe(true);
    const more = updateRoadmap(ws, abs, `${read(abs)}- decision: a → b\n`);
    expect(more.ok, more.error).toBe(true);
  });
});

describe("fast roadmap Previous mistakes denials", () => {
  it("denies a changed or dropped entry, a malformed entry, and a log that is not last", () => {
    const ws = tmpWs();
    const first = saveRoadmap(`${SENT}${LOG}`, ws);
    expect(first.ok, first.error).toBe(true);
    const abs = `${ws}/${first.path}`;
    expect(updateRoadmap(ws, abs, read(abs).replace("merged two", "merged")).errors).toContain(KEPT);
    expect(updateRoadmap(ws, abs, read(abs).replace(/\n## Previous mistakes[\s\S]*$/, "\n")).errors).toContain(KEPT);
    expect(updateRoadmap(ws, abs, `${read(abs)}- nope: a → b\n`).errors?.join()).toMatch(/\|slice\}: \{what was/);
    const early = saveRoadmap(SENT.replace("## Verify", "## Previous mistakes\n(none)\n\n## Verify"), tmpWs());
    expect(early.errors).toContain("## Previous mistakes must be the last heading, once");
  });
});
