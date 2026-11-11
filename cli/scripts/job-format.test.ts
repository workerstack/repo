import { expect, it } from "vitest";

import { useJobEnv } from "./fixtures/job-kit.ts";
import { formatFacts, isHtml, looksHtmlOrUnbounded, shouldFallback, squeezLines } from "./job-format.ts";
import { MAX_STDOUT } from "./job.constants.ts";

useJobEnv();

function numbered(n: number, prefix = "l"): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}

it("formatFacts says what a search or a command found, in the singular and the plural", () => {
  expect(formatFacts()).toBe("No output.\n");
  expect(formatFacts({ kind: "search", n: 0 })).toBe("No matches.\n");
  expect(formatFacts({ facts: ["a"], kind: "search", n: 1 })).toBe("1 match.\n- a\n");
  expect(formatFacts({ facts: ["a", "b"], kind: "search", n: 2 })).toBe("2 matches.\n- a\n- b\n");
  expect(formatFacts({ facts: ["a"], kind: "exec", n: 1 })).toBe("1 line.\n- a\n");
  expect(formatFacts({ facts: ["a", "b"], kind: "exec", n: 2 })).toBe("2 lines.\n- a\n- b\n");
});

it("formatFacts shows six facts and the stash when there is more than that", () => {
  const facts = numbered(9, "f");
  expect(formatFacts({ facts, kind: "search", n: 9, stash: "s.txt" })).toBe(
    "9 matches, 6 shown. stash=s.txt\n- f0\n- f1\n- f2\n- f3\n- f4\n- f5\n",
  );
  expect(formatFacts({ facts: ["a"], kind: "exec", n: 1, stash: "s.txt" })).toBe("1 line, 1 shown. stash=s.txt\n- a\n");
  expect(formatFacts({ facts: ["a"], kind: "search", n: 1, stash: "s", truncated: true })).toBe(
    "1+ match, 1 shown. stash=s\n- a\n",
  );
  expect(formatFacts({ facts: ["a"], kind: "exec", n: 20, stash: "s", truncated: true })).toBe(
    "20+ lines, 1 shown. stash=s\n- a\n",
  );
});

it("formatFacts reports a failure with at most three errors and names the stash", () => {
  expect(formatFacts({ failed: true })).toBe("Command failed.\n");
  expect(formatFacts({ failed: true, kind: "search" })).toBe("Search failed.\n");
  expect(formatFacts({ errors: ["1", "2", "3", "4"], failed: true, kind: "exec" })).toBe(
    "Command failed.\n- 1\n- 2\n- 3\n",
  );
  expect(formatFacts({ errors: ["e"], failed: true, kind: "exec", stash: "s" })).toBe("Command failed. stash=s\n- e\n");
  expect(formatFacts({ failed: true, kind: "search", stash: "s" })).toBe("Search failed. stash=s\n");
});

it("squeezLines returns a short list whole and treats no list as empty", () => {
  expect(squeezLines(numbered(6), "x")).toStrictEqual(numbered(6));
  expect(squeezLines(null, "x")).toStrictEqual([]);
  expect(squeezLines(undefined, undefined)).toStrictEqual([]);
  expect(squeezLines([1, 2], "")).toStrictEqual(["1", "2"]);
});

it("squeezLines keeps the first and last lines and fills with the plain ones", () => {
  expect(squeezLines(numbered(10), "")).toStrictEqual(["l0", "l1", "l2", "l3", "l4", "l9"]);
});

it("squeezLines drops pass lines first and falls back to them to fill the room", () => {
  const lines = ["start", ...numbered(4, "PASS "), "mid5", "mid6", "mid7", "mid8", "end"];
  expect(squeezLines(lines, "")).toStrictEqual(["start", "mid5", "mid6", "mid7", "mid8", "end"]);
  const mostlyPass = ["start", ...numbered(6, "PASS "), "mid7", "PASS 8", "end"];
  expect(squeezLines(mostlyPass, "")).toStrictEqual(["start", "PASS 0", "PASS 1", "PASS 2", "mid7", "end"]);
});

it("squeezLines ranks failures and stack frames above everything", () => {
  const lines = numbered(10);
  lines[3] = "ERROR boom";
  lines[4] = "    at x (y.js:1:1)";
  expect(squeezLines(lines, "")).toStrictEqual(["l0", "l1", "l2", "ERROR boom", "    at x (y.js:1:1)", "l9"]);
});

