import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { extractH1, nextSerial, slugify, utcDate } from "./persist-doc.ts";
import { extractApproval, extractStrategy } from "./persist-keys.ts";
import { parseMistakes, reviewErrors } from "./persist-mistakes.ts";
import { extractCommit, injectFrontmatter, stripCommitLine } from "./persist-plan-head.ts";
import { reviewsToEnter } from "./persist-plan.constants.ts";
import { cardErrors, usageErrors } from "./persist-sections.ts";

const NOW_RE = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/;

useTempDirs();

function tmpWs(): string {
  return tempDir("persist-plan-helpers-");
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

    for (const name of ["notes.txt", "readme.md", "7-a.md", "03-b.md"]) fs.writeFileSync(path.join(ws, name), "");

    expect(nextSerial(ws)).toBe(8);
  });

  it("reads commit, strategy and approval from the frontmatter first, then a body line", () => {
    const fm = "---\ncommit: feat: add x\nstrategy: spawn-fast\napproval: away\n---\n\n# t\n";
    expect(extractCommit(fm)).toBe("feat: add x");
    expect(extractStrategy(fm)).toBe("spawn-fast");
    expect(extractApproval(fm)).toBe("away");
    const bare = "---\nserial: 1\n---\n\ncommit: fix: y\napproval: away\n";
    expect(extractCommit(bare)).toBe("fix: y");
    expect(extractApproval(bare)).toBe("away");
    expect(extractStrategy(bare)).toBeUndefined();
    expect(extractCommit("---\ncommit: a: b")).toBe("a: b");
    expect(extractCommit("no commit here")).toBeUndefined();
  });
});

describe("the commit line", () => {
  it("reads an empty commit line as empty and strips only that line", () => {
    const body = "commit:\n# title\n\ntext\n";
    expect(extractCommit(body)).toBe("");
    expect(stripCommitLine(body)).toBe("# title\n\ntext\n");
    expect(extractCommit("commit: fix: y\r\n# t")).toBe("fix: y");
    expect(stripCommitLine("commit: fix: y\r\n# t")).toBe("# t");
  });
});

describe("plan text helpers", () => {
  it("returns an empty title when the text has none", () => {
    expect(extractH1("no heading")).toBe("");
    expect(extractH1("x\n# Title  \ny")).toBe("Title");
  });

  it("renders frontmatter with an empty source and today's UTC datetime when none is given", () => {
    const text = injectFrontmatter({ body: "text", serial: 2, slug: "x" });
    expect(text.replace(NOW_RE, "<now>")).toBe(
      '---\nserial: 2\nname: x\nstatus: ready\nreviews: 0\ncreated: <now>\nsource: ""\n---\n\n# x\n\ntext',
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
    expect(reviewErrors({ reviews: "0" }, null, { gates: reviewsToEnter, review: "/review-plan {n}" })).toStrictEqual(
      [],
    );
  });
});
