// Sources, renders and readers for the hooks suites, typed so no suite casts what a render wrote.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

import type { Host } from "../../config.ts";
import { emitMcpPolicy } from "../../scripts/emit-mcp-policy.ts";
import { applyUnion } from "../../scripts/hooks-union.ts";
import { renderHooks } from "../agents/render-hooks.ts";
import type { Sources } from "../agents/sources.types.ts";
import { put, tempDir } from "./temp-dirs.ts";

/** This repo's root. */
export const ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = path.join(ROOT, "cli", "sync", "fixtures");
/** The consumer fixture, the frozen stock it renders over and the golden files it gives. */
export const CONSUMER: string = path.join(FIXTURES, "consumer");
export const STOCK: string = path.join(FIXTURES, "consumer-stock");
export const GOLDEN: string = path.join(FIXTURES, "golden");
/** Every hook file, in the order a render with every host writes them. */
export const HOOK_FILES: readonly string[] = [
  ".claude/settings.json",
  ".codex/hooks.json",
  ".agents/hooks.json",
  ".cursor/hooks.json",
];
/** The stock claude settings a render starts from. */
export const BASE_REL = "agents/settings/claude.json";

/** A path into a parsed JSON value: object keys and array indexes. */
export type Step = string | number;

/** The value at `keys` under `value`; undefined once a step reaches something that is not an object. */
export function at(value: unknown, ...keys: readonly Step[]): unknown {
  let node = value;
  for (const key of keys) node = typeof node === "object" && node !== null ? Reflect.get(node, key) : undefined;
  return node;
}

/** The keys of the object at `keys` under `value`, in order; none when it is not an object. */
export function keysAt(value: unknown, ...keys: readonly Step[]): string[] {
  const node = at(value, ...keys);
  return typeof node === "object" && node !== null ? Object.keys(node) : [];
}

/** The parsed JSON a render wrote at `rel`. */
export function parsed(files: ReadonlyMap<string, string>, rel: string): unknown {
  const value: unknown = JSON.parse(files.get(rel) ?? "");
  return value;
}

/** Sources holding only `value` as the consumer's hooks.jsonc. */
export function hooksOf(value: Record<string, unknown>): Sources {
  return { hooks: { rel: ".repo/hooks.jsonc", value }, rules: [], subagents: [] };
}

/** The roots of one render: where the stock and consumer live. */
export type Roots = { stock: string; consumer: string };

/**
 * The hook files after the steps trees.ts still runs on the stage behind the generators: the MCP policy, then the
 * hooks union. Neither repo has `.repo/settings/claude.json`, so the overlay merge adds nothing.
 */
export function afterStage(files: ReadonlyMap<string, string>, { stock, consumer }: Roots): Map<string, string> {
  const stage = tempDir("workerstack-hooks-");
  for (const [rel, text] of files) put(stage, rel, text);
  expect(emitMcpPolicy({ consumerRoot: consumer, sourceRoot: stock, workspaceRoot: stage }).ok).toBe(true);
  expect(applyUnion({ consumerRoot: consumer, sourceRoot: stock, workspaceRoot: stage }).ok).toBe(true);
  return new Map(HOOK_FILES.map((rel) => [rel, fs.readFileSync(path.join(stage, rel), "utf8")]));
}

/** One handler definition rendered for one host: the host's file's events object (`rulesync` for antigravity). */
export function renderOne(host: Host, event: string, def: Record<string, unknown>): unknown {
  const files = renderHooks(hooksOf({ hooks: { [event]: [def] } }), [host], "{}");
  const file = parsed(files, [...files.keys()][0] ?? "");
  return at(file, host === "antigravity" ? "rulesync" : "hooks");
}

/** Every passthrough field any host knows, plus one none does. */
export const EVERY_FIELD: Readonly<Record<string, unknown>> = {
  additionalContextLimit: 100,
  args: ["x"],
  async: false,
  asyncRewake: false,
  commandWindows: "c.cmd",
  continueOnBlock: true,
  failClosed: true,
  if: "Bash(git *)",
  loop_limit: 2,
  once: true,
  shell: "bash",
  statusMessage: "m",
  unknown: "u",
};
