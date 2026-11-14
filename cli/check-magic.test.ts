import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { magicDiagnostics, withoutSkipped } from "./check-magic.ts";
import {
  BOUND,
  cleanTemps,
  COMPARED,
  COPIES,
  hit,
  magicOf,
  NAMES_NOTHING,
  NUMBER,
  plant,
  SCHEMA,
  SLOW,
  STRING,
} from "./magic/__fixtures__/magic-repo.ts";
import type { SharedSources } from "./ts-program.ts";

afterEach(cleanTemps);

const RETRY = [
  'import { Schema } from "./schema.ts";',
  "",
  'const FAST = "fast";',
  "const t = delay(go, 5000);",
  "",
  "declare function delay(f: () => void, ms: number): number;",
  "declare function go(): void;",
  "export function retry(mode: string, s: Schema): number {",
  "  void s.max(2048);",
  "  if (mode === FAST) return t;",
  "  if (t < 0) return 0;",
  '  if (mode == "fast") return 0;',
  "  return 1;",
  "}",
  "",
].join("\n");

it("reports each Usage hit at its line and column, in file and position order", { timeout: SLOW }, () => {
  expect(magicOf({ "src/retry.ts": RETRY, "src/schema.ts": SCHEMA })).toStrictEqual([
    hit("src/retry.ts:3:7", STRING, COPIES("FAST", "fast")),
    hit("src/retry.ts:4:21", NUMBER, NAMES_NOTHING("5000")),
    hit("src/retry.ts:9:14", NUMBER, BOUND(".max(2048)")),
    hit("src/retry.ts:12:15", STRING, COMPARED("fast")),
  ]);
});

it(
  "groups files by their nearest tsconfig.json, so a package's paths resolve and its literal union passes",
  { timeout: SLOW },
  () => {
    const api = {
      compilerOptions: {
        module: "preserve",
        moduleResolution: "bundler",
        paths: { "#modes": ["./src/modes.ts"] },
        strict: true,
      },
      include: ["src"],
    };

    const root = plant({
      "packages/api/src/modes.ts": 'export type Mode = "fast" | "slow";\nexport declare const current: Mode;\n',
      "packages/api/src/use.ts": 'import { current } from "#modes";\nexport const fast = () => current === "fast";\n',
      "packages/api/tsconfig.json": `${JSON.stringify(api)}\n`,
      "src/root.ts": 'import { current } from "#modes";\nexport const fast = () => current === "fast";\n',
      "tsconfig.json": `${JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] })}\n`,
    });

    const found = magicDiagnostics(root, ["src/root.ts", "packages/api/src/use.ts", "packages/api/src/modes.ts"]);
    expect(found).toStrictEqual({ ok: true, value: [hit("src/root.ts:2:39", STRING, COMPARED("fast"))] });
  },
);

it(
  "finds a copy's comparisons in the package's other files when only the copy's file is checked",
  { timeout: SLOW },
  () => {
    const root = plant({
      "src/modes.ts": 'export const SLOW = "slow";\nexport const PLAIN = 7;\n',
      "src/other.test.ts": 'import { SLOW } from "./modes.ts";\nexport const t = (m: string) => m === SLOW;\n',
      "src/other.ts": "export const other = (m: string) => m.length;\n",
      "src/use.ts": 'import { SLOW } from "./modes.ts";\nexport const is = (m: string) => m === SLOW;\n',
      "tsconfig.json": `${JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] })}\n`,
    });

    expect(magicDiagnostics(root, ["src/modes.ts"])).toStrictEqual({
      ok: true,
      value: [hit("src/modes.ts:1:14", STRING, COPIES("SLOW", "slow"))],
    });
    // The copy lands in a file this run does not check, so it is left to the run that checks it.
    expect(magicDiagnostics(root, ["src/use.ts"])).toStrictEqual({ ok: true, value: [] });
  },
);

it("checks ts, tsx, mts and cts sources, never tests, declarations, fixtures, e2e or vendored code", () => {
  const body = "export const f = () => 5000;\n";

  const skipped = [
    "src/a.test.ts",
    "src/a.spec.tsx",
    "src/a.e2e.ts",
    "src/a.reject.ts",
    "types/a.d.ts",
    "types/b.d.mts",
    "src/__fixtures__/a.ts",
    "e2e/a.ts",
    "lib/vendor/a.ts",
    "src/a.js",
    "README.md",
  ];

  const checked = ["src/a.ts", "src/b.tsx", "src/c.mts", "src/d.cts"];
  const files = Object.fromEntries([...skipped, ...checked].map((rel) => [rel, body]));
  expect(magicOf(files).map((d) => d.file)).toStrictEqual(checked);
});

it("parses a file edited between two runs that share their sources again", { timeout: SLOW }, () => {
  const root = plant({ "src/a.ts": "export const f = () => 5000;\n", "tsconfig.json": '{ "include": ["src"] }\n' });
  const shared: SharedSources = new Map();

  expect(magicDiagnostics(root, ["src/a.ts"], shared)).toStrictEqual({
    ok: true,
    value: [hit("src/a.ts:1:24", NUMBER, NAMES_NOTHING("5000"))],
  });
  fs.writeFileSync(path.join(root, "src/a.ts"), "export const f = (n: number) => n + 6000;\n");
  expect(magicDiagnostics(root, ["src/a.ts"], shared)).toStrictEqual({
    ok: true,
    value: [hit("src/a.ts:1:37", NUMBER, NAMES_NOTHING("6000"))],
  });
});

it("reports a tsconfig.json typescript cannot read", () => {
  const root = plant({ "pkg/a.ts": "export const a = 1;\n", "pkg/tsconfig.json": "{" });
  const found = magicDiagnostics(root, ["pkg/a.ts"]);
  expect(found.ok ? [] : found.error).toStrictEqual([expect.stringMatching(/^pkg\/tsconfig\.json: .+/)]);
});

it("withoutSkipped drops only the hits of the rule a skip names, in the files its globs match", () => {
  const diagnostics = [
    hit("src/a.ts:1:1", NUMBER, NAMES_NOTHING("5")),
    hit("src/a.ts:2:1", STRING, COMPARED("x")),
    hit("lib/b.ts:1:1", NUMBER, NAMES_NOTHING("5")),
  ];

  const skips = [{ files: ["src/*.ts"], reason: "tuning lives here", rules: ["repo/magic-number"] }];
  expect(withoutSkipped(diagnostics, skips, ["src/a.ts", "lib/b.ts"])).toStrictEqual(diagnostics.slice(1));
  expect(withoutSkipped(diagnostics, [], ["src/a.ts", "lib/b.ts"])).toStrictEqual(diagnostics);
});

const SHARDS = "export default { nightly: { shards: 8 } };\n";

it("reports no magic number in the root repo.config.ts, which holds values, but does elsewhere", () => {
  const found = magicOf({ "repo.config.ts": SHARDS, "src/shards.ts": SHARDS });
  expect(found).toStrictEqual([hit("src/shards.ts:1:37", NUMBER, NAMES_NOTHING("8"))]);
});

it("reports a magic number in a repo.config.ts below the root", () => {
  const found = magicOf({ "pkg/repo.config.ts": SHARDS });
  expect(found).toStrictEqual([hit("pkg/repo.config.ts:1:37", NUMBER, NAMES_NOTHING("8"))]);
});
