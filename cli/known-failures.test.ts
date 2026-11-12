import { describe, expect, it } from "vitest";

import { useTempTree } from "./__fixtures__/temp-tree.ts";
import { knownFailures } from "./known-failures.ts";

const tempTree = useTempTree("known-failures-");

/** A temp project holding `files` (path → content); the test files are those ending in `.test.ts`. */
function project(files: Record<string, string>): { root: string; tests: string[] } {
  const root = tempTree(files);

  return { root, tests: Object.keys(files).filter((rel) => rel.endsWith(".test.ts")) };
}

function list(...entries: string[]) {
  return JSON.stringify(entries);
}

function run(files: Record<string, string>) {
  const { root, tests } = project(files);

  return knownFailures(root, tests);
}

describe("knownFailures, the code against the list", () => {
  it("fails an it.fails that is not listed, at its line", () => {
    const problems = run({ "a.test.ts": 'import { it } from "vitest";\n\nit.fails("parses", () => {});\n' });
    expect(problems).toStrictEqual([
      'a.test.ts:3: it.fails("parses") is not in known-failures.json; list it or fix it',
    ]);
  });

  it("fails test.fails and it.concurrent.fails the same way", () => {
    const problems = run({ "a.test.ts": 'test.fails("one", () => {});\nit.concurrent.fails("two", () => {});\n' });
    expect(problems).toStrictEqual([
      'a.test.ts:1: test.fails("one") is not in known-failures.json; list it or fix it',
      'a.test.ts:2: it.concurrent.fails("two") is not in known-failures.json; list it or fix it',
    ]);
  });
});

describe("knownFailures, matching the list", () => {
  it("passes cases the list names, nested describe titles joined", () => {
    const problems = run({
      "a.test.ts":
        'describe("dates", () => { describe("utc", () => { it.fails("parses", () => {}); }); });\n' +
        'test.fails("top", () => {});\n',
      "known-failures.json": list("a.test.ts > dates > utc > parses", "a.test.ts > top"),
    });

    expect(problems).toStrictEqual([]);
  });

  it("fails a case whose describe path differs from the listed entry", () => {
    const problems = run({
      "a.test.ts": 'describe("dates", () => { it.fails("parses", () => {}); });\n',
      "known-failures.json": list("a.test.ts > parses"),
    });

    expect(problems).toStrictEqual([
      'a.test.ts:1: it.fails("parses") is not in known-failures.json; list it or fix it',
      'known-failures.json lists "a.test.ts > parses", which has no it.fails; remove it from the list',
    ]);
  });

  it("fails a listed entry with no such case", () => {
    const problems = run({ "a.test.ts": "export {};\n", "known-failures.json": list("a.test.ts > gone") });
    expect(problems).toStrictEqual([
      'known-failures.json lists "a.test.ts > gone", which has no it.fails; remove it from the list',
    ]);
  });
});

describe("knownFailures, titles and files", () => {
  it("fails a title that is not a literal on its own line, and still lists the others", () => {
    const problems = run({
      "a.test.ts": 'const name = "x";\nit.fails("fine", () => {});\nit.fails(name, () => {});\n',
      "known-failures.json": list("a.test.ts > fine"),
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^a\.test\.ts:3: it\.fails\(\) title is not a string literal/);
  });

  it("accepts a template title without placeholders", () => {
    const problems = run({
      "a.test.ts": "it.fails(`plain`, () => {});\n",
      "known-failures.json": list("a.test.ts > plain"),
    });

    expect(problems).toStrictEqual([]);
  });

  it("reads a literal title from the call's arguments and a bare template's text from its quasis", () => {
    const problems = run({ "a.test.ts": 'describe("dates", () => { it.fails(`plain`, () => {}); });\n' });

    expect(problems).toStrictEqual(['a.test.ts:1: it.fails("plain") is not in known-failures.json; list it or fix it']);
    const listed = list("a.test.ts > dates > plain");
    const source = 'describe("dates", () => { it.fails(`plain`, () => {}); });\n';
    expect(run({ "a.test.ts": source, "known-failures.json": listed })).toStrictEqual([]);
  });
});

describe("knownFailures, what it leaves alone", () => {
  it("ignores plain cases and .fails on other objects", () => {
    const problems = run({ "a.test.ts": 'it("ok", () => {});\nconst r = { fails: () => 1 };\nr.fails();\n' });
    expect(problems).toStrictEqual([]);
  });

  it("passes with no list file and no .fails", () => {
    expect(run({ "a.test.ts": 'it("ok", () => {});\n' })).toStrictEqual([]);
  });

  it("reads the list from the path it is given", () => {
    const { root, tests } = project({
      "a.test.ts": 'it.fails("x", () => {});\n',
      "lists/kf.json": list("a.test.ts > x"),
    });

    expect(knownFailures(root, tests, "lists/kf.json")).toStrictEqual([]);
  });
});

describe("knownFailures, odd shapes", () => {
  it("names a template with a placeholder, a number title and a non-literal describe as non-literal", () => {
    const problems = run({
      "a.test.ts":
        "it.fails(`a ${1}`, () => {});\nit.fails(5, () => {});\n" +
        'describe(name, () => { it.fails("x", () => {}); });\nit.fails();\n',
    });

    expect(problems.map((line) => line.slice(0, "a.test.ts:N".length))).toStrictEqual([
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

    expect(problems).toStrictEqual([]);
  });

  it("reads an invalid list, a list that is no array and a missing test file as empty", () => {
    const bad = project({ "a.test.ts": "export {};\n", "known-failures.json": "{" });
    expect(knownFailures(bad.root, bad.tests)).toStrictEqual([]);
    const object = project({ "a.test.ts": "export {};\n", "known-failures.json": "{}" });
    expect(knownFailures(object.root, [...object.tests, "gone.test.ts", "notes.md"])).toStrictEqual([]);
  });
});
