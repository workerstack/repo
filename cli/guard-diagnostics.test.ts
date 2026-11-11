import { afterEach, expect, it } from "vitest";
import { guardDiagnostics } from "./guard-diagnostics.ts";
import { cleanTemps, plant, SLOW } from "./magic/fixtures/magic-repo.ts";
import { cleanTemps as cleanRepos, consumer, SLOW as TURN, turn, write } from "./scripts/fixtures/turn-repo.ts";
import type { Diagnostic } from "./scripts/lint-baseline.ts";

afterEach(() => {
  cleanTemps();
  cleanRepos();
});

const RULE = "repo(guard-rejects)";
const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, module: "preserve", moduleResolution: "bundler", allowImportingTsExtensions: true },
  include: ["src"],
});
const USER = [
  "export type User = { name: string };",
  "",
  "export function isUser(value: unknown): value is User {",
  '  return typeof value === "object" && value !== null && "name" in value;',
  "}",
  "",
  'export const isName = (value: unknown): value is string => typeof value === "string";',
  "",
].join("\n");

/** A guard no test imports. */
const OTHER = 'export const isOther = (value: unknown): value is number => typeof value === "number";\n';

/** The diagnostic for an untested guard `name` at `at`, `<file>:<line>:<column>`. */
const untested = (at: string, name: string): Diagnostic => ({
  file: at.slice(0, at.indexOf(":")),
  rule: RULE,
  line: `${at}: error ${RULE}: ${name} is never asserted false; add expect(${name}(<an input it must reject>)).toBe(false) to a test`,
});

const VITEST = 'import { expect, it } from "vitest";\n';
/** Typed stand-ins for vitest's globals, so the unsafe-any rules see no error-typed call. */
const VITEST_GLOBALS = [
  "declare const expect: (value: unknown) => { toBe: (expected: unknown) => void };",
  "declare const it: (name: string, run: () => void) => void;",
  "",
].join("\n");

/** A test file over `src/user.ts` with `imports` and `body` in one `it`. */
const test = (imports: string, body: string): string => `${VITEST}${imports}\n\nit("guards", () => {\n${body}\n});\n`;

/** The guard hits of `files` planted beside a tsconfig.json, checking `checked` (all of them by default). */
function guardsOf(files: Record<string, string>, checked: readonly string[] = Object.keys(files)): Diagnostic[] {
  const found = guardDiagnostics(plant({ "tsconfig.json": TSCONFIG, ...files }), checked);
  if (!found.ok) throw new Error(found.errors.join("\n"));
  return found.value;
}

it("reports each exported guard no test asserts false, a true-only test included", { timeout: SLOW }, () => {
  const inferred = [
    'export const isCount = (value: unknown) => typeof value === "number";',
    'export const isWord = function (value: unknown): value is string { return typeof value === "string"; };',
    "",
  ].join("\n");
  const only = test(
    'import { isUser, isName } from "./user.ts";',
    '  expect(isUser({ name: "a" })).toBe(true);\n  expect(isName("a")).toBeTruthy();',
  );
  expect(guardsOf({ "src/user.ts": `${USER}${inferred}`, "src/user.test.ts": only })).toEqual([
    untested("src/user.ts:3:17", "isUser"),
    untested("src/user.ts:7:14", "isName"),
    untested("src/user.ts:8:14", "isCount"),
    untested("src/user.ts:9:14", "isWord"),
  ]);
});

it.each(["toBe(false)", "toBeFalsy()", "toEqual(false)"])("passes a guard asserted .%s", { timeout: SLOW }, (form) => {
  const body = `  expect(isUser(1)).${form};\n  expect(isName(1)).${form};`;
  const files = { "src/user.ts": USER, "src/user.test.ts": test('import { isUser, isName } from "./user.ts";', body) };
  expect(guardsOf(files)).toEqual([]);
});

