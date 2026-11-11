// Consumers, contexts and output readers for the trees suites, typed so no suite casts what a render wrote.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_CONFIG } from "../../__fixtures__/base-config.ts";
import type { Host, SkillPack } from "../../config.ts";
import type { Output, SyncContext } from "../outputs.ts";
import { renderTrees } from "../trees.ts";
import { put, tempDir } from "./temp-dirs.ts";

/** This repo's root, linked into each consumer as the stock package. */
export const SELF_ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/** Where a consumer's host skill link points for a stock skill. */
export const STOCK_SKILL = "../../node_modules/@workerstack/repo/agents/skills";
/** A render copies and merges on a disk stage, and one test renders up to three times. */
export const RENDER_TIMEOUT = 60_000;

/** The optional packs and workspace packages of a render. */
export interface RenderOptions {
  skills?: readonly SkillPack[];
  packages?: readonly string[];
}

/** The `.claude/settings.json` keys the suites read back. */
export interface ClaudeSettings {
  env?: Record<string, string>;
  enableAllProjectMcpServers?: boolean;
  permissions: { allow: string[]; deny: string[] };
  hooks: Record<string, unknown[]> & { PreToolUse: unknown[]; PostToolUse?: unknown[] };
}

/** The servers of an MCP file: `.agents/mcp_config.json`, built from the user's `.mcp.json`. */
export interface McpFile {
  mcpServers: Record<string, unknown>;
}

/** The `.vscode/tasks.json` task labels. */
export interface TasksFile {
  tasks: { label: string }[];
}

/** The stage dirs a render left under `root`. */
export function stagesIn(root: string): string[] {
  const dir = path.join(root, ".repo", "tmp");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.startsWith("stage-")) : [];
}

/** A consumer: a config, a package.json and `node_modules/@workerstack/repo` linked to this repo's root. */
export function consumer(files: Record<string, string> = {}): string {
  const root = tempDir("workerstack-trees-");
  put(root, "workerstack.config.ts", "export default {}\n");
  put(root, "package.json", JSON.stringify({ name: "fixture", scripts: { build: "tsc" } }));
  fs.mkdirSync(path.join(root, "node_modules", "@workerstack"), { recursive: true });
  fs.symlinkSync(SELF_ROOT, path.join(root, "node_modules", "@workerstack", "repo"), "dir");
  for (const [rel, text] of Object.entries(files)) put(root, rel, text);
  return root;
}

/** A context over the real files of `root` with `hosts` on. */
export function context(root: string, hosts: readonly Host[], options: RenderOptions = {}): SyncContext {
  return {
    root,
    config: {
      packs: ["agents"],
      agents: { hosts, skills: options.skills ?? [] },
      ...BASE_CONFIG,
    },
    workspace: {
      root,
      manifest: { name: "fixture" },
      packages: (options.packages ?? []).map((dir) => ({ dir, manifest: {} })),
    },
    read: (rel) => {
      try {
        return fs.readFileSync(path.join(root, rel), "utf8");
      } catch {
        return null;
      }
    },
  };
}

/** The outputs of a render that must succeed. */
export function render(root: string, hosts: readonly Host[], options: RenderOptions = {}): Output[] {
  const result = renderTrees(context(root, hosts, options));
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.outputs;
}

/** The output at `rel`. */
export function find(outputs: Output[], rel: string): Output | undefined {
  return outputs.find((output) => output.path === rel);
}

/** The content of the file output at `rel`. */
export function text(outputs: Output[], rel: string): string {
  const output = find(outputs, rel);
  if (output?.kind !== "file") throw new Error(`${rel} is not a file output`);
  return output.content;
}

/** The target of the link output at `rel`. */
export function linkTarget(outputs: Output[], rel: string): string | undefined {
  const output = find(outputs, rel);
  return output?.kind === "link" ? output.target : undefined;
}

/** The JSON file output at `rel`, read as the shape the caller names. */
export function json<T>(outputs: Output[], rel: string): T {
  return JSON.parse(text(outputs, rel)) /* the caller names the shape its generator writes */ as T;
}

/** The path of each output. */
export const paths = (outputs: Output[]): string[] => outputs.map((output) => output.path);
