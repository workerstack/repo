import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { knownFailureProblems } from "./known-failures.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A temp project holding `files` (path → content); the test files are those ending in `.test.ts`. */
function project(files: Record<string, string>): { root: string; tests: string[] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "known-failures-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return { root, tests: Object.keys(files).filter((rel) => rel.endsWith(".test.ts")) };
}

const list = (...entries: string[]) => JSON.stringify(entries);
const run = (files: Record<string, string>) => {
  const { root, tests } = project(files);
  return knownFailureProblems(root, tests);
};

describe("knownFailureProblems, the code against the list", () => {
  it("fails an it.fails that is not listed, at its line", () => {
    const problems = run({ "a.test.ts": 'import { it } from "vitest";\n\nit.fails("parses", () => {});\n' });
    expect(problems).toEqual(['a.test.ts:3: it.fails("parses") is not in known-failures.json; list it or fix it']);
  });

  it("fails test.fails and it.concurrent.fails the same way", () => {
    const problems = run({ "a.test.ts": 'test.fails("one", () => {});\nit.concurrent.fails("two", () => {});\n' });
    expect(problems).toEqual([
      'a.test.ts:1: test.fails("one") is not in known-failures.json; list it or fix it',
      'a.test.ts:2: it.concurrent.fails("two") is not in known-failures.json; list it or fix it',
    ]);
  });
});

describe("knownFailureProblems, matching the list", () => {
  it("passes cases the list names, nested describe titles joined", () => {
    const problems = run({
      "known-failures.json": list("a.test.ts > dates > utc > parses", "a.test.ts > top"),
      "a.test.ts":
        'describe("dates", () => { describe("utc", () => { it.fails("parses", () => {}); }); });\ntest.fails("top", () => {});\n',
    });
    expect(problems).toEqual([]);
  });

  it("fails a case whose describe path differs from the listed entry", () => {
    const problems = run({
      "known-failures.json": list("a.test.ts > parses"),
      "a.test.ts": 'describe("dates", () => { it.fails("parses", () => {}); });\n',
    });
    expect(problems).toEqual([
      'a.test.ts:1: it.fails("parses") is not in known-failures.json; list it or fix it',
      'known-failures.json lists "a.test.ts > parses", which has no it.fails; remove it from the list',
    ]);
  });

  it("fails a listed entry with no such case", () => {
    const problems = run({ "known-failures.json": list("a.test.ts > gone"), "a.test.ts": "export {};\n" });
    expect(problems).toEqual([
      'known-failures.json lists "a.test.ts > gone", which has no it.fails; remove it from the list',
    ]);
  });
});

describe("knownFailureProblems, titles and files", () => {
  it("fails a title that is not a literal on its own line, and still lists the others", () => {
    const problems = run({
      "known-failures.json": list("a.test.ts > fine"),
      "a.test.ts": 'const name = "x";\nit.fails("fine", () => {});\nit.fails(name, () => {});\n',
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^a\.test\.ts:3: it\.fails\(\) title is not a string literal/);
  });

  it("accepts a template title without placeholders", () => {
    const problems = run({
      "known-failures.json": list("a.test.ts > plain"),
      "a.test.ts": "it.fails(`plain`, () => {});\n",
    });
    expect(problems).toEqual([]);
  });
});

describe("knownFailureProblems, what it leaves alone", () => {
  it("ignores plain cases and .fails on other objects", () => {
    const problems = run({ "a.test.ts": 'it("ok", () => {});\nconst r = { fails: () => 1 };\nr.fails();\n' });
    expect(problems).toEqual([]);
  });

  it("passes with no list file and no .fails", () => {
    expect(run({ "a.test.ts": 'it("ok", () => {});\n' })).toEqual([]);
  });

  it("reads the list from the path it is given", () => {
    const { root, tests } = project({
      "lists/kf.json": list("a.test.ts > x"),
      "a.test.ts": 'it.fails("x", () => {});\n',
    });
    expect(knownFailureProblems(root, tests, "lists/kf.json")).toEqual([]);
  });
});

describe("knownFailureProblems, odd shapes", () => {
  it("names a template with a placeholder, a number title and a non-literal describe as non-literal", () => {
    const problems = run({
      "a.test.ts":
        'it.fails(`a ${1}`, () => {});\nit.fails(5, () => {});\ndescribe(name, () => { it.fails("x", () => {}); });\nit.fails();\n',
    });
    expect(problems.map((line) => line.slice(0, "a.test.ts:N".length))).toEqual([
      "a.test.ts:1",
      "a.test.ts:2",
      "a.test.ts:3",
      "a.test.ts:4",
    ]);
  });

  it("ignores callees that are no it or test chain", () => {
    const problems = run({
      "a.test.ts": 'it["fails"]("x", () => {});\nmake()("y");\nmake().fails("z");\nthis.fails("w");\nit.fails;\n',
    });
    expect(problems).toEqual([]);
  });

  it("reads an invalid list, a list that is no array and a missing test file as empty", () => {
    const bad = project({ "known-failures.json": "{", "a.test.ts": "export {};\n" });
    expect(knownFailureProblems(bad.root, bad.tests)).toEqual([]);
    const object = project({ "known-failures.json": "{}", "a.test.ts": "export {};\n" });
    expect(knownFailureProblems(object.root, [...object.tests, "gone.test.ts", "notes.md"])).toEqual([]);
  });
});
