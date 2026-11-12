import { execFileSync } from "node:child_process";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { cleanTemps, git as gitIn, read, SLOW, tempDir, write } from "../scripts/__fixtures__/turn-repo.ts";
import { captureTool } from "../scripts/lint.ts";
import { BAD_CSS, cssKit, fakeRunner, FIXED_CSS, SHEETS, UNKNOWN_CSS } from "./__fixtures__/css-kit.ts";
import { cssDiagnostics, cssFiles } from "./css-diagnostics.ts";
import { stylelintRun } from "./stylelint-run.ts";

const saved = process.cwd();

afterEach(() => {
  process.chdir(saved);
  cleanTemps();
});

const HEX = "stylelint(color-hex-length)";
const ORDER = "stylelint(order/properties-order)";
const UNKNOWN = "stylelint(property-no-unknown)";

const EXPECTED = [
  {
    file: "src/bad.css",
    line: `src/bad.css:4:10: error ${HEX}: Expected "#ffffff" to be "#fff"`,
    rule: HEX,
  },
  {
    file: "src/bad.css",
    line: `src/bad.css:9:3: error ${ORDER}: Expected "display" to come before "color"`,
    rule: ORDER,
  },
  { file: "src/unknown.css", line: `src/unknown.css:2:3: error ${UNKNOWN}: Unknown property "colr"`, rule: UNKNOWN },
];

const ALL = Object.keys(SHEETS);

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

it(
  "reports each warning of the sheets as one line, none for a clean sheet or a fixtures dir",
  { timeout: SLOW },
  () => {
    expect(cssDiagnostics(cssKit(), ALL, { fix: false })).toStrictEqual({ ok: true, value: EXPECTED });
  },
);

it("runs no Stylelint and reports nothing for no CSS file", () => {
  const runner = fakeRunner({ code: 1, stderr: "never run\n", stdout: "" });
  const root = path.dirname(runner);
  expect(cssDiagnostics(root, ["src/a.ts", "__fixtures__/x.css"], { fix: false, runner })).toStrictEqual({
    ok: true,
    value: [],
  });
});

it("fixes the sheet clean, which oxfmt then leaves as it is", { timeout: SLOW }, () => {
  const root = cssKit({ "src/bad.css": BAD_CSS });
  expect(cssDiagnostics(root, ["src/bad.css"], { fix: true })).toStrictEqual({ ok: true, value: [] });
  expect(read(root, "src/bad.css")).toBe(FIXED_CSS);
  expect(captureTool("oxfmt", ["--check", "src/bad.css"], root).code).toBe(0);
});

it("returns a runner that fails as the problem line with its stderr's first line", () => {
  const runner = fakeRunner({ code: 1, stderr: "Error: no config\n    at load\n", stdout: "" });
  expect(cssDiagnostics(path.dirname(runner), ["src/a.css"], { fix: false, runner })).toStrictEqual({
    error: ["stylelint could not run: Error: no config"],
    ok: false,
  });
});

it("returns output that is not the results as a problem line", () => {
  const runner = fakeRunner({ code: 0, stderr: "", stdout: '{"results":1}' });
  const found = cssDiagnostics(path.dirname(runner), ["src/a.css"], { fix: false, runner });
  expect(found.ok ? [] : found.error.map((line) => line.split(":")[0])).toStrictEqual(["stylelint could not run"]);
});

it("returns output that is no json as a problem line with the parse error", () => {
  const runner = fakeRunner({ code: 0, stderr: "", stdout: "Done in 3 ms" });
  expect(cssDiagnostics(path.dirname(runner), ["src/a.css"], { fix: false, runner })).toStrictEqual({
    error: [expect.stringMatching(/^stylelint could not run: SyntaxError: /)],
    ok: false,
  });
});

it("returns each invalid option the config holds as a problem line, and no warning", () => {
  const warning = { column: 1, line: 1, rule: "color-named", severity: "error", text: "x (color-named)" };

  const results = [
    {
      invalid: [{ text: 'Invalid option value "sometimes" for rule "color-named"' }],
      source: "/r/a.css",
      warnings: [warning],
    },
    { invalid: [{ text: 'Invalid option name "max" for rule "order/order"' }], source: "/r/b.css", warnings: [] },
  ];

  const runner = fakeRunner({ code: 0, stderr: "", stdout: JSON.stringify(results) });
  expect(cssDiagnostics(path.dirname(runner), ["src/a.css", "src/b.css"], { fix: false, runner })).toStrictEqual({
    error: [
      'stylelint could not run: Invalid option value "sometimes" for rule "color-named"',
      'stylelint could not run: Invalid option name "max" for rule "order/order"',
    ],
    ok: false,
  });
});

it("still lints the kit with this repo's GIT_DIR and GIT_INDEX_FILE set, as in a git hook", { timeout: SLOW }, () => {
  const root = cssKit();
  const head = git("rev-parse", "HEAD");
  vi.stubEnv("GIT_DIR", path.resolve(git("rev-parse", "--git-dir")));
  vi.stubEnv("GIT_INDEX_FILE", path.resolve(git("rev-parse", "--git-path", "index")));
  expect(cssDiagnostics(root, ALL, { fix: false })).toStrictEqual({ ok: true, value: EXPECTED });
  vi.unstubAllEnvs();
  expect(git("rev-parse", "HEAD")).toBe(head);
});

it(
  "runs Stylelint in the cwd and gives each sheet's path, warnings and invalid options as json",
  { timeout: SLOW },
  async () => {
    const root = cssKit({ "src/unknown.css": UNKNOWN_CSS });
    process.chdir(root);
    const warning = { column: 3, line: 2, rule: "property-no-unknown", severity: "error" };
    expect(JSON.parse(await stylelintRun(["src/unknown.css"]))).toStrictEqual([
      {
        invalid: [],
        source: path.join(root, "src/unknown.css"),
        warnings: [{ ...warning, text: 'Unknown property "colr" (property-no-unknown)' }],
      },
    ]);
  },
);

it("cssFiles lists the sheets Stylelint lints, tracked or not, and reports a dir git cannot list", () => {
  const root = tempDir("workerstack-css-list-");
  gitIn(root, "init", "-q");
  write(root, { ".gitignore": "out/\n", "out/x.css": BAD_CSS, "src/a.ts": "export {};\n", ...SHEETS });
  gitIn(root, "add", "src/bad.css");
  expect(cssFiles(root)).toStrictEqual({ ok: true, value: ["src/app.css", "src/bad.css", "src/unknown.css"] });
  expect(cssFiles(tempDir("workerstack-css-nogit-"))).toStrictEqual({
    error: [expect.stringMatching(/^git ls-files failed: /)],
    ok: false,
  });
});

it("cssFiles never lists a sheet under a dependency dir, even before .gitignore ignores it", () => {
  const root = tempDir("workerstack-css-deps-");
  gitIn(root, "init", "-q");
  write(root, { "src/a.css": BAD_CSS, [["node", "_modules/pkg/x.css"].join("")]: BAD_CSS });
  expect(cssFiles(root)).toStrictEqual({ ok: true, value: ["src/a.css"] });
});
