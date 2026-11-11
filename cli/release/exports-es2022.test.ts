import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { exportSubpaths } from "./exports.ts";

const ROOT = path.join(import.meta.dirname, "..", "..");
const TSC = Bun.resolveSync("typescript/lib/tsc.js", ROOT);
/** The consumer job's compiler options: target ES2022 with its default lib, so ES2023 methods do not exist. */
const CONSUMER_FLAGS = [
  "--target",
  "ES2022",
  "--module",
  "preserve",
  "--moduleResolution",
  "bundler",
  "--strict",
  "--noEmit",
  "--skipLibCheck",
  "--allowImportingTsExtensions",
];
const SOURCE_TYPES = /(?<!\.d)\.ts$/u;

/** The tsc error lines for `files` under the consumer's options, run in `cwd`. */
function consumerErrors(files: readonly string[], cwd: string): string[] {
  const run = spawnSync(process.execPath, [TSC, ...CONSUMER_FLAGS, ...files], { cwd, encoding: "utf8" });
  return run.stdout.split("\n").filter((line) => line.includes("error TS"));
}

/** The `.ts` source each `package.json` export types with: what a consumer's tsc reads from the tarball. */
function exportedSources(): string[] {
  const manifest = z
    .object({ exports: z.unknown() })
    .parse(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")));
  const listed = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\n");
  return exportSubpaths(manifest.exports, listed)
    .subpaths.map((subpath) => subpath.types)
    .filter((types): types is string => types !== null && SOURCE_TYPES.test(types));
}

describe("exported source under the consumer's ES2022 lib", () => {
  it("type-checks every file an export reaches", () => {
    const sources = exportedSources();

    expect(sources).toContain("./cli/lint/index.ts");
    expect(consumerErrors(sources, ROOT)).toStrictEqual([]);
  });

  it("refuses an ES2023 array method", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "es2022-"));
    try {
      fs.writeFileSync(path.join(dir, "late.ts"), "export const last = ([1, 2] as const).toReversed();\n");

      expect(consumerErrors(["late.ts"], dir)).toStrictEqual([
        "late.ts(1,39): error TS2339: Property 'toReversed' does not exist on type 'readonly [1, 2]'.",
      ]);
    } finally {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });
});
