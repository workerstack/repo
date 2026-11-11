import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// vitest finds a mock call's importer by the text ` at Object.mock` in the stack; bun prints `at mock`, so a
// relative path silently mocks nothing under bun. An absolute path works, and so does a URL resolved against
// `import.meta.url`, which also handles `..`. One spelling per path: a bare package or `node:` specifier, or that URL.
// Patterns are spelled with escapes so this file's own text never matches them.
const MOCK_CALL = /\bvi\.(?:mock|doMock|unmock|doUnmock|importActual)\(\s*/g;
const SPECIFIER = /^["'](?:node:[\w/.-]+|@[\w.-]+\/[\w./-]+|[A-Za-z][\w.-]*(?:\/[\w./-]+)?)["']/;
const URL_FORM = /^new URL\(\s*["'](?:\.\.?\/)[^"']+["']\s*,\s*import\.meta\.url\s*\)\.href\b/;

/** `line` of every mock call in `text` whose first argument is not a bare/`node:` specifier or the URL form. */
function badMockPaths(text: string): number[] {
  const lines: number[] = [];
  for (const m of text.matchAll(MOCK_CALL)) {
    const rest = text.slice(m.index + m[0].length);
    if (!SPECIFIER.test(rest) && !URL_FORM.test(rest)) lines.push(text.slice(0, m.index).split("\n").length);
  }
  return lines;
}

const call = (name: string, arg: string) => `vi.${name}(${arg}, () => ({}));`;

describe("badMockPaths", () => {
  it.each([
    ['"./init.ts"'],
    ['"../cli/sync.ts"'],
    ["`./init.ts`"],
    ["`${import.meta.dirname}/init.ts`"],
    ['path.join(import.meta.dirname, "init.ts")'],
    ["somePath"],
    ['new URL("./init.ts", import.meta.url).pathname'],
    ['new URL("init.ts", import.meta.url).href'],
  ])("flags %s", (arg) => {
    for (const name of ["mock", "doMock", "unmock", "doUnmock", "importActual"]) {
      expect(badMockPaths(call(name, arg))).toStrictEqual([1]);
    }
  });

  it.each([
    ['"node:fs"'],
    ['"zod"'],
    ['"@clack/prompts"'],
    ['"vitest/config"'],
    ['new URL("../cli/sync.ts", import.meta.url).href'],
    ['new URL("./init.ts", import.meta.url).href'],
  ])("accepts %s", (arg) => {
    expect(badMockPaths(call("mock", arg))).toStrictEqual([]);
  });

  it("names the line", () => {
    expect(badMockPaths(`a\nb\n${call("mock", '"./x.ts"')}`)).toStrictEqual([3]);
  });
});

it("no tracked test spells a mock path another way", () => {
  const root = path.join(import.meta.dirname, "..");
  const files = execFileSync("git", ["ls-files", "*.test.ts"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const hits = files.flatMap((file) =>
    badMockPaths(fs.readFileSync(path.join(root, file), "utf8")).map((line) => `${file}:${line}`),
  );
  expect(hits).toStrictEqual([]);
});
