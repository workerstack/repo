import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VALID_LESSON } from "../scripts/fixtures/persist-bodies.ts";
import { index, lessons } from "./outputs.ts";
import { sectionBody } from "./maps.ts";
import { GOLDEN_INDEX, INDEX, context, copyFixtureWs, indexText } from "./fixtures/maps-kit.ts";
import { put, useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();

function withLesson(): string {
  const ws = copyFixtureWs();
  put(ws, "src/a.ts", "x\n");
  put(ws, ".repo/lessons/plan-forks.md", VALID_LESSON);
  return ws;
}

it("fills repo:skills and repo:refs and keeps the hand text around them byte for byte", () => {
  expect(indexText(copyFixtureWs())).toBe(fs.readFileSync(GOLDEN_INDEX, "utf8"));
});

it("is stable: the written index regenerates to itself", () => {
  const ws = copyFixtureWs();
  put(ws, INDEX, indexText(ws));
  expect(indexText(ws)).toBe(fs.readFileSync(path.join(ws, INDEX), "utf8"));
});

it("refs rows name the stock package path and skip INDEX.md", () => {
  const text = indexText(copyFixtureWs());
  expect(text).toContain("| node_modules/@workerstack/repo/references/alpha.md | Alpha |");
  expect(text).toContain("| node_modules/@workerstack/repo/references/nested/beta.md |");
  expect(text).not.toMatch(/references\/INDEX\.md \|/);
  expect(text).not.toMatch(/Body ignored|Beta body|More text ignored/);
});

it("creates the sections when INDEX.md is missing", () => {
  const ws = copyFixtureWs();
  fs.rmSync(path.join(ws, INDEX));
  const text = indexText(ws);
  expect(text).toMatch(/^<!-- repo:skills [\da-f]{8} -->$/m);
  expect(text).toMatch(/^<!-- repo:refs [\da-f]{8} -->$/m);
});

it("another package gets no skills or refs map", () => {
  const ws = copyFixtureWs();
  const result = index(context(ws, "consumer"));
  const output = result.outputs[0];
  expect(output?.kind === "file" && output.content).not.toContain("alpha-work");
});

it("includes extra refs next to the fixture refs", () => {
  const ws = copyFixtureWs();
  put(ws, "references/stripe.md", "---\ntags: [stripe]\n---\n# Stripe\n\nConsumer payments ref.\n");
  const text = indexText(ws);
  expect(text).toMatch(/references\/stripe\.md \| Stripe \| stripe \| Consumer payments ref/);
  expect(text).toMatch(/alpha\.md/);
});

it("writes the lessons index, tracked, from the lesson files", () => {
  const result = lessons(context(withLesson()));
  expect(result.errors).toStrictEqual([]);
  const content: unknown = expect.stringContaining(".repo/lessons/plan-forks.md");
  expect(result.outputs).toStrictEqual([
    { kind: "file", path: ".repo/lessons/INDEX.md", content, tracked: true, managed: "whole" },
  ]);
});

it("reports a lesson whose paths match nothing, and still writes the index", () => {
  const ws = withLesson();
  fs.rmSync(path.join(ws, "src"), { recursive: true });
  const result = lessons(context(ws));
  expect(result.errors).toStrictEqual([expect.stringMatching(/src\/\*\* matches no file/)]);
  expect(result.outputs).toHaveLength(1);
});

it("writes nothing in a repo without lessons", () => {
  expect(lessons(context(copyFixtureWs()))).toStrictEqual({ outputs: [], errors: [] });
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
