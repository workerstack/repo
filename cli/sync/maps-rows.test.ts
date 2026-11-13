import { expect, it } from "vitest";

import { selfWs } from "./__fixtures__/maps-kit.ts";
import { put, tempDir, useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { refsSection } from "./maps.ts";

useTempDirs();

function rows(ws: string): string[] {
  const { body, errors } = refsSection(ws);
  expect(errors).toStrictEqual([]);

  return body.split("\n");
}

it("is one row per ref: its path under references/ in a code span and its description", () => {
  const ws = selfWs("maps-rows-");
  put(ws, "references/b.md", "---\ndescription: Second ref\n---\n# B\n");
  put(ws, "references/a.md", "---\ndescription: First ref\n---\n# A\n");
  put(ws, "references/nested/c.md", "---\ndescription: Nested ref\n---\n# C\n");
  expect(rows(ws)).toStrictEqual(["- `a.md`: First ref", "- `b.md`: Second ref", "- `nested/c.md`: Nested ref"]);
});

it("skips INDEX.md, dotfiles, dot folders and non-markdown", () => {
  const ws = selfWs("maps-skip-");
  put(ws, "references/INDEX.md", "# Index\n");
  put(ws, "references/.hidden.md", "# Hidden\n");
  put(ws, "references/notes.txt", "x");
  put(ws, "references/.dir/skipped.md", "# Skipped\n");
  put(ws, "references/ok.md", "---\ndescription: Fine\n---\n");
  expect(rows(ws)).toStrictEqual(["- `ok.md`: Fine"]);
});

it("is empty for a repo with no references", () => {
  expect(refsSection(tempDir("maps-empty-"))).toStrictEqual({ body: "", errors: [] });
});

it("reads quoted and folded descriptions as one line", () => {
  const ws = selfWs("maps-forms-");
  put(ws, "references/q.md", '---\ndescription: "Quoted: yes"\n---\n');
  put(ws, "references/f.md", "---\ndescription: >-\n  Folded\n  words\n---\n");
  expect(rows(ws)).toStrictEqual(["- `f.md`: Folded words", "- `q.md`: Quoted: yes"]);
});

it("accepts a description of exactly 32 characters", () => {
  const ws = selfWs("maps-cap-");
  const desc = "x".repeat(32);
  put(ws, "references/x.md", `---\ndescription: ${desc}\n---\n`);
  expect(rows(ws)).toStrictEqual([`- \`x.md\`: ${desc}`]);
});

it.each([
  ["no frontmatter", "# X\n"],
  ["no description", "---\ntags: [a]\n---\n# X\n"],
  ["an empty description", '---\ndescription: ""\n---\n'],
  ["a description over 32 characters", `---\ndescription: ${"x".repeat(33)}\n---\n`],
  ["a description that is not a string", "---\ndescription: [a, b]\n---\n"],
  ["frontmatter YAML cannot parse", "---\ndescription: one: two\n---\n"],
  ["a multi-line description", "---\ndescription: |\n  one\n  two\n---\n"],
])("fails a ref with %s", (_name, text) => {
  const ws = selfWs("maps-bad-");
  put(ws, "references/x.md", text);
  expect(refsSection(ws).errors).toStrictEqual(["references/x.md: description: missing or over 32 characters"]);
});

it("names a nested ref by its path from the repo root in the error", () => {
  const ws = selfWs("maps-bad-nested-");
  put(ws, "references/n/x.md", "# X\n");
  expect(refsSection(ws).errors).toStrictEqual(["references/n/x.md: description: missing or over 32 characters"]);
});

it("names every bad ref, in path order, and keeps the good rows", () => {
  const ws = selfWs("maps-bad-many-");
  put(ws, "references/b.md", "# B\n");
  put(ws, "references/a.md", `---\ndescription: ${"x".repeat(33)}\n---\n`);
  put(ws, "references/ok.md", "---\ndescription: Fine\n---\n");
  expect(refsSection(ws)).toStrictEqual({
    body: "- `ok.md`: Fine",
    errors: [
      "references/a.md: description: missing or over 32 characters",
      "references/b.md: description: missing or over 32 characters",
    ],
  });
});
