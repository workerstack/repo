import { afterEach, expect, it, vi } from "vitest";

import { checkScriptsAt } from "../script-diagnostics.ts";
import { skipIn, spies } from "../scripts/fixtures/lint-scripts-kit.ts";
import { cleanTemps, git, read, SLOW, staged, turn, write } from "../scripts/fixtures/turn-repo.ts";
import { checkLintBaseline } from "../scripts/lint-baseline.ts";
import { lintMain } from "../scripts/lint-main.ts";
import { checkLintSkipsAt } from "../scripts/lint-skips.ts";
import { APP_CSS, BAD_CSS, cssKit, FIXED_CSS, UNKNOWN_CSS } from "./fixtures/css-kit.ts";

const saved = process.cwd();
afterEach(() => {
  process.chdir(saved);
  vi.restoreAllMocks();
  cleanTemps();
});

const HEX_LINE = 'src/bad.css:4:10: error stylelint(color-hex-length): Expected "#ffffff" to be "#fff"';
const ORDER_LINE =
  'src/bad.css:9:3: error stylelint(order/properties-order): Expected "display" to come before "color"';
const UNKNOWN_LINE = 'src/unknown.css:2:3: error stylelint(property-no-unknown): Unknown property "colr"';
function lines(texts: string[]): string[] {
  return texts.map((text) => text.trimEnd());
}

/** What `repo check` says of the baseline in `root`, given the script hits no skip turns off. */
async function baselineLines(root: string): Promise<string[]> {
  const scripts = await checkScriptsAt(root);
  return checkLintBaseline(root, scripts.kept);
}

it(
  "repo lint prints the Stylelint lines and fails, of the whole checkout or CSS paths only",
  { timeout: SLOW },
  async () => {
    const root = cssKit();
    const io = spies();
    process.chdir(root);
    expect(await lintMain([])).toBe(1);
    expect(lines(io.stdout())).toStrictEqual([HEX_LINE, ORDER_LINE, UNKNOWN_LINE]);
    io.clear();
    expect(await lintMain(["src/bad.css"])).toBe(1);
    expect(lines(io.stdout())).toStrictEqual([HEX_LINE, ORDER_LINE]);
    io.clear();
    // oxlint, handed a CSS path only, exits 1 on finding no file; it is not run.
    expect(await lintMain(["src/app.css"])).toBe(0);
    expect(io.stdout()).toStrictEqual([]);
  },
);

it("repo check fails on the Stylelint hits until lint --baseline counts them", { timeout: SLOW }, async () => {
  const root = cssKit();
  spies();
  process.chdir(root);
  expect(await baselineLines(root)).toStrictEqual([
    ".repo/lint-baseline.json: src/bad.css has 1 stylelint(color-hex-length), the baseline allows 0",
    ".repo/lint-baseline.json: src/bad.css has 1 stylelint(order/properties-order), the baseline allows 0",
    ".repo/lint-baseline.json: src/unknown.css has 1 stylelint(property-no-unknown), the baseline allows 0",
  ]);
  expect(await lintMain(["--baseline"])).toBe(0);
  expect(await baselineLines(root)).toStrictEqual([]);
});

it("a lint.skip of a Stylelint rule drops its line, and check reports the skip's hit", { timeout: SLOW }, async () => {
  const root = cssKit();
  skipIn(root, "src/unknown.css", "stylelint/property-no-unknown");
  const io = spies();
  process.chdir(root);
  expect(await lintMain([])).toBe(1);
  expect(lines(io.stdout())).toStrictEqual([HEX_LINE, ORDER_LINE]);
  const scripts = await checkScriptsAt(root);
  expect(await checkLintSkipsAt(root, scripts.all)).toStrictEqual({
    problems: [],
    report: [
      "skip stylelint/property-no-unknown in src/unknown.css: 1 hit (kept on purpose)",
      "skips: stylelint/property-no-unknown 1",
    ],
  });
});

it("repo turn --staged fixes and restages a sheet, then fails on a hit no fix removes", { timeout: SLOW }, async () => {
  const root = cssKit({ "src/app.css": APP_CSS });
  write(root, { "src/bad.css": BAD_CSS });
  git(root, "add", "src/bad.css");
  const fixed = await turn(root, ["--staged"]);
  expect(fixed.out).toMatch(/^turn: 1 file · fmt ok · comments ok · lint ok · /);
  expect(fixed.code).toBe(0);
  expect(read(root, "src/bad.css")).toBe(FIXED_CSS);
  expect(git(root, "show", ":src/bad.css")).toBe(FIXED_CSS);
  expect(staged(root)).toStrictEqual(["src/bad.css"]);
  write(root, { "src/unknown.css": UNKNOWN_CSS });
  git(root, "add", "src/unknown.css");
  const left = await turn(root, ["--staged"]);
  expect(left.err).toContain(`${UNKNOWN_LINE}\n`);
  expect(left.err).toContain(
    "repo turn: src/unknown.css has 1 stylelint(property-no-unknown), the baseline allows 0; fix the new one\n",
  );
  expect(left.code).toBe(1);
});
