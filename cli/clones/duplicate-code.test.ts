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

/** The diagnostic of the side at the top of `own`, whose 9 lines repeat the top 9 of `other`. */
function wholeFile(own: string, other: string) {
  return side(`${own}:1:1`, { lines: "1-9", other: `${other}:1-9` });
}

it("reports the first copy of three once per later copy, all at the same place", () => {
  // jscpd matches each later copy against the first one only, so b and c never pair.
  expect(clonesOf({ "src/a.ts": TOTAL, "src/b.ts": TOTAL, "src/c.ts": TOTAL })).toStrictEqual({
    ok: true,
    value: [
      wholeFile("src/a.ts", "src/b.ts"),
      wholeFile("src/a.ts", "src/c.ts"),
      wholeFile("src/b.ts", "src/a.ts"),
      wholeFile("src/c.ts", "src/a.ts"),
    ],
  });
});

it("finds no clone, and no failure, when every listed source is gone from the disk", () => {
  const root = plant({ "src/kept.ts": SPREAD });
  const scope = { files: ["src/gone.ts"], sources: ["src/gone.ts", "src/also-gone.ts"] };
  expect(duplicateDiagnostics(root, scope)).toStrictEqual({ ok: true, value: [] });
});

/** The problem line for a platform package `name` that is not installed. */
function missing(name: string): string {
  return (
    `jscpd has no binary for this platform (${name}); run \`bun install\` with optional dependencies ` +
    "on a platform jscpd ships one for"
  );
}

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

it("needs no binary when no JS or TS source outside a fixtures dir is left to scan", () => {
  const files = { "README.md": "# app\n", "src/a.reject.ts": TOTAL, "src/fixtures/a.ts": TOTAL };
  const scope = { files: Object.keys(files), sources: Object.keys(files) };
  expect(duplicateDiagnostics(plant(files), scope, { arch: "x64", platform: "freebsd" })).toStrictEqual({
    ok: true,
    value: [],
  });
});

it("looks for Windows' msvc package, and for both Linux libcs of an arch not installed", () => {
  const scope = { files: Object.keys(PAIR), sources: Object.keys(PAIR) };
  function at(platform: string) {
    return duplicateDiagnostics(plant(PAIR), scope, { arch: "riscv64", platform });
  }
  expect(at("win32")).toStrictEqual({ errors: [missing("jscpd-windows-riscv64-msvc")], ok: false });
  expect(at("linux")).toStrictEqual({
    errors: [missing("jscpd-linux-riscv64-gnu or jscpd-linux-riscv64-musl")],
    ok: false,
  });
});
