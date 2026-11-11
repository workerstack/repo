import { afterEach, expect, it } from "vitest";

import { cleanTemps, plant } from "../magic/fixtures/magic-repo.ts";
import { duplicateDiagnostics } from "./duplicate-code.ts";

afterEach(cleanTemps);

const RULE = "repo(duplicate-code)";
/** The 9-line function the clones share: 69 tokens as jscpd counts them. */
const TOTAL = [
  "export function total(items: readonly { price: number; count: number }[]): number {",
  "  let sum = 0;",
  "  for (const item of items) {",
  "    if (item.count > 0) {",
  "      sum += item.price * item.count;",
  "    }",
  "  }",
  "  return Math.round(sum * 100) / 100;",
  "}",
  "",
].join("\n");
const TOKENS = 69;
/** A 4-line function of far more than 50 tokens: too few lines to count as a clone. */
const SPREAD = [
  "export function spread(a: number, b: number, c: number, d: number): number[] {",
  "  const all = [a, b, c, d, a + b, b + c, c + d, d + a, a * b, c * d];",
  "  return all.filter((x) => x > 0).map((x) => x * 2).sort((x, y) => x - y);",
  "}",
  "",
].join("\n");
const PAIR = { "src/a.ts": TOTAL, "src/b.ts": `export const NAME = "b";\n\n${TOTAL}` };

/** The diagnostic of the clone side at `at` (`<file>:<line>:<column>`): `clone.lines` repeat `clone.other`. */
function side(at: string, clone: { lines: string; other: string; tokens?: number }) {
  const { lines, other, tokens = TOKENS } = clone;
  return {
    file: at.slice(0, at.indexOf(":")),
    line:
      `${at}: error ${RULE}: lines ${lines} repeat ${other} (${tokens} tokens); ` +
      "move the shared code into one function both call",
    rule: RULE,
  };
}

/** The duplicate diagnostics of planted `files`, every one of them scanned and `checked` (all, by default) reported. */
function clonesOf(files: Record<string, string>, checked: readonly string[] = Object.keys(files)) {
  return duplicateDiagnostics(plant(files), { files: checked, sources: Object.keys(files) });
}

it("reports each side of a clone in its own file, naming the other side", () => {
  expect(clonesOf(PAIR)).toStrictEqual({
    ok: true,
    value: [
      side("src/a.ts:1:1", { lines: "1-9", other: "src/b.ts:3-11" }),
      side("src/b.ts:3:1", { lines: "3-11", other: "src/a.ts:1-9" }),
    ],
  });
});

it("reports a clone with both sides in one file twice there, each naming the other", () => {
  const twice = `${TOTAL.replace("total", "totalA")}\n${TOTAL.replace("total", "totalB")}`;
  const found = clonesOf({ "src/c.ts": twice });
  // The names differ, so the clone starts at the parameter list: export, function and the name are not in it.
  const tokens = TOKENS - 3;
  expect(found).toStrictEqual({
    ok: true,
    value: [
      side("src/c.ts:1:23", { lines: "1-9", other: "src/c.ts:11-19", tokens }),
      side("src/c.ts:11:23", { lines: "11-19", other: "src/c.ts:1-9", tokens }),
    ],
  });
});

it("reports no copy under 5 lines, however many tokens it has", () => {
  expect(clonesOf({ "src/d.ts": SPREAD, "src/e.ts": SPREAD })).toStrictEqual({ ok: true, value: [] });
});

it("neither scans nor reports a file under a fixtures dir", () => {
  const files = { "src/a.ts": TOTAL, "src/fixtures/a.ts": TOTAL, "src/fixtures/b.ts": TOTAL };
  expect(clonesOf(files)).toStrictEqual({ ok: true, value: [] });
});

it("reports only the sides in the files checked, against every source scanned", () => {
  const files = { ...PAIR, "src/other.ts": SPREAD };
  expect(clonesOf(files, ["src/other.ts"])).toStrictEqual({ ok: true, value: [] });
  expect(clonesOf(files, ["src/b.ts"])).toStrictEqual({
    ok: true,
    value: [side("src/b.ts:3:1", { lines: "3-11", other: "src/a.ts:1-9" })],
  });
});

it("returns the missing binary of a platform jscpd ships none for as a problem line", () => {
  const scope = { files: Object.keys(PAIR), sources: Object.keys(PAIR) };
  expect(duplicateDiagnostics(plant(PAIR), scope, { arch: "x64", platform: "freebsd" })).toStrictEqual({
    errors: [
      "jscpd has no binary for this platform (jscpd-freebsd-x64); run `bun install` with optional dependencies " +
        "on a platform jscpd ships one for",
    ],
    ok: false,
  });
});
