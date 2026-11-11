import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractH1, nextSerial, slugify, utcDate } from "./persist-doc.ts";
import { extractMode, extractStrategy } from "./persist-keys.ts";
import { parseMistakes, reviewErrors } from "./persist-mistakes.ts";
import { extractCommit, injectFrontmatter } from "./persist-plan-head.ts";
import { cardErrors, usageErrors } from "./persist-sections.ts";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "persist-plan-helpers-"));
  tmpDirs.push(dir);
  return dir;
}

describe("plan name and serial helpers", () => {
  it("cuts a slug at 50 characters without a trailing hyphen", () => {
    const slug = slugify("abcdefghi ".repeat(8));
    expect(slug).toBe("abcdefghi-abcdefghi-abcdefghi-abcdefghi-abcdefghi");
    expect(slugify("Add Auth!")).toBe("add-auth");
  });

  it("finds the next serial in a missing dir, skipping stray names", () => {
    const ws = tmpWs();
    expect(nextSerial(path.join(ws, "none"))).toBe(1);
    for (const name of ["notes.txt", "readme.md", "7-a.md", "03-b.md"]) {
      fs.writeFileSync(path.join(ws, name), "");
    }
    expect(nextSerial(ws)).toBe(8);
  });

  it("reads commit, strategy and mode from the frontmatter first, then a body line", () => {
    const fm = "---\ncommit: feat: add x\nstrategy: review-fast\nmode: away\n---\n\n# t\n";
    expect(extractCommit(fm)).toBe("feat: add x");
    expect(extractStrategy(fm)).toBe("review-fast");
    expect(extractMode(fm)).toBe("away");
    const bare = "---\nserial: 1\n---\n\ncommit: fix: y\nmode: away\n";
    expect(extractCommit(bare)).toBe("fix: y");
    expect(extractMode(bare)).toBe("away");
    expect(extractStrategy(bare)).toBeUndefined();
    expect(extractCommit("---\ncommit: a: b")).toBe("a: b");
    expect(extractCommit("no commit here")).toBeUndefined();
  });
});

describe("plan text helpers", () => {
  it("returns an empty title when the text has none", () => {
    expect(extractH1("no heading")).toBe("");
    expect(extractH1("x\n# Title  \ny")).toBe("Title");
  });

  it("renders frontmatter with an empty source and today's UTC datetime when none is given", () => {
    const text = injectFrontmatter({ serial: 2, slug: "x", body: "text" });
    expect(text).toMatch(
      /^---\nserial: 2\nname: x\nstatus: ready\nreviews: 0\ncreated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\nsource: ""\n---\n\n# x\n\ntext$/,
    );
  });

  it("names a UTC date, today's by default", () => {
    expect(utcDate(new Date("2026-08-26T23:59:59Z"))).toBe("2026-08-26");
    expect(utcDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("denies a body whose second line is not blank as a missing card", () => {
    expect(cardErrors("# t\nWHAT x")).toStrictEqual([
      "start with the 5-line card after the title: WHAT, WHY, RISK, TOUCH, DONE",
    ]);
  });
});

describe("plan list helpers", () => {
  it("denies a Usage section with no body", () => {
    expect(usageErrors(["Goal", "Usage"], { Usage: "" }, { fresh: true })).toStrictEqual([
      '## Usage needs a fenced example or a "No visible change:" line',
    ]);
  });

  it("reads an absent mistakes section as empty", () => {
    expect(parseMistakes(undefined, ["review"]).errors).toStrictEqual(["## Previous mistakes is empty; write (none)"]);
  });

  it("lets a map with no status enter no gated status", () => {
    expect(
      reviewErrors({ reviews: "0" }, null, { gates: { "in-progress": 1 }, review: "/review-plan {n}" }),
    ).toStrictEqual([]);
  });
});
