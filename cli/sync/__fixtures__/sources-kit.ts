// Source trees and loaders for the `loadSources` suites: a stock tree, a doc writer and loaders that assert the outcome.
import { expect } from "vitest";

import { loadSources } from "../agents/load-sources.ts";
import { put, tempDir } from "./temp-dirs.ts";

/** A temp root holding `files` (POSIX relative path → text). */
export function tree(files: Record<string, string>): string {
  const root = tempDir("workerstack-sources-");
  for (const [rel, text] of Object.entries(files)) put(root, rel, text);
  return root;
}

export const doc = (name: string, extra = "") => `---\ndescription: ${name} desc\n${extra}---\n${name} body\n`;

type Roots = Parameters<typeof loadSources>[0];

/** The docs that loaded; any problem fails the test, so a case about sources cannot pass on a half load. */
export function loaded(roots: Roots) {
  const result = loadSources(roots);
  expect(result.problems).toStrictEqual([]);
  return result.sources;
}

export function problems(roots: Roots): string[] {
  const result = loadSources(roots);
  expect(result.problems).not.toStrictEqual([]);
  return result.problems;
}
const HOOKS = '{\n  // stock\n  "version": 1, "hooks": {}\n}\n';

export function stock(extra: Record<string, string> = {}): string {
  return tree({
    "agents/hooks.jsonc": HOOKS,
    "agents/rules/foo.md": doc("foo"),
    "agents/rules/overview.md": doc("overview"),
    "agents/subagents/scout.md": doc("scout"),
    "agents/subagents/worker.md": doc("worker"),
    ...extra,
  });
}
