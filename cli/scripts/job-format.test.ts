import { expect, it } from "vitest";
import { useJobEnv } from "./fixtures/job-kit.ts";
import { formatFacts, squeezLines } from "./job.ts";

useJobEnv();

const numbered = (n: number, prefix = "l"): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

it("formatFacts says what a search or a command found, in the singular and the plural", () => {
  expect(formatFacts()).toBe("No output.\n");
  expect(formatFacts({ kind: "search", n: 0 })).toBe("No matches.\n");
  expect(formatFacts({ kind: "search", n: 1, facts: ["a"] })).toBe("1 match.\n- a\n");
  expect(formatFacts({ kind: "search", n: 2, facts: ["a", "b"] })).toBe("2 matches.\n- a\n- b\n");
  expect(formatFacts({ kind: "exec", n: 1, facts: ["a"] })).toBe("1 line.\n- a\n");
  expect(formatFacts({ kind: "exec", n: 2, facts: ["a", "b"] })).toBe("2 lines.\n- a\n- b\n");
});

it("formatFacts shows six facts and the stash when there is more than that", () => {
  const facts = numbered(9, "f");
  expect(formatFacts({ kind: "search", n: 9, facts, stash: "s.txt" })).toBe(
    "9 matches, 6 shown. stash=s.txt\n- f0\n- f1\n- f2\n- f3\n- f4\n- f5\n",
  );
  expect(formatFacts({ kind: "exec", n: 1, facts: ["a"], stash: "s.txt" })).toBe("1 line, 1 shown. stash=s.txt\n- a\n");
  expect(formatFacts({ kind: "search", n: 1, facts: ["a"], stash: "s", truncated: true })).toBe(
    "1+ match, 1 shown. stash=s\n- a\n",
  );
  expect(formatFacts({ kind: "exec", n: 20, facts: ["a"], stash: "s", truncated: true })).toBe(
    "20+ lines, 1 shown. stash=s\n- a\n",
  );
});

it("formatFacts reports a failure with at most three errors and names the stash", () => {
  expect(formatFacts({ failed: true })).toBe("Command failed.\n");
  expect(formatFacts({ kind: "search", failed: true })).toBe("Search failed.\n");
  expect(formatFacts({ kind: "exec", failed: true, errors: ["1", "2", "3", "4"] })).toBe(
    "Command failed.\n- 1\n- 2\n- 3\n",
  );
  expect(formatFacts({ kind: "exec", failed: true, errors: ["e"], stash: "s" })).toBe("Command failed. stash=s\n- e\n");
  expect(formatFacts({ kind: "search", failed: true, stash: "s" })).toBe("Search failed. stash=s\n");
});

it("squeezLines returns a short list whole and treats no list as empty", () => {
  expect(squeezLines(numbered(6), "x")).toEqual(numbered(6));
  expect(squeezLines(null, "x")).toEqual([]);
  expect(squeezLines(undefined, undefined)).toEqual([]);
  expect(squeezLines([1, 2], "")).toEqual(["1", "2"]);
});

it("squeezLines keeps the first and last lines and fills with the plain ones", () => {
  expect(squeezLines(numbered(10), "")).toEqual(["l0", "l1", "l2", "l3", "l4", "l9"]);
});

it("squeezLines drops pass lines first and falls back to them to fill the room", () => {
  const lines = ["start", ...numbered(4, "PASS "), "mid5", "mid6", "mid7", "mid8", "end"];
  expect(squeezLines(lines, "")).toEqual(["start", "mid5", "mid6", "mid7", "mid8", "end"]);
  const mostlyPass = ["start", ...numbered(6, "PASS "), "mid7", "PASS 8", "end"];
  expect(squeezLines(mostlyPass, "")).toEqual(["start", "PASS 0", "PASS 1", "PASS 2", "mid7", "end"]);
});

it("squeezLines ranks failures and stack frames above everything", () => {
  const lines = numbered(10);
  lines[3] = "ERROR boom";
  lines[4] = "    at x (y.js:1:1)";
  expect(squeezLines(lines, "")).toEqual(["l0", "l1", "l2", "ERROR boom", "    at x (y.js:1:1)", "l9"]);
});

it("squeezLines keeps only the first six when every line is a failure", () => {
  expect(squeezLines(numbered(10, "FAIL "), "")).toEqual(numbered(6, "FAIL "));
});

it("squeezLines does not add the first line twice when it already failed", () => {
  const lines = ["FAIL first", ...numbered(9)];
  expect(squeezLines(lines, "")).toEqual(["FAIL first", "l0", "l1", "l2", "l3", "l8"]);
});

it("squeezLines pulls in lines that match the query as a pattern", () => {
  const lines = [...numbered(5), "needle7 here", ...numbered(4, "m")];
  expect(squeezLines(lines, "needle\\d")).toEqual(["l0", "l1", "l2", "l3", "needle7 here", "m3"]);
});

it("squeezLines reads a query that is not a pattern as plain text", () => {
  const lines = [...numbered(7), "call(x)", "l8", "l9"];
  expect(squeezLines(lines, "(")).toEqual(["l0", "l1", "l2", "l3", "call(x)", "l9"]);
});

it("squeezLines gives a non-matching query no weight", () => {
  expect(squeezLines(numbered(10), "zzz")).toEqual(["l0", "l1", "l2", "l3", "l4", "l9"]);
});
