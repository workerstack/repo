import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  APP_MANIFEST,
  cleanTemps,
  consumer,
  git,
  PIN,
  recording,
  SLOW,
  srcConfig,
  TSCONFIG,
  turn,
  write,
} from "./__fixtures__/turn-repo.ts";

afterEach(cleanTemps);

const WORKSPACE_ROOT = { main: "src/root.ts", name: "app", packageManager: PIN, private: true, type: "module" };

const API_MANIFEST =
  '{\n  "name": "api",\n  "private": true,\n  "type": "module",\n  "sideEffects": false,\n' +
  '  "exports": {\n    "./a": "./src/a.ts",\n    "./b": "./src/b.ts"\n  }\n}\n';

it("a manifest change runs sync and check; a references change runs sync alone", { timeout: SLOW }, async () => {
  const root = consumer({ "references/a.md": "# A\n" });
  write(root, { "package.json": APP_MANIFEST });
  const manifest = await turn(root, []);
  expect(manifest.out).toMatch(/ · sync ok · check ok\n$/);
  expect(manifest.code).toBe(0);
  git(root, "checkout", "--", "package.json");
  fs.rmSync(path.join(root, "references/a.md"));
  const references = await turn(root, []);
  expect(references.out).toMatch(/^turn: 1 file · fmt ok · .* · sync ok\n$/);
});

it("a sync refusal fails sync and check and prints their output", { timeout: SLOW }, async () => {
  const root = consumer({});
  write(root, { "package.json": APP_MANIFEST, "src/.gitignore": "x\n" });
  const result = await turn(root, []);
  expect(result.out).toMatch(/ · sync failed · check failed\n$/);
  expect(result.err).toContain("repo sync: src/.gitignore: ignore rules live in the root .gitignore");
  expect(result.code).toBe(1);
});

// The fields in the order bun fmt's sortPackageJson writes them, so the planted package passes fmt.

it("a path is the whole package owning it, typechecked on its own tsconfig", { timeout: SLOW }, async () => {
  const root = consumer({
    "package.json": `${JSON.stringify({ ...WORKSPACE_ROOT, workspaces: ["packages/*"] }, null, 2)}\n`,
    "packages/api/package.json": API_MANIFEST,
    "packages/api/tsconfig.json": TSCONFIG,
    ...srcConfig("packages/api"),
    "packages/api/src/a.ts": "export const a = 42;\n",
    "packages/api/src/b.ts": "export const b = 42;\n",
    "src/root.ts": "export const root = 42;\n",
  });

  const { bins, calls } = recording(root);
  const result = await turn(root, ["packages/api/src"], bins);
  expect(result.out).toBe(
    "turn: 6 files · fmt ok · comments ok · lint ok · typecheck packages/api · sync ok · check ok\n",
  );
  expect(calls).toStrictEqual(["tsc . --noEmit -p packages/api", "tsc . --noEmit -p packages/api/tsconfig.src.json"]);
});
