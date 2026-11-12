import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { todoNeedsId } from "./todo-needs-id.ts";

const LESSONS = {
  ".repo/lessons/bun-name-runs-local-file.md": "# a lesson\n",
  "packages/web/.repo/lessons/web-only.md": "# a package lesson\n",
};

function needs(word: string) {
  return `${word} needs an issue or lesson ID: ${word}(#123), ${word}(ABC-123) or ${word}(<lesson slug>)`;
}

function noLesson(slug: string, dir = ".repo/lessons") {
  return `"${slug}" names no lesson: add ${dir}/${slug}.md, or use an issue ID like TODO(#123)`;
}

function messagesOf(code: string, file = "src/a.ts") {
  return reportsOf(todoNeedsId, { ...LESSONS, [file]: code }).map((report) => report.message);
}

describe("todo-needs-id passes", () => {
  it.each([
    "// TODO(#12): drop this once the API ships\nexport const a = 1;",
    "// FIXME(ABC-123) wrong on leap years\nexport const a = 1;",
    "// TODO(https://github.com/workerstack/repo/issues/4) retry\nexport const a = 1;",
    "// TODO(bun-name-runs-local-file): call bun repo\nexport const a = 1;",
    "/* TODO(#7) */ export const a = 1;",
    "/**\n * Reads the file.\n * TODO(#7): stream it\n */\nexport const a = 1;",
    "// a list of TODO items lives in the tracker\nexport const a = 1;",
    "// Prose that ends with TODO\nexport const a = 1;",
    "// TODOS are fine as a word\nexport const a = 1;",
    "// todo: lowercase is prose\nexport const a = 1;",
    'export const word = "TODO fix";',
  ])("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it("reads the nearest lessons dir above the file", () => {
    expect(messagesOf("// TODO(web-only): x\nexport const a = 1;", "packages/web/src/a.ts")).toStrictEqual([]);
  });
});

describe("todo-needs-id fails", () => {
  it.each([
    ["// TODO fix\nexport const a = 1;", "TODO"],
    ["// TODO: fix\nexport const a = 1;", "TODO"],
    ["//TODO fix\nexport const a = 1;", "TODO"],
    ["// FIXME leap years\nexport const a = 1;", "FIXME"],
    ["// TODO() fix\nexport const a = 1;", "TODO"],
    ["// TODO(John Smith) fix\nexport const a = 1;", "TODO"],
    ["// TODO (#12) fix\nexport const a = 1;", "TODO"],
    ["// TODO(#) fix\nexport const a = 1;", "TODO"],
    ["/* TODO fix */ export const a = 1;", "TODO"],
    ["/** TODO fix */ export const a = 1;", "TODO"],
    ["/**\n * Reads the file.\n * FIXME stream it\n */\nexport const a = 1;", "FIXME"],
  ])("fails %j", (code, word) => {
    expect(messagesOf(code)).toStrictEqual([needs(word)]);
  });

  it("fails a slug that names no lesson file, and one from a lessons dir that is not the nearest", () => {
    expect(messagesOf("// TODO(no-such-lesson): x\nexport const a = 1;")).toStrictEqual([noLesson("no-such-lesson")]);
    expect(messagesOf("// TODO(bun-name-runs-local-file): x", "packages/web/src/a.ts")).toStrictEqual([
      noLesson("bun-name-runs-local-file", "packages/web/.repo/lessons"),
    ]);
  });

  it("fails a slug when no lessons dir is above the file, and each marker line of a comment", () => {
    expect(reportsOf(todoNeedsId, { "a.ts": "// TODO(some-lesson): x" }).map((r) => r.message)).toStrictEqual([
      noLesson("some-lesson"),
    ]);
    expect(messagesOf("/*\n TODO one\n FIXME two\n*/")).toStrictEqual([needs("TODO"), needs("FIXME")]);
  });
});
