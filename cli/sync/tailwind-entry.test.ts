import fs from "node:fs";
import path from "node:path";

import { parse } from "jsonc-parser";
import { afterEach, expect, it } from "vitest";

import type { ResolvedLint } from "../config.ts";
import { cleanTemps, git, tempDir, write } from "../scripts/fixtures/turn-repo.ts";
import { runSync } from "../sync.ts";
import { withTailwindEntry } from "./tailwind-entry.ts";

afterEach(cleanTemps);

const IMPORT = '@import "tailwindcss";\n';
const AT = "workerstack.config.ts: lint.tailwind.entryPoint";

/** A git checkout holding `files`, none committed. */
function checkout(files: Record<string, string>): string {
  const root = tempDir("workerstack-tailwind-");
  git(root, "init", "-q");
  write(root, files);
  return root;
}

/** The entry sync resolves in a checkout holding `files`, or its errors. */
function entryOf(files: Record<string, string>, entryPoint?: string): string | string[] | undefined {
  const root = checkout(files);
  const lint: ResolvedLint = entryPoint === undefined ? { skip: [] } : { skip: [], tailwind: { entryPoint } };
  const resolved = withTailwindEntry(root, lint);
  return resolved.ok ? resolved.lint.tailwind?.entryPoint : resolved.errors;
}

it.each([
  IMPORT,
  "@import 'tailwindcss';\n",
  '@import "tailwindcss" source("../src");\n',
  '@import "tailwindcss" layer(utilities);\n',
  '@import "tailwindcss"\n',
  '@import "./fonts.css";\n\n  @import "tailwindcss";\n',
])("a sheet importing tailwindcss as %j is the entry", (text) => {
  expect(entryOf({ "src/app.css": text, "src/plain.css": ".a {\n  color: red;\n}\n" })).toBe("src/app.css");
});

it.each([
  '@import url("tailwindcss");\n',
  '@import "tailwindcss/preflight.css";\n',
  "/* @import 'tailwindcss' */ .a {\n  color: red;\n}\n",
  ".a {\n  color: red;\n}\n",
])("a sheet with %j is no entry, so nothing turns on", (text) => {
  expect(entryOf({ "src/app.css": text })).toBeUndefined();
});

it("a sheet under a fixtures dir, or no sheet at all, is no entry", () => {
  expect(entryOf({ "fixtures/app.css": IMPORT })).toBeUndefined();
  expect(entryOf({ "src/a.ts": "export const a = 1;\n" })).toBeUndefined();
});

it("two sheets importing tailwindcss need lint.tailwind.entryPoint, which then picks one", () => {
  const files = { "apps/a/app.css": IMPORT, "apps/b/app.css": IMPORT };
  expect(entryOf(files)).toStrictEqual([
    `${AT}: two sheets import tailwindcss (apps/a/app.css, apps/b/app.css); set the one oxlint checks classes against`,
  ]);
  expect(entryOf(files, "apps/b/app.css")).toBe("apps/b/app.css");
});

it("an entryPoint that is no file, or does not import tailwindcss, is refused", () => {
  expect(entryOf({ "src/app.css": IMPORT }, "src/gone.css")).toStrictEqual([`${AT}: "src/gone.css" is not a file`]);
  expect(entryOf({ "src/plain.css": ".a {\n  color: red;\n}\n" }, "src/plain.css")).toStrictEqual([
    `${AT}: "src/plain.css" does not import tailwindcss`,
  ]);
});

/** The generated config at `rel` under `root`, parsed. */
function generated(root: string, rel: string): unknown {
  return parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

it("repo sync gives oxlint and oxfmt the one entry, and refuses a second", async () => {
  const config = 'export default { packs: ["standards"] };\n';
  const root = checkout({
    "package.json": '{ "name": "app" }\n',
    "src/app.css": IMPORT,
    "workerstack.config.ts": config,
  });
  const err: string[] = [];
  const io = { cwd: root, stderr: (text: string) => err.push(text), stdout: () => true };
  expect(await runSync([], io, { generators: [] })).toBe(0);
  expect(generated(root, ".oxfmtrc.jsonc")).toMatchObject({ sortTailwindcss: { stylesheet: "src/app.css" } });
  expect(generated(root, ".oxlintrc.json")).toMatchObject({ settings: { tailwindcss: { entryPoint: "src/app.css" } } });
  write(root, { "src/admin.css": IMPORT });
  expect(await runSync([], io, { generators: [] })).toBe(1);
  expect(err).toContain(
    `repo sync: ${AT}: two sheets import tailwindcss (src/admin.css, src/app.css); ` +
      "set the one oxlint checks classes against\n",
  );
});
