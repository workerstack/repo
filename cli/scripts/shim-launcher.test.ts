import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { findLocalRepo } from "./shim-launcher.mjs";

useTempDirs();

const LAUNCHER = fileURLToPath(new URL("shim-launcher.mjs", import.meta.url));
const ENTRY = path.join("node_modules", "@workerstack", "repo", "bin", "repo.ts");

/** Plants a fake installed repo under `dir` whose bin prints its argv as JSON and exits 7. */
function plantRepo(dir: string): string {
  const entry = path.join(dir, ENTRY);
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "console.log(JSON.stringify(process.argv.slice(2)));\nprocess.exit(7);\n");

  return entry;
}

function nested(root: string, ...parts: string[]): string {
  const dir = path.join(root, ...parts);
  fs.mkdirSync(dir, { recursive: true });

  return dir;
}

function launch(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [LAUNCHER, ...args], { cwd, encoding: "utf8" });
}

it("finds the installed repo from a directory below the project", () => {
  const root = tempDir("shim-find-");
  const entry = plantRepo(root);

  expect(findLocalRepo(nested(root, "a", "b", "c"))).toBe(entry);
  expect(findLocalRepo(root)).toBe(entry);
});

it("the nearest project wins in a nested project", () => {
  const root = tempDir("shim-near-");
  plantRepo(root);
  const inner = nested(root, "packages", "app");
  const entry = plantRepo(inner);

  expect(findLocalRepo(nested(inner, "src"))).toBe(entry);
});

it("returns null when no project is above", () => {
  expect(findLocalRepo(nested(tempDir("shim-none-"), "x"))).toBeNull();
});

it("runs the project's repo with the arguments and returns its exit code", () => {
  const root = tempDir("shim-run-");
  plantRepo(root);
  const r = launch(nested(root, "deep"), "doctor", "--x");

  expect(r.status).toBe(7);
  expect(r.stdout.trim()).toBe(JSON.stringify(["doctor", "--x"]));
});

it("prints one error line and exits 1 outside a project", () => {
  const dir = nested(tempDir("shim-out-"), "plain");
  const r = launch(dir, "doctor");

  expect(r.status).toBe(1);
  const above = fs.realpathSync(dir);

  expect(r.stderr).toBe(`repo: no @workerstack/repo found above ${above}; run \`bun install\` in the project\n`);
});
