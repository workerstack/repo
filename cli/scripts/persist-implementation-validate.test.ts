import { describe, expect, it } from "vitest";

import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { VALID_IMPL } from "./__fixtures__/persist-bodies.ts";
import { docEditor, savedDoc } from "./__fixtures__/persist-edit-kit.ts";
import { extractH1, slugFromFilename } from "./persist-doc.ts";
import { filesError, validateImplementation } from "./persist-implementation-validate.ts";
import {
  extractImplName,
  extractImplPlan,
  injectFrontmatter,
  isFullImplementationBody,
  persistImplementation,
  stripImplMeta,
} from "./persist-implementation.ts";

const NOW_RE = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/;

useTempDirs();

function tmpWs(): string {
  return tempDir("persist-impl-v-");
}

const saved = savedDoc(
  persistImplementation({ content: VALID_IMPL, created: "2026-08-26T14:30:00Z", workspaceRoot: tmpWs() }),
);

/** `edit` gives the saved journal with `from` replaced by `to`. */
const { edit, errorsOf } = docEditor(saved, validateImplementation);

function section(heading: string, body: string) {
  return edit(`## ${heading}\n(none)`, `## ${heading}\n${body}`);
}

describe("journal meta readers", () => {
  it("reads IMPL_NAME and the first H1", () => {
    expect(extractImplName("IMPL_NAME:  a  b \n# h")).toBe("a  b");
    expect(extractImplName("# h")).toBe("");
    expect(extractH1("x\n# Title  \n")).toBe("Title");
    expect(extractH1("none")).toBe("");
  });

  it("reads IMPL_PLAN as a serial, none, or an empty string when it is not one", () => {
    expect(extractImplPlan("# h")).toBe("none");
    expect(extractImplPlan("IMPL_PLAN: none")).toBe("none");
    expect(extractImplPlan("IMPL_PLAN:   ")).toBe("none");
    expect(extractImplPlan("IMPL_PLAN: 12")).toBe("12");
    expect(extractImplPlan("IMPL_PLAN: 012")).toBe("");
    expect(extractImplPlan("IMPL_PLAN: soon")).toBe("");
  });

  it("strips the meta lines and a BOM, and takes the slug from a filename", () => {
    expect(stripImplMeta("\uFEFFIMPL_NAME: a\r\nIMPL_PLAN: 3\r\n# h\r\n")).toBe("# h\n");
    expect(slugFromFilename("2-some-slug-20260826T143000Z.md")).toBe("some-slug");
    expect(slugFromFilename("2-some-slug.md")).toBe("some-slug");
  });

  it("tells a full journal from a bare Done line", () => {
    expect(isFullImplementationBody("---\nserial: 1\n---\n")).toBe(true);
    expect(isFullImplementationBody("text\n# Title\n")).toBe(true);
    expect(isFullImplementationBody("text\n## Done\n- x")).toBe(true);
    expect(isFullImplementationBody("plain text")).toBe(false);
  });
});

/** The lines a renamed body saves as. */
const RENAMED = [
  "---",
  "serial: 2",
  "plan: 9",
  "name: the-slug",
  "status: in-progress",
  "created: 2026-08-26T14:30:00Z",
  'source: "src"',
  "---",
  "",
  "# the-slug",
  "",
  "rest",
  "",
];

describe("injectFrontmatter", () => {
  it("writes the plan it is given and the slug as H1", () => {
    const out = injectFrontmatter({
      body: "---\nold: 1\n---\n\n# Other\n\nrest\n",
      created: "2026-08-26T14:30:00Z",
      plan: "9",
      serial: 2,
      slug: "the-slug",
      source: "src",
    });

    expect(out).toBe(RENAMED.join("\n"));
  });

  it("defaults the plan to none for a bad value, adds an H1, and stamps now", () => {
    const out = injectFrontmatter({ body: "text", plan: "07", serial: 1, slug: "s" });
    expect(out.replace(NOW_RE, "<now>")).toBe(
      '---\nserial: 1\nplan: none\nname: s\nstatus: in-progress\ncreated: <now>\nsource: ""\n---\n\n# s\n\ntext',
    );
    expect(injectFrontmatter({ body: "---\nopen: 1\n", serial: 1, slug: "s" })).toContain("# s\n\n---\nopen: 1\n");
  });
});

