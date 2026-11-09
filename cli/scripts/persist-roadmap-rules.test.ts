import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DRAFT_ROADMAP } from "./fixtures/persist-bodies.ts";
import { persistRoadmap, validateRoadmap } from "./persist-roadmap.ts";

const tmpDirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpWs() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "persist-roadmap-rules-")));
  tmpDirs.push(dir);
  return dir;
}

const created = "2026-10-25T18:00:00Z";
const FILE = "1-auth-program-20261025T180000Z.md";

// A freshly saved roadmap as a validator input: mutate its text and read the errors back.
function saved() {
  const r = persistRoadmap({ workspaceRoot: tmpWs(), content: DRAFT_ROADMAP, created });
  if (!r.ok) throw new Error(r.error);
  return r.content;
}

function errorsFor(edit: (text: string) => string, opts?: Parameters<typeof validateRoadmap>[2]) {
  return validateRoadmap(FILE, edit(saved()), opts);
}

describe("validateRoadmap frontmatter rules", () => {
  it("accepts a saved roadmap with no options", () => {
    expect(validateRoadmap(FILE, saved())).toEqual([]);
  });

  it("denies a filename outside the pattern and a status outside the five", () => {
    expect(validateRoadmap("Auth.md", saved())).toContain("filename");
    expect(errorsFor((t) => t.replace("status: draft", "status: paused"))).toContain("status");
  });

  it("denies a frontmatter missing a key, and one that never closes", () => {
    expect(errorsFor((t) => t.replace(/^source: .*\n/m, ""))).toContain("frontmatter");
    expect(validateRoadmap(FILE, "---\nserial: 1\n# auth-program\n")).toContain("frontmatter");
  });

  it("denies a name that differs from the filename and a title that does", () => {
    const errors = errorsFor((t) =>
      t.replace("name: auth-program", "name: other").replace("# auth-program", "# other"),
    );
    expect(errors).toContain("name");
    expect(errors).toContain("h1");
  });

  it("denies an unclosed code fence before any section rule", () => {
    const errors = errorsFor((t) => `${t}\n\`\`\`\nnever closed\n`);
    expect(errors.some((e) => e.startsWith("unclosed code fence at line"))).toBe(true);
    expect(errors).not.toContain("heading order");
  });

  it("keeps a quoted frontmatter value that is not JSON and skips lines that are not keys", () => {
    const errors = errorsFor((t) => t.replace(/^source: .*$/m, 'Not a key\nsource: "bad \\q escape"'));
    expect(errors).toEqual([]);
  });
});

describe("validateRoadmap Verify rules", () => {
  it("denies a Verify with no leaf or with more than five", () => {
    expect(errorsFor((t) => t.replace("3.1 [ ] both slices are done\n", ""))).toContain("verify");
    const six = [1, 2, 3, 4, 5, 6].map((n) => `3.${n} [ ] check ${n}`).join("\n");
    expect(errorsFor((t) => t.replace("3.1 [ ] both slices are done", six))).toContain("verify");
  });

  it("denies a checked Verify box on a fresh save", () => {
    expect(errorsFor((t) => t.replace("3.1 [ ]", "3.1 [x]"), { fresh: true })).toContain("fresh [x]");
  });

  it("denies a roadmap with no Order", () => {
    expect(errorsFor((t) => t.replace(/## Order\n[\s\S]*?\n\n## Verify/, "## Verify"), { fresh: true })).toContain(
      "slices",
    );
  });
});

describe("validateRoadmap slice rules", () => {
  it("denies a slice line that is not 'title: sentence' and a stray line under it", () => {
    expect(errorsFor((t) => t.replace("auth types: Reserved", "auth types - Reserved"), { fresh: true })).toContain(
      'slice 1 needs "N [ ] {title, 2–6 words}: {one sentence}"',
    );
    const stray = "1 [ ] auth types: Reserved names list the new skills.\n      Because of reasons";
    expect(
      errorsFor((t) => t.replace("1 [ ] auth types: Reserved names list the new skills.", stray), { fresh: true }),
    ).toContain('slice 1 needs "N [ ] {title, 2–6 words}: {one sentence}"');
  });

  it("denies a second Location line under one slice", () => {
    const loc = "      Location: /abs/a.md\n      Location: /abs/b.md";
    const base = "1 [ ] auth types: Reserved names list the new skills.";
    expect(errorsFor((t) => t.replace(base, `${base}\n${loc}`), { fresh: true })).toContain(
      'slice 1 needs "N [ ] {title, 2–6 words}: {one sentence}"',
    );
  });
});
