import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VALID_HANDOFF } from "./fixtures/persist-bodies.ts";
import {
  extractH1,
  extractHandoffName,
  injectFrontmatter,
  persistHandoff,
  slugFromFilename,
  stripHandoffName,
  validateHandoff,
} from "./persist-handoff.ts";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "persist-handoff-v-"));
  tmpDirs.push(dir);
  return dir;
}

const saved = (() => {
  const r = persistHandoff({ workspaceRoot: tmpWs(), content: VALID_HANDOFF, created: "2026-08-27T14:30:00Z" });
  return { filename: r.filename ?? "", text: r.content ?? "" };
})();

/** The saved handoff with `from` replaced by `to`. */
const edit = (from: string, to: string) => {
  expect(saved.text).toContain(from);
  return saved.text.replace(from, to);
};
const errorsOf = (text: string, filename = saved.filename) => validateHandoff(filename, text);

describe("handoff name and title readers", () => {
  it("reads HANDOFF_NAME and strips its line", () => {
    expect(extractHandoffName("HANDOFF_NAME:  my  name \n# h")).toBe("my  name");
    expect(extractHandoffName("# h")).toBe("");
    expect(stripHandoffName("HANDOFF_NAME: x\n# h\n")).toBe("# h\n");
  });

  it("reads the first H1", () => {
    expect(extractH1("text\n# Title here  \n# two")).toBe("Title here");
    expect(extractH1("no heading")).toBe("");
  });

  it("takes the slug out of a stamped or bare filename", () => {
    expect(slugFromFilename("3-some-slug-20260827T143000Z.md")).toBe("some-slug");
    expect(slugFromFilename("3-some-slug.md")).toBe("some-slug");
  });
});

describe("injectFrontmatter", () => {
  it("replaces the H1 with the slug and drops a leading frontmatter block", () => {
    const out = injectFrontmatter({
      serial: 4,
      slug: "the-slug",
      source: "src",
      body: "---\nold: 1\n---\n\n# Other title\n\nrest\n",
      created: "2026-08-27T14:30:00Z",
    });
    expect(out).toBe(
      '---\nserial: 4\nname: the-slug\nstatus: open\ncreated: 2026-08-27T14:30:00Z\nsource: "src"\n---\n\n# the-slug\n\nrest\n',
    );
  });

  it("adds an H1 when the body has none and stamps now when no created is given", () => {
    const out = injectFrontmatter({ serial: 1, slug: "s", body: "\n\ntext" });
    expect(out).toMatch(
      /^---\nserial: 1\nname: s\nstatus: open\ncreated: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\nsource: ""\n---\n\n# s\n\ntext$/,
    );
  });

  it("keeps a frontmatter block that never closes as body text", () => {
    const out = injectFrontmatter({ serial: 1, slug: "s", body: "---\nopen: 1\n", created: "2026-08-27" });
    expect(out).toContain("# s\n\n---\nopen: 1\n");
  });
});

describe("validateHandoff frontmatter", () => {
  it("accepts a date-only created", () => {
    expect(errorsOf(edit("created: 2026-08-27T14:30:00Z", "created: 2026-08-27"))).toEqual([]);
  });

  it("reports a missing or unterminated frontmatter alone", () => {
    expect(errorsOf("# x\n")).toEqual(["missing frontmatter"]);
    expect(errorsOf("---\nserial: 1\n")).toEqual(["unterminated frontmatter"]);
  });

  it("reports each missing key", () => {
    const text = saved.text.replace(/^(name|status|created|source):.*\n/gm, "");
    expect(errorsOf(text)).toEqual(
      expect.arrayContaining(["missing name", "missing status", "missing created", "missing source"]),
    );
  });

  it("treats a key with no value as missing and skips lines that are not keys", () => {
    const errors = errorsOf(edit("status: open", "status:\nNot a key line\n  indented: no"));
    expect(errors).toContain("missing status");
    expect(errors).not.toContain("status");
  });

  it("reports a bad created, a long source and a name that differs from the filename", () => {
    expect(errorsOf(edit("created: 2026-08-27T14:30:00Z", "created: yesterday"))).toContain("created");
    expect(errorsOf(edit('source: "sync skills to hosts"', `source: "${"x".repeat(121)}"`))).toContain("source length");
    expect(errorsOf(edit("name: sync-skills-to-hosts", "name: other"))).toEqual(
      expect.arrayContaining(["name/filename slug", "h1 slug"]),
    );
  });
});

describe("validateHandoff quoted source", () => {
  it("reads a quoted source as JSON and falls back to the bare text when the quotes do not parse", () => {
    expect(errorsOf(edit('source: "sync skills to hosts"', 'source: "a \\"b\\" c"'))).toEqual([]);
    expect(errorsOf(edit('source: "sync skills to hosts"', 'source: "bad \\q escape"'))).toEqual([]);
    expect(errorsOf(edit('source: "sync skills to hosts"', 'source: "'))).toContain("missing source");
  });
});

describe("validateHandoff body", () => {
  it("returns the fence error with the earlier ones when a fence stays open", () => {
    const errors = errorsOf(edit("status: open", "status: bogus") + "\n```md\n");
    expect(errors).toContain("status");
    expect(errors.length).toBeGreaterThan(1);
    expect(errors).not.toContain("heading order");
  });

  it("rejects out-of-order headings", () => {
    const text = edit("## State\n", "## Context\n- c\n\n## State\n").replace("## Context\n- SSOT", "## Extra\n- SSOT");
    expect(errorsOf(text)).toContain("heading order");
  });
});

describe("validateHandoff sections", () => {
  it("wants one to three sentences in Goal", () => {
    expect(errorsOf(edit("Ship /handoff as a skill on every host. Claude links resolve to the source.", ""))).toContain(
      "goal",
    );
    expect(errorsOf(edit("Claude links resolve to the source.", "One. Two. Three."))).toContain("goal");
    expect(
      errorsOf(edit("Ship /handoff as a skill on every host. Claude links resolve to the source.", "No stop")),
    ).toEqual([]);
  });

  it("wants a missing Goal section flagged", () => {
    const text = saved.text.replace(/## Goal\n[^\n]*\n\n/, "");
    expect(errorsOf(text)).toEqual(expect.arrayContaining(["goal", "heading order"]));
  });

  it.each(["State", "Context", "Watch-outs"])("wants %s filled with bullets or (none)", (heading) => {
    const body = (section: string) =>
      saved.text.replace(new RegExp(`(## ${heading}\\n)[\\s\\S]*?(\\n## |$)`), `$1${section}$2`);
    expect(errorsOf(body("\n"))).toContain(`${heading} empty`);
    expect(errorsOf(body("prose only\n"))).toContain(`${heading} bullets`);
    expect(errorsOf(body("(none)\n"))).toEqual([]);
    expect(errorsOf(body("* starred\n"))).toEqual([]);
  });
});

describe("validateHandoff Next", () => {
  it("wants a leaf, and a leaf under every phase, in Next", () => {
    expect(
      errorsOf(edit("1.1 [ ] add -f skills to rulesync:generate\n1.2 [ ] add -f skills to rulesync:check\n", "")),
    ).toEqual(expect.arrayContaining(["no N.M leaf", "phase 1 leaf"]));
    expect(errorsOf(edit("1 [ ] wire generate", "1 [ ] wire generate\n2 [ ] second\nnot a box"))).toEqual([
      "phase 2 leaf",
    ]);
    expect(errorsOf(edit("1.1 [ ]", "  1.1.1 [ ]"))).toEqual([]);
  });
});
