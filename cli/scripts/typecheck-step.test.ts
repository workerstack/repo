import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { cleanTemps, consumer, SLOW, srcConfig, TSCONFIG, turn, write } from "./fixtures/turn-repo.ts";
import type { Captured } from "./lint.ts";
import type { Bins } from "./turn-steps.ts";

afterEach(cleanTemps);

function noSrc(dir: string): string {
  return (
    `repo turn: tsconfig: ${dir} has no tsconfig.src.json; add one with "extends": ` +
    `["./tsconfig.json", "@workerstack/repo/tsconfig/strict"] and an "exclude" that repeats tsconfig.json's ` +
    "and adds the tests\n"
  );
}
const OK: Captured = { code: 0, stderr: "", stdout: "" };
const WORKSPACE = `${JSON.stringify({
  name: "app",
  packageManager: `bun@${Bun.version}`,
  private: true,
  type: "module",
  workspaces: ["packages/*"],
})}\n`;
const API_MANIFEST = `${JSON.stringify({ name: "api", private: true, sideEffects: false, type: "module" }, null, 2)}\n`;

const UNANNOTATED_TEST = [
  'import { expect, it } from "vitest";',
  'import { size } from "./size.ts";',
  "",
  "export function twice(s: string) {",
  "  return size(s + s);",
  "}",
  "",
  'it("sizes", () => {',
  '  expect(twice("ab")).toBe(4);',
  "});",
  "",
].join("\n");

/** The typecheck label in a turn's summary line. */
function label(out: string): string | undefined {
  return / · (typecheck [^·]*) · /.exec(out)?.[1];
}

/** A root with an app and one package, each with both configs. */
function twoOwners(): string {
  return consumer({
    "package.json": WORKSPACE,
    "tsconfig.json": TSCONFIG,
    ...srcConfig(),
    "packages/api/package.json": API_MANIFEST,
    "packages/api/tsconfig.json": TSCONFIG,
    ...srcConfig("packages/api"),
    "packages/api/src/a.ts": "export const a = 42;\n",
    "src/root.ts": "export const root = 42;\n",
  });
}

/** Bins whose tsc fails the configs in `failing`, by the `-p` argument it got, and records every tsc call. */
function fakeTsc(failing: readonly string[]): { bins: Bins; projects: string[] } {
  const projects: string[] = [];
  function tsc(args: string[]): Captured {
    const project = args.at(-1) ?? "";
    projects.push(project);
    return failing.includes(project) ? { code: 2, stderr: "", stdout: `${project}: error TS1.\n` } : OK;
  }
  return { bins: { tsc, vitest: () => null }, projects };
}

it(
  "real tsc: an unannotated export fails tsconfig.src.json while its test file passes tsconfig.json",
  { timeout: SLOW },
  async () => {
    const root = consumer({
      "tsconfig.json": TSCONFIG,
      ...srcConfig(),
      // Unannotated too, which the loose tsconfig.json it is checked under allows.
      "src/size.test.ts": UNANNOTATED_TEST,
      "src/size.ts": "export function size(s: string): number {\n  return s.length;\n}\n",
    });
    write(root, { "src/size.ts": "export function size(s: string) {\n  return s.length;\n}\n" });
    const result = await turn(root, []);
    expect(result.out).toBe(
      "turn: 1 file · fmt ok · comments ok · lint ok · typecheck failed (tsconfig.src.json) · 1 related test passed\n",
    );
    // tsc ends its lines with the platform's EOL.
    expect(result.err.replaceAll("\r\n", "\n")).toBe(
      "src/size.ts(1,17): error TS9007: Function must have an explicit return type annotation " +
        "with --isolatedDeclarations.\n",
    );
    expect(result.code).toBe(1);
  },
);

it("a tsconfig.json without a tsconfig.src.json fails typecheck with check's message", { timeout: SLOW }, async () => {
  const root = consumer({
    "package.json": WORKSPACE,
    "packages/api/package.json": API_MANIFEST,
    "packages/api/src/a.ts": "export const a = 42;\n",
    "packages/api/tsconfig.json": TSCONFIG,
  });
  write(root, { "packages/api/src/a.ts": "export const a = 41;\n" });
  const { bins, projects } = fakeTsc([]);
  const result = await turn(root, [], bins);
  expect(result.out).toBe(
    "turn: 1 file · fmt ok · comments ok · lint ok · typecheck failed (packages/api/tsconfig.src.json missing) · " +
      "related tests skipped (no vitest in packages/api)\n",
  );
  expect(result.err).toBe(noSrc("packages/api"));
  expect(projects).toStrictEqual(["packages/api"]);
  expect(result.code).toBe(1);
});

it("typecheck runs both configs per owner and names each failing config by path", { timeout: SLOW }, async () => {
  const root = twoOwners();
  write(root, { "packages/api/src/a.ts": "export const a = 41;\n", "src/root.ts": "export const root = 41;\n" });
  const pass = fakeTsc([]);
  const passed = await turn(root, [], pass.bins);
  expect(label(passed.out)).toBe("typecheck ., packages/api");
  expect(pass.projects).toStrictEqual([".", "tsconfig.src.json", "packages/api", "packages/api/tsconfig.src.json"]);
  expect(passed.code).toBe(0);

  const one = await turn(root, [], fakeTsc(["packages/api/tsconfig.src.json"]).bins);
  expect(label(one.out)).toBe("typecheck failed (packages/api/tsconfig.src.json)");
  expect(one.err).toBe("packages/api/tsconfig.src.json: error TS1.\n");

  const two = await turn(root, [], fakeTsc(["packages/api", "tsconfig.src.json"]).bins);
  expect(label(two.out)).toBe("typecheck failed (packages/api/tsconfig.json, tsconfig.src.json)");
  expect(two.err).toBe("tsconfig.src.json: error TS1.\npackages/api: error TS1.\n");
  expect(two.code).toBe(1);

  fs.rmSync(path.join(root, "tsconfig.src.json"));
  const missing = await turn(root, [], fakeTsc(["packages/api"]).bins);
  expect(label(missing.out)).toBe("typecheck failed (packages/api/tsconfig.json, tsconfig.src.json missing)");
  expect(missing.err).toBe(`${noSrc(".")}packages/api: error TS1.\n`);
});