it("squeezLines keeps only the first six when every line is a failure", () => {
  expect(squeezLines(numbered(10, "FAIL "), "")).toStrictEqual(numbered(6, "FAIL "));
});

it("squeezLines does not add the first line twice when it already failed", () => {
  const lines = ["FAIL first", ...numbered(9)];
  expect(squeezLines(lines, "")).toStrictEqual(["FAIL first", "l0", "l1", "l2", "l3", "l8"]);
});

it("squeezLines pulls in lines that match the query as a pattern", () => {
  const lines = [...numbered(5), "needle7 here", ...numbered(4, "m")];
  expect(squeezLines(lines, "needle\\d")).toStrictEqual(["l0", "l1", "l2", "l3", "needle7 here", "m3"]);
});

it("squeezLines reads a query that is not a pattern as plain text", () => {
  const lines = [...numbered(7), "call(x)", "l8", "l9"];
  expect(squeezLines(lines, "(")).toStrictEqual(["l0", "l1", "l2", "l3", "call(x)", "l9"]);
});

it("squeezLines gives a non-matching query no weight", () => {
  expect(squeezLines(numbered(10), "zzz")).toStrictEqual(["l0", "l1", "l2", "l3", "l4", "l9"]);
});

it("shouldFallback lets bounded jobs through and refuses unknown jobs", () => {
  expect(shouldFallback("search", "gate-fat-tools")).toBe(false);
  expect(shouldFallback(" EXEC ", "echo hi")).toBe(false);
  expect(shouldFallback("web", "x")).toBe(true);
  expect(shouldFallback(undefined, "x")).toBe(true);
  expect(shouldFallback("exec", undefined)).toBe(true);
  expect(shouldFallback("search", "   ")).toBe(true);
});

it("shouldFallback needs a stash for slice and an http url for fetch", () => {
  expect(shouldFallback("slice", "", { stash: "g7k" })).toBe(false);
  expect(shouldFallback("slice", "", { stash: "  " })).toBe(true);
  expect(shouldFallback("slice", "")).toBe(true);
  expect(shouldFallback("fetch", " https://example.com/a")).toBe(false);
  expect(shouldFallback("fetch", "HTTP://example.com")).toBe(false);
  expect(shouldFallback("fetch", "ftp://example.com")).toBe(true);
  expect(shouldFallback("fetch", undefined)).toBe(true);
});

it("shouldFallback refuses downloads, html, lockfiles and .git", () => {
  const refused = [
    "curl x",
    "wget x",
    "echo <html>",
    "echo <!DOCTYPE html>",
    "cat bun.lock",
    "ls .git/hooks",
    "ls .git",
  ];
  for (const q of refused) expect(shouldFallback("exec", q), q).toBe(true);
  expect(shouldFallback("exec", "ls src\\.git\\x")).toBe(true);
  expect(shouldFallback("exec", "git status")).toBe(false);
  expect(shouldFallback("exec", "ls my.github")).toBe(false);
});

it("shouldFallback refuses the generated dirs as whole path segments only", () => {
  const dirs = ["node_modules", "dist", ".next", "build", "coverage"];
  for (const d of dirs) {
    expect(shouldFallback("exec", `ls ${d}`), d).toBe(true);
    expect(shouldFallback("exec", `ls ${d}/x`), d).toBe(true);
    expect(shouldFallback("exec", `ls a/${d}/x`), d).toBe(true);
    expect(shouldFallback("exec", `cat '${d}'`), d).toBe(true);
    expect(shouldFallback("exec", `ls ${d}er`), d).toBe(false);
    expect(shouldFallback("exec", `ls my${d}`), d).toBe(false);
  }
});

it("isHtml and looksHtmlOrUnbounded look at stdout and stderr together", () => {
  expect(isHtml("<HTML lang=en>", "")).toBe(true);
  expect(isHtml("", "<!DOCTYPE html>")).toBe(true);
  expect(isHtml("plain", undefined)).toBe(false);
  expect(looksHtmlOrUnbounded("x".repeat(MAX_STDOUT + 1), "")).toBe(true);
  expect(looksHtmlOrUnbounded("x".repeat(MAX_STDOUT), "")).toBe(false);
  expect(looksHtmlOrUnbounded("<html>", "")).toBe(true);
  expect(looksHtmlOrUnbounded(undefined, undefined)).toBe(false);
  expect(looksHtmlOrUnbounded("", "x".repeat(MAX_STDOUT + 1))).toBe(true);
});
