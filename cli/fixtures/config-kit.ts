// Shared setup for the `loadConfig` suites: temp repo roots, a linked package, and the values a config resolves to.
import fs from "node:fs";
import path from "node:path";

import { CONFIG_FILE } from "../config.constants.ts";
import { tempDir, useTempDirs } from "../sync/fixtures/temp-dirs.ts";

/** This checkout's root, the package a linked `@workerstack/repo` points at. */
export const REPO_ROOT: string = path.join(import.meta.dirname, "..", "..");
export const AGENTS = { hosts: ["claude", "codex", "antigravity", "grok", "cursor"], skills: [] };
export const COMMIT = { maxChangedLines: 1000 };
export const LINT = { skip: [] };
export const KNIP = { ignore: [] };
export const CI = { checks: {} };
export const NIGHTLY = { secrets: [], shards: 1 };
export const COVERAGE = {
  floors: "coverage-floors.json",
  knownFailures: "known-failures.json",
  mutate: ["src/**/*.ts"],
  mutationFloors: "mutation-floors.json",
};

/** Removes every dir `configDir` made after each test of the calling file. */
export function useConfigKit(): void {
  useTempDirs();
}

/** A new empty temp dir, removed after the test. */
export function configDir(): string {
  return tempDir("workerstack-config-");
}

/** A temp repo root holding `config` as workerstack.config.ts, and `manifest` as package.json unless it is null. */
export function repo(config: string, manifest: object | string | null = { name: "fixture" }): string {
  const root = configDir();
  fs.writeFileSync(path.join(root, CONFIG_FILE), config);
  if (manifest !== null) {
    const text = typeof manifest === "string" ? manifest : JSON.stringify(manifest);
    fs.writeFileSync(path.join(root, "package.json"), text);
  }
  return root;
}

/** Links `<root>/node_modules/@workerstack/repo` to this checkout, as an install of the package would. */
export function linkPackage(root: string): void {
  const scope = path.join(root, "node_modules", "@workerstack");
  fs.mkdirSync(scope, { recursive: true });
  fs.symlinkSync(REPO_ROOT, path.join(scope, "repo"), "junction");
}

/** The failed load naming each of `errors` in workerstack.config.ts. */
export const refusal = (...errors: string[]): { errors: string[]; ok: false } => ({
  errors: errors.map((e) => `workerstack.config.ts: ${e}`),
  ok: false,
});