describe("validateImplementation frontmatter", () => {
  it("reports a missing or unterminated frontmatter alone", () => {
    expect(errorsOf("# x\n")).toStrictEqual(["missing frontmatter"]);
    expect(errorsOf("---\nserial: 1\n")).toStrictEqual(["unterminated frontmatter"]);
  });

  it("reports missing keys, skipping lines that are not keys", () => {
    const text = saved.text
      .replaceAll(/^(plan|name|created|source):.*\n/gm, "")
      .replace("status: in-progress", "status:\nBad Line");

    expect(errorsOf(text)).toStrictEqual(
      expect.arrayContaining(["missing plan", "missing name", "missing status", "missing created", "missing source"]),
    );
  });

  it("reports a bad status, plan, created, a long source and a mismatched name", () => {
    expect(errorsOf(edit("status: in-progress", "status: ready"))).toContain("status");
    expect(errorsOf(edit("plan: 6", "plan: 06"))).toContain("plan");
    expect(errorsOf(edit("created: 2026-08-26T14:30:00Z", "created: soon"))).toContain("created");
    expect(errorsOf(edit("created: 2026-08-26T14:30:00Z", "created: 2026-08-26"))).toStrictEqual([]);
    expect(errorsOf(edit('source: "add tmp ignore"', `source: "${"x".repeat(121)}"`))).toContain("source length");
    expect(errorsOf(edit("name: add-tmp-ignore", "name: other"))).toStrictEqual(
      expect.arrayContaining(["name/filename slug", "h1 slug"]),
    );
  });

  it("reads a quoted source as JSON and falls back to the bare text when the quotes do not parse", () => {
    expect(errorsOf(edit('source: "add tmp ignore"', 'source: "a \\"b\\""'))).toStrictEqual([]);
    expect(errorsOf(edit('source: "add tmp ignore"', 'source: "bad \\q"'))).toStrictEqual([]);
    expect(errorsOf(edit('source: "add tmp ignore"', 'source: "'))).toContain("missing source");
  });
});

describe("validateImplementation body", () => {
  it("returns the fence error with the earlier ones when a fence stays open", () => {
    const errors = errorsOf(`${edit("status: in-progress", "status: ready")}\n\`\`\`md\n`);
    expect(errors).toContain("status");
    expect(errors.length).toBeGreaterThan(1);
    expect(errors).not.toContain("heading order");
  });

  it("rejects out-of-order headings and a missing section", () => {
    expect(errorsOf(edit("## Issue\n(none)\n\n## Files\n(none)", "## Files\n(none)\n\n## Issue\n(none)"))).toContain(
      "heading order",
    );
    expect(errorsOf(edit("## Notes\n(none)\n", ""))).toStrictEqual(
      expect.arrayContaining(["heading order", "Notes empty"]),
    );
  });

  it.each(["Done", "Issue", "Blockers", "Notes"])("wants %s as bullets or (none)", (heading) => {
    expect(errorsOf(section(heading, "\n"))).toContain(`${heading} empty`);
    expect(errorsOf(section(heading, "prose"))).toContain(`${heading} bullets`);
    expect(errorsOf(section(heading, "- a\n(none)\n* b"))).toStrictEqual([]);
  });

  it("lets Log carry checked leaves and refuses them elsewhere", () => {
    expect(errorsOf(section("Log", "1.1 [x] a\n1.2.3 [ ] b\n- c"))).toStrictEqual([]);
    expect(errorsOf(section("Done", "1.1 [x] a"))).toContain("Done bullets");
    expect(errorsOf(section("Log", "1 [x] phase"))).toContain("Log bullets");
  });
});

describe("validateImplementation Files and status", () => {
  it("wants Files as repo-relative bullets", () => {
    expect(errorsOf(section("Files", "- a.ts\n\n(none)\n* b.ts"))).toStrictEqual([]);
    expect(errorsOf(section("Files", "\n"))).toContain("Files empty");
    expect(errorsOf(section("Files", "a.ts"))).toContain("Files bullets");
    expect(errorsOf(section("Files", "- /etc/x"))).toContain("Files abs");
    expect(errorsOf(section("Files", "- C:\\x"))).toContain("Files abs");
    expect(errorsOf(section("Files", "- .tmp/x"))).toContain("Files tmp");
    expect(errorsOf(section("Files", "- a/.tmp/x"))).toContain("Files tmp");
  });

  it("refuses blocked without a blocker", () => {
    const blocked = edit("status: in-progress", "status: blocked");
    expect(errorsOf(blocked)).toContain("blocked blockers");
    expect(errorsOf(blocked.replace("## Blockers\n(none)", "## Blockers\n- waiting"))).toStrictEqual([]);
    const noBlockers = errorsOf(blocked.replace(/## Blockers\n\(none\)\n\n/, ""));
    expect(noBlockers).toContain("heading order");
    expect(noBlockers).not.toContain("blocked blockers");
  });
});

describe("filesError", () => {
  it("names the first bad Files line and passes a clean list", () => {
    expect(filesError(undefined)).toBe("Files empty");
    expect(filesError("(none)")).toBe("");
    expect(filesError("- a.ts\n(none)\n- b.ts")).toBe("");
    expect(filesError("- a.ts\nb.ts\n- /abs")).toBe("Files bullets");
  });
});
