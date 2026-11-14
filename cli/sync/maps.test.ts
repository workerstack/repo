import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { listedFiles } from "../docs-index.ts";
import { removeTree } from "../remove-tree.ts";
import { VALID_LESSON } from "../scripts/__fixtures__/persist-bodies.ts";
import { GOLDEN_INDEX, INDEX, context, copyFixtureWs, indexText } from "./__fixtures__/maps-kit.ts";
import { put, useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { sectionBody } from "./maps.ts";
import { index, lessons } from "./outputs.ts";

useTempDirs();

function withLesson(): string {
  const ws = copyFixtureWs();
  put(ws, "src/a.ts", "x\n");
  put(ws, ".repo/lessons/plan-forks.md", VALID_LESSON);

  return ws;
}

it("fills repo:refs and keeps the hand text around it byte for byte", () => {
  expect(indexText(copyFixtureWs())).toBe(fs.readFileSync(GOLDEN_INDEX, "utf8"));
});

it("is stable: the written index regenerates to itself", () => {
  const ws = copyFixtureWs();
  put(ws, INDEX, indexText(ws));
  expect(indexText(ws)).toBe(fs.readFileSync(path.join(ws, INDEX), "utf8"));
});

it("refs rows are a code span of the path under references/ and skip INDEX.md", () => {
  const text = indexText(copyFixtureWs());
  expect(text).toContain("- `alpha.md`: Alpha ref");
  expect(text).toContain("- `nested/beta.md`: Nested beta ref");
  expect(text).not.toContain("INDEX.md`");
  expect(text).not.toMatch(/Body ignored|Beta body|More text ignored/);
});

it("writes no skills section", () => {
  expect(indexText(copyFixtureWs())).not.toContain("repo:skills");
});

it("lists every ref of the new index", () => {
  const ws = copyFixtureWs();
  const text = indexText(ws);

  const found = listedFiles({ name: "@workerstack/repo", path: INDEX, text }, (rel) =>
    fs.existsSync(path.join(ws, rel)),
  );

  const listed = found.map((one) => one.path);
  expect(listed).toStrictEqual(["references/alpha.md", "references/nested/beta.md"]);
});

it("creates the section when INDEX.md is missing", () => {
  const ws = copyFixtureWs();
  fs.rmSync(path.join(ws, INDEX));
  expect(indexText(ws)).toMatch(/^<!-- repo:refs [\da-f]{8} -->$/m);
});

it("another package gets no refs map", () => {
  const ws = copyFixtureWs();
  const result = index(context(ws, "consumer"));
  const output = result.outputs[0];
  expect(output?.kind === "file" && output.content).not.toContain("alpha.md");
});

it("includes extra refs next to the fixture refs", () => {
  const ws = copyFixtureWs();
  put(ws, "references/stripe.md", "---\ndescription: Consumer payments\n---\n# Stripe\n");
  const text = indexText(ws);
  expect(text).toContain("- `stripe.md`: Consumer payments");
  expect(text).toMatch(/alpha\.md/);
});

it("reports every ref with no description as a sync error and writes nothing", () => {
  const ws = copyFixtureWs();
  put(ws, "references/x.md", "# X\n");
  put(ws, "references/y.md", "# Y\n");
  const result = index(context(ws));
  expect(result.errors).toStrictEqual([
    "references/x.md: description: missing or over 32 characters",
    "references/y.md: description: missing or over 32 characters",
  ]);
  expect(result.outputs).toStrictEqual([]);
});

it("writes the lessons index, tracked, from the lesson files", () => {
  const result = lessons(context(withLesson()));
  expect(result.errors).toStrictEqual([]);
  const content: unknown = expect.stringContaining("`plan-forks`");
  expect(result.outputs).toStrictEqual([
    { content, kind: "file", managed: "whole", path: ".repo/lessons/INDEX.md", tracked: true },
  ]);
});

it("reports a lesson whose paths match nothing, and still writes the index", () => {
  const ws = withLesson();
  removeTree(path.join(ws, "src"));
  const result = lessons(context(ws));
  expect(result.errors).toStrictEqual([expect.stringMatching(/src\/\*\* matches no file/)]);
  expect(result.outputs).toHaveLength(1);
});

it("writes nothing in a repo without lessons", () => {
  expect(lessons(context(copyFixtureWs()))).toStrictEqual({ errors: [], outputs: [] });
});

describe("sectionBody", () => {
  it("returns the trimmed lines between a marker pair", () => {
    expect(sectionBody("a\n<!-- repo:x -->  \none \r\ntwo\n<!-- /repo:x -->\nb", "x")).toStrictEqual(["one", "two"]);
  });

  it("reads a hashed pair as sync writes it, and an empty one as no lines", () => {
    expect(sectionBody("<!-- repo:x 1a2b3c4d -->\none\n<!-- /repo:x -->\n", "x")).toStrictEqual(["one"]);
    expect(sectionBody("<!-- repo:x e3b0c442 -->\n<!-- /repo:x -->\n", "x")).toStrictEqual([]);
  });

  it("is null when the pair is missing or unclosed", () => {
    expect(sectionBody("a\n", "x")).toBeNull();
    expect(sectionBody("<!-- repo:x -->\nrest", "x")).toBeNull();
    expect(sectionBody("<!-- /repo:x -->\n<!-- repo:x -->\n", "x")).toBeNull();
  });
});
