import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { emitAgentShellTools } from "../scripts/emit-agent-shell-tools.ts";
import { emitMcpPolicy } from "../scripts/emit-mcp-policy.ts";
import { expandHookCommand } from "../scripts/hook-command.ts";
import { applyUnion } from "../scripts/hooks-union.ts";
import { renderHooks } from "./agents/hooks.ts";
import type { Sources } from "./agents/sources.ts";
import { renderSubagents } from "./agents/subagents.ts";
import type { SyncContext } from "./outputs.ts";

/** One render's stage: its dir, the stock package, the loaded sources and the rendered rule files. */
export type Stage = { dir: string; stock: string; sources: Sources; rules: Map<string, string> };

const CLAUDE_SETTINGS_REL = ".claude/settings.json";
const CLAUDE_OVERLAY_REL = ".repo/settings/claude.json";
const CLAUDE_BASE_REL = "agents/settings/claude.json";
const JSON_INDENT = 2;
/** Each stock dir of static grok files, and the tree dir it is copied to. */
const STATIC_ROOTS = [
  ["agents/grok/roles", ".grok/roles"],
  ["agents/grok/hooks", ".grok/hooks"],
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `over` onto `base`: objects merge key by key, lists append what they lack, anything else is replaced. */
function mergeSettings(base: unknown, over: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(over))
    return [...base, ...over.filter((item) => !base.some((have) => isDeepStrictEqual(have, item)))];

  if (isObject(base) && isObject(over)) {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(over))
      merged[key] = key in base ? mergeSettings(base[key], value) : value;
    return merged;
  }
  return over;
}

/** Throws the step's error, so one handler reports a failed emit step like a failed generator. */
function must(step: string, result: { ok: boolean; error?: string }): void {
  if (!result.ok) throw new Error(`${step}: ${result.error}`);
}

/** Every file under `dir`, as POSIX paths relative to it. */
function filesUnder(dir: string): string[] {
  return fs
    .readdirSync(dir, { encoding: "utf8", recursive: true })
    .map((rel) => rel.replaceAll("\\", "/"))
    .filter((rel) => fs.statSync(path.join(dir, rel)).isFile());
}

/** The stock files no generator writes: grok's roles and hook configs. */
function staticFiles(stock: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const [from, to] of STATIC_ROOTS) {
    for (const rel of filesUnder(path.join(stock, from))) {
      const text = fs.readFileSync(path.join(stock, from, rel), "utf8");
      files.set(
        `${to}/${rel}`,
        text.replaceAll(
          /("command": )("repo hook [\w-]+")/g,
          (_: string, key: string, value: string) => key + JSON.stringify(expandHookCommand(String(JSON.parse(value)))),
        ),
      );
    }
  }
  return files;
}

/** Deep-merges the overlay file `overlayRel` (when it exists) over the staged JSON file `file`. */
function mergeOverlay(ctx: SyncContext, file: string, overlayRel: string): void {
  const overlay = ctx.read(overlayRel);
  if (overlay === null) return;
  let own: unknown;
  try {
    own = JSON.parse(overlay);
  } catch (error) {
    throw new Error(`${overlayRel}: ${(error /* JSON.parse throws a SyntaxError */ as Error).message}`, {
      cause: error,
    });
  }
  if (!isObject(own)) throw new Error(`${overlayRel}: must be a JSON object`);
  const base: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, `${JSON.stringify(mergeSettings(base, own), null, JSON_INDENT)}\n`);
}

/** Runs the emit steps and the claude settings overlay merge on the stage. */
function emitSteps(ctx: SyncContext, stage: Stage): void {
  const { hosts } = ctx.config.agents;
  const roots = { sourceRoot: stage.stock, workspaceRoot: stage.dir };
  must("mcp policy", emitMcpPolicy({ ...roots, consumerRoot: ctx.root }));
  if (hosts.includes("claude")) must("scout tools", emitAgentShellTools(roots));

  must("hooks", applyUnion({ ...roots, consumerRoot: ctx.root }));

  if (hosts.includes("claude")) mergeOverlay(ctx, path.join(stage.dir, CLAUDE_SETTINGS_REL), CLAUDE_OVERLAY_REL);
}

/** Fills the stage: rules, subagents and hooks, the emit steps, the claude overlay and the static files; returns its files. */
export function fillStage(ctx: SyncContext, stage: Stage): Map<string, string> {
  const { hosts } = ctx.config.agents;
  const claudeBase = fs.readFileSync(path.join(stage.stock, CLAUDE_BASE_REL), "utf8");
  const generated = [stage.rules, renderSubagents(stage.sources, hosts), renderHooks(stage.sources, hosts, claudeBase)];
  for (const [rel, text] of generated.flatMap((files) => [...files])) {
    fs.mkdirSync(path.dirname(path.join(stage.dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(stage.dir, rel), text);
  }
  emitSteps(ctx, stage);

  const files = new Map<string, string>();
  for (const rel of filesUnder(stage.dir)) files.set(rel, fs.readFileSync(path.join(stage.dir, rel), "utf8"));
  if (hosts.includes("grok")) for (const [rel, text] of staticFiles(stage.stock)) files.set(rel, text);
  return files;
}
