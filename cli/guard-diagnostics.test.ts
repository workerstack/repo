import { afterEach, expect, it } from "vitest";

import { magicDiagnostics } from "./check-magic.ts";
import { guardDiagnostics } from "./guard-diagnostics.ts";
import { cleanTemps, plant, SLOW } from "./magic/__fixtures__/magic-repo.ts";
import {
  cleanTemps as cleanRepos,
  consumer,
  SLOW as TURN,
  TSC_PASSES,
  turn,
  write,
} from "./scripts/__fixtures__/turn-repo.ts";
import type { Diagnostic } from "./scripts/lint-baseline.ts";
import { type TsRun, withTsApi } from "./ts-api.ts";
import { posix } from "./ts-program.ts";

afterEach(() => {
  cleanTemps();
  cleanRepos();
});

const RULE = "repo(guard-rejects)";

const TSCONFIG = JSON.stringify({
  compilerOptions: { allowImportingTsExtensions: true, module: "preserve", moduleResolution: "bundler", strict: true },
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
function untested(at: string, name: string): Diagnostic {
  return {
    file: at.slice(0, at.indexOf(":")),
    line:
      `${at}: error ${RULE}: ${name} is never asserted false; ` +
      `add expect(${name}(<an input it must reject>)).toBe(false) to a test`,
    rule: RULE,
  };
}

const VITEST = 'import { expect, it } from "vitest";\n';

/** Typed stand-ins for vitest's globals, so the unsafe-any rules see no error-typed call. */
const VITEST_GLOBALS = [
  "declare const expect: <Value>(value: Value) => { toBe: (expected: Value) => void };",
  "declare const it: (name: string, run: () => void) => void;",
  "",
].join("\n");

/** A test file over `src/user.ts` with `imports` and `body` in one `it`. */
function test(imports: string, body: string): string {
  return `${VITEST}${imports}\n\nit("guards", () => {\n${body}\n});\n`;
}

/** What `check` gives on an API of its own over `root`. */
function onApi<T>(root: string, check: (run: TsRun) => Promise<T>): Promise<T> {
  return withTsApi(posix(root), check);
}

/** The guard hits of `files` planted beside a tsconfig.json, checking `checked` (all of them by default). */
async function guardsOf(
  files: Record<string, string>,
  checked: readonly string[] = Object.keys(files),
): Promise<Diagnostic[]> {
  const root = plant({ "tsconfig.json": TSCONFIG, ...files });
  const found = await onApi(root, (run) => guardDiagnostics(run, root, checked));

  if (!found.ok) throw new Error(found.error.join("\n"));

  return found.value;
}

it("reports each exported guard no test asserts false, a true-only test included", { timeout: SLOW }, async () => {
  const inferred = [
    'export const isCount = (value: unknown) => typeof value === "number";',
    'export const isWord = function (value: unknown): value is string { return typeof value === "string"; };',
    "",
  ].join("\n");

  const only = test(
    'import { isUser, isName } from "./user.ts";',
    '  expect(isUser({ name: "a" })).toBe(true);\n  expect(isName("a")).toBeTruthy();',
  );

  expect(await guardsOf({ "src/user.test.ts": only, "src/user.ts": `${USER}${inferred}` })).toStrictEqual([
    untested("src/user.ts:3:17", "isUser"),
    untested("src/user.ts:7:14", "isName"),
    untested("src/user.ts:8:14", "isCount"),
    untested("src/user.ts:9:14", "isWord"),
  ]);
});

it.each(["toBe(false)", "toBeFalsy()", "toEqual(false)"])(
  "passes a guard asserted .%s",
  { timeout: SLOW },
  async (form) => {
    const body = `  expect(isUser(1)).${form};\n  expect(isName(1)).${form};`;
    const tests = test('import { isUser, isName } from "./user.ts";', body);
    const files = { "src/user.test.ts": tests, "src/user.ts": USER };

    expect(await guardsOf(files)).toStrictEqual([]);
  },
);

it("follows a renamed import and a namespace import to the guard", { timeout: SLOW }, async () => {
  const renamed = test(
    'import { isUser as looksLikeUser } from "./user.ts";',
    "  expect(looksLikeUser(1)).toBe(false);",
  );

  const namespace = test('import * as user from "./user.ts";', "  expect(user.isName(1)).toBeFalsy();");
  const files = { "src/a.test.ts": renamed, "src/b.test.ts": namespace, "src/user.ts": USER };
  expect(await guardsOf(files, ["src/user.ts"])).toStrictEqual([]);
});

it("counts only a guard called as the argument of expect(…) itself", { timeout: SLOW }, async () => {
  const body = [
    "  const rejected = isUser(1);",
    "  expect(rejected).toBe(false);",
    "  expect.soft(isUser(1)).toBe(false);",
    "  check(isUser(1)).toBe(false);",
    "  expect().toBe(false);",
    "  rejected.toBe(false);",
    "  expect(isUser(1)).toBe(false, 1);",
    "  expect(isName(1)).toBe(false);",
    "  expect(isGone(1)).toBe(false);",
  ].join("\n");

  const files = { "src/user.test.ts": test('import { isUser, isName } from "./user.ts";', body), "src/user.ts": USER };
  expect(await guardsOf(files)).toStrictEqual([untested("src/user.ts:3:17", "isUser")]);
});

it(
  "skips a guard that is not exported or has no name of its own, an assertion function and a plain boolean function",
  { timeout: SLOW },
  async () => {
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

    expect(await guardsOf({ "src/text.ts": source })).toStrictEqual([]);
  },
);

it(
  "re-checks the guards of the sources a changed test imports, when only the test changed",
  { timeout: SLOW },
  async () => {
    const trueOnly = test(
      'import { isUser, isName } from "./user.ts";',
      "  expect(isUser(1)).toBe(true);\n  expect(isName(1)).toBe(false);",
    );

    const files = { "src/other.ts": OTHER, "src/user.test.ts": trueOnly, "src/user.ts": USER };
    expect(await guardsOf(files, ["src/user.test.ts"])).toStrictEqual([untested("src/user.ts:3:17", "isUser")]);
  },
);

it("reports a tsconfig.json typescript cannot read by its root-relative path", { timeout: SLOW }, async () => {
  const root = plant({ "pkg/a.ts": USER, "pkg/tsconfig.json": "{" });
  const found = await onApi(root, (run) => guardDiagnostics(run, root, ["pkg/a.ts"]));
  expect(found).toStrictEqual({ error: ["pkg/tsconfig.json: '}' expected."], ok: false });
});

it("fails a turn that touches only a test and drops the last false assert", { timeout: TURN }, async () => {
  const asserted = test(
    'import { isUser, isName } from "./user.ts";',
    "  expect(isUser(1)).toBe(false);\n  expect(isName(1)).toBe(false);",
    // The consumer installs no vitest, and the boundaries rule refuses an undeclared import; typed globals stand in.
  ).replace(VITEST, VITEST_GLOBALS);

  const root = consumer({ "src/user.test.ts": asserted, "src/user.ts": USER });
  write(root, {
    "src/user.test.ts": asserted.replace("expect(isUser(1)).toBe(false)", "expect(isUser(1)).toBe(true)"),
  });
  const result = await turn(root, [], TSC_PASSES);
  expect(result.err).toBe(
    `${untested("src/user.ts:3:17", "isUser").line}\n` +
      "repo turn: src/user.ts has 1 repo(guard-rejects), the baseline allows 0; fix the new one\n",
  );
  expect(result.out).toMatch(/^turn: 1 file · fmt ok · lint 1 over baseline · comments ok · /);
  expect(result.code).toBe(1);
});

it(
  "finds the same guards on an API the magic check of the run already read the sources on",
  { timeout: SLOW },
  async () => {
    const tests = test('import { isUser } from "./user.ts";', "");
    const files = { "src/other.ts": OTHER, "src/user.test.ts": tests, "src/user.ts": USER };

    const root = plant({ "tsconfig.json": TSCONFIG, ...files });
    const checked = Object.keys(files);

    const after = await onApi(root, async (run) => {
      const magic = await magicDiagnostics(run, root, checked);

      expect(magic.ok).toBe(true);

      return guardDiagnostics(run, root, checked);
    });

    expect(after).toStrictEqual({
      ok: true,
      value: [
        untested("src/other.ts:1:14", "isOther"),
        untested("src/user.ts:3:17", "isUser"),
        untested("src/user.ts:7:14", "isName"),
      ],
    });
  },
);
