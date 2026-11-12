import { describe, expect, it } from "vitest";

import { lesson } from "./__fixtures__/lessons-kit.ts";
import { parseLesson } from "./lesson-file.ts";

function errorsOf(text: string, defaults?: Record<string, string>) {
  const r = parseLesson(text, defaults === undefined ? undefined : { defaults });

  return r.ok ? [] : r.errors;
}

const BODY = "# T\n\nSummary.\n\n## Mistake\nm\n\n## Fix\nf\n";

function head(extra = "") {
  return `---\nname: a-b\npaths: ["src/**"]\nhits: 1\nlast-hit: 2026-10-31\nevidence: []\n${extra}---\n\n`;
}

describe("parseLesson frontmatter", () => {
  it("accepts a lesson whose frontmatter has blank and indented lines", () => {
    const text = head("\n  - stray\n") + BODY;
    expect(parseLesson(text).ok).toBe(true);
  });

  it("strips a byte order mark", () => {
    expect(parseLesson(`﻿${head()}${BODY}`).ok).toBe(true);
  });

  it("rejects text with no frontmatter or an unterminated one", () => {
    expect(errorsOf("# T\n")[0]).toMatch(/start with --- frontmatter/);
    expect(errorsOf("---\nname: a-b\n# T\n")[0]).toMatch(/start with --- frontmatter/);
  });

  it("names an unknown key", () => {
    expect(errorsOf(head("colour: red\n") + BODY)).toContain("unknown frontmatter key: colour");
  });
});

describe("parseLesson keys", () => {
  it("rejects paths that are missing, not a list, not strings or not JSON", () => {
    const noPaths = head().replace('paths: ["src/**"]\n', "");

    for (const paths of [
      noPaths,
      head().replace('["src/**"]', '"src"'),
      head().replace('["src/**"]', "[1]"),
      head().replace('["src/**"]', "["),
    ])
      expect(errorsOf(paths + BODY).join(";")).toMatch(/paths must list at least one glob/);
  });

  it("defaults missing evidence to none and rejects evidence that is not a list", () => {
    const noEvidence = head().replace("evidence: []\n", "");
    expect(errorsOf(noEvidence + BODY).join(";")).toBe("");
    expect(errorsOf(head().replace("[]", "{}") + BODY).join(";")).toMatch(/evidence must be a JSON list/);
  });

  it("rejects bad hits, last-hit and name, missing or malformed", () => {
    for (const [from, to, reason] of [
      ["hits: 1", "hits: 0", /hits must be/],
      ["hits: 1", "hits: x", /hits must be/],
      ["last-hit: 2026-10-31", "last-hit: 31/10", /last-hit must be/],
      ["name: a-b", "name: A_B", /lowercase-hyphen slug/],
    ] as const)
      expect(errorsOf(head().replace(from, to) + BODY).join(";")).toMatch(reason);

    const bare = head().replace("name: a-b\n", "").replace("last-hit: 2026-10-31\n", "");
    expect(errorsOf(bare + BODY).join(";")).toMatch(/last-hit must be.*lowercase-hyphen slug/);
  });
});

describe("parseLesson defaults", () => {
  it("fills missing keys from defaults", () => {
    const bare = head().replace("name: a-b\n", "").replace("last-hit: 2026-10-31\n", "");
    expect(errorsOf(bare + BODY, { "last-hit": "2026-11-01", name: "z" })).toStrictEqual([]);
  });

  it("round-trips a rendered lesson", () => {
    const r = parseLesson(lesson());
    expect(r.ok && r.lesson.fix).toBe("Update the saved file in place and keep its serial.");
  });
});

describe("parseLesson body", () => {
  it("wants a # title line", () => {
    expect(errorsOf(`${head()}Summary.\n\n## Mistake\nm\n\n## Fix\nf\n`)).toContain(
      "start the body with a # title line",
    );
  });

  it("wants a summary under the title, before any section", () => {
    expect(errorsOf(`${head()}# T\n`)).toContain("put a one-line summary under the # title");
    expect(errorsOf(`${head()}# T\n## Mistake\nm\n## Fix\nf\n`)).toContain("put a one-line summary under the # title");
  });

  it("names a missing or empty section", () => {
    expect(errorsOf(`${head()}# T\n\nS.\n\n## Mistake\nm\n`)).toContain("missing ## Fix");
    expect(errorsOf(`${head()}# T\n\nS.\n\n## Mistake\n\n## Fix\nf\n`)).toContain("## Mistake is empty");
  });

  it("allows only Mistake then Fix", () => {
    const swapped = errorsOf(`${head()}# T\n\nS.\n\n## Fix\nf\n\n## Mistake\nm\n`);
    expect(swapped).toStrictEqual(["use only ## Mistake then ## Fix as section headings"]);
  });
});
