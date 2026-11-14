import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { main } from "../coverage.ts";
import { type JsonObject, readJson } from "../json.ts";
import type { CargoRun } from "../rust/clippy.ts";

/** This checkout, whose installed packages every project links. */
export const REPO_ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** How long a test that runs a nested instrumented vitest may take. */
export const RUN_MS = 60_000;

/** The floors file `repo coverage` writes by default. */
export const FLOORS = "coverage-floors.json";

const SOURCE = `export function sign(n: number): string {
  if (n < 0) return "neg";
  return "pos";
}

export function unused(): number {
  return 1;
}
`;

/** The project's one passing test of `src/a.ts`. */
export const PASSING = `import { expect, it } from "vitest";
import { sign } from "./a.ts";

it("signs a positive number", () => {
  expect(sign(1)).toBe("pos");
});
`;

/** What `src/a.ts` measures with `PASSING`: lines are 2 of 3 (66.67), so the floor is 66, not 67. */
export const MEASURED = { branches: 50, functions: 50, lines: 66, statements: 50 };

/**
 * A tiny vitest project in a temp dir pushed onto `temps`, with the repo's installed packages linked in; `config` is
 * its repo config.
 */
export function project(temps: string[], config = "export default {};\n"): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-coverage-")));
  temps.push(root);
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(root, "node_modules"), "junction");
  const preset = JSON.stringify(path.join(REPO_ROOT, "presets", "vitest.ts"));

  const vitest = `import { defineConfig } from ${preset};
export default defineConfig({ test: { include: ["src/**/*.test.ts"], coverage: { include: ["src/**"] } } });
`;

  const files = {
    "repo.config.ts": config,
    "src/a.test.ts": PASSING,
    "src/a.ts": SOURCE,
    "vitest.config.ts": vitest,
  };

  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }

  return root;
}

/** The floors file `root` holds at `file`. */
export function floorsOf(root: string, file = FLOORS): JsonObject {
  return readJson(z.record(z.string(), z.json()), fs.readFileSync(path.join(root, file), "utf8"));
}

/** Runs `repo coverage` in `root`; `run` stands in for cargo. */
export function coverage(root: string, run?: CargoRun): Promise<number> {
  process.chdir(root);

  return main([], run);
}