it("follows a renamed import and a namespace import to the guard", { timeout: SLOW }, () => {
  const renamed = test(
    'import { isUser as looksLikeUser } from "./user.ts";',
    "  expect(looksLikeUser(1)).toBe(false);",
  );
  const namespace = test('import * as user from "./user.ts";', "  expect(user.isName(1)).toBeFalsy();");
  const files = { "src/user.ts": USER, "src/a.test.ts": renamed, "src/b.test.ts": namespace };
  expect(guardsOf(files, ["src/user.ts"])).toEqual([]);
});

it("counts only a guard called as the argument of expect(…) itself", { timeout: SLOW }, () => {
  const body = [
    "  const rejected = isUser(1);",
    "  expect(rejected).toBe(false);",
    "  expect.soft(isUser(1)).toBe(false);",
    "  check(isUser(1)).toBe(false);",
    "  expect().toBe(false);",
    "  rejected.toBe(false);",
    "  expect(isUser(1)).toBe(false, 1);",
    "  expect(isName(1)).toBe(false);",
  ].join("\n");
  const files = { "src/user.ts": USER, "src/user.test.ts": test('import { isUser, isName } from "./user.ts";', body) };
  expect(guardsOf(files)).toEqual([untested("src/user.ts:3:17", "isUser")]);
});

it(
  "skips a guard that is not exported or has no name of its own, an assertion function and a plain boolean function",
  { timeout: SLOW },
  () => {
    const source = [
      "function isText(value: unknown): value is string {",
      '  return typeof value === "string";',
      "}",
      "",
      "export function assertText(value: unknown): asserts value is string {",
      '  if (!isText(value)) throw new Error("not text");',
      "}",
      "",
      "export const isEmpty = (text: string): boolean => text.length === 0;",
      'const isLocal = (value: unknown): value is string => typeof value === "string";',
      "export const local = isLocal;",
      'export const { length } = "abc";',
      "export let pending: ((value: unknown) => value is string) | undefined;",
      "export default function (value: unknown): value is number {",
      '  return typeof value === "number";',
      "}",
      "",
    ].join("\n");
    expect(guardsOf({ "src/text.ts": source })).toEqual([]);
  },
);

it("re-checks the guards of the sources a changed test imports, when only the test changed", { timeout: SLOW }, () => {
  const trueOnly = test(
    'import { isUser, isName } from "./user.ts";',
    "  expect(isUser(1)).toBe(true);\n  expect(isName(1)).toBe(false);",
  );
  const files = { "src/user.ts": USER, "src/user.test.ts": trueOnly, "src/other.ts": OTHER };
  expect(guardsOf(files, ["src/user.test.ts"])).toEqual([untested("src/user.ts:3:17", "isUser")]);
});

it("reports a tsconfig.json typescript cannot read", () => {
  const root = plant({ "pkg/tsconfig.json": "{", "pkg/a.ts": USER });
  const found = guardDiagnostics(root, ["pkg/a.ts"]);
  expect(found.ok ? [] : found.errors).toEqual([expect.stringMatching(/^pkg\/tsconfig\.json: .+/)]);
});

it("fails a turn that touches only a test and drops the last false assert", { timeout: TURN }, async () => {
  const asserted = test(
    'import { isUser, isName } from "./user.ts";',
    "  expect(isUser(1)).toBe(false);\n  expect(isName(1)).toBe(false);",
    // The consumer installs no vitest, and the boundaries rule refuses an undeclared import; typed globals stand in.
  ).replace(VITEST, VITEST_GLOBALS);
  const root = consumer({ "src/user.ts": USER, "src/user.test.ts": asserted });
  write(root, {
    "src/user.test.ts": asserted.replace("expect(isUser(1)).toBe(false)", "expect(isUser(1)).toBe(true)"),
  });
  const result = await turn(root, [], { tsc: () => ({ code: 0, stdout: "", stderr: "" }), vitest: () => null });
  expect(result.err).toBe(
    `${untested("src/user.ts:3:17", "isUser").line}\nrepo turn: src/user.ts has 1 repo(guard-rejects), the baseline allows 0; fix the new one\n`,
  );
  expect(result.out).toMatch(/^turn: 1 file · fmt ok · comments ok · lint 1 over baseline · /);
  expect(result.code).toBe(1);
});
