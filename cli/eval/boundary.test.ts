import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";
import { z } from "zod";

const ROOT = path.join(import.meta.dirname, "..", "..");
const SOURCE = /\.(?:ts|tsx|mts|cts|js|mjs)$/;
const IMPORT_OF_EVALS = /(?:from\s+|import\s*\(\s*|import\s+)["'][^"']*\bevals\//;

/** The `files` list of this package's package.json. */
function filesEntries(): string[] {
  const manifest = z
    .object({ files: z.array(z.string()) })
    .parse(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")));

  return manifest.files;
}

/** Every shipped source under `cli/`: no test, no fixture. */
function shippedSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) return entry.name === "__fixtures__" ? [] : shippedSources(full);

    if (!SOURCE.test(entry.name) || /\.test\.[cm]?[jt]sx?$/.test(entry.name)) return [];

    return [full];
  });
}

it("package.json files never names or globs into evals/", () => {
  const hits = filesEntries().filter((entry) => entry.replace(/^!/, "").split("/").includes("evals"));

  expect(hits).toStrictEqual([]);
});

it("package.json files has no entry that could reach evals/", () => {
  const broad = filesEntries().filter(
    (entry) => !entry.startsWith("!") && ["", ".", "*", "**", "**/*"].includes(entry),
  );

  expect(broad).toStrictEqual([]);
});

it("no shipped file under cli/ imports from evals/", () => {
  const sources = shippedSources(path.join(ROOT, "cli"));
  const hits = sources.filter((file) => IMPORT_OF_EVALS.test(fs.readFileSync(file, "utf8")));

  expect(sources.length).toBeGreaterThan(0);
  expect(hits.map((file) => path.relative(ROOT, file))).toStrictEqual([]);
});
