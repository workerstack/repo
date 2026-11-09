import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { SKILL_PACKS } from "../config.ts";
import { emitAgentShellTools } from "../scripts/emit-agent-shell-tools.ts";
import { emitMcpPolicy } from "../scripts/emit-mcp-policy.ts";
import { applyUnion } from "../scripts/hooks-union.ts";
import { WORKSPACE_SKILLS_REL, STOCK_SKILLS_REL, listSkillDirNames } from "../scripts/skill-conflicts.ts";
import { renderTasks } from "../scripts/vscode-tasks.ts";
import { renderHooks } from "./agents/hooks.ts";
import { renderRules } from "./agents/rules.ts";
import { loadSources } from "./agents/sources.ts";
import { parseDoc } from "./agents/frontmatter.ts";
import { renderSubagents } from "./agents/subagents.ts";
import { isHostOutput } from "./hosts.ts";
import type { Output, SyncContext } from "./outputs.ts";
import { isSelfName, stockRoot } from "./stock.ts";

/** The outputs, or every problem found, one per entry. */
export type TreesResult = { ok: true; outputs: Output[] } | { ok: false; errors: string[] };

/** Several source problems at once, so a render reports each instead of the first. */
class Problems extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
  }
}

const STAGE_DIR_REL = ".repo/tmp";
const STAGE_PREFIX = "stage-";
const CLAUDE_SETTINGS_REL = ".claude/settings.json";
const CLAUDE_OVERLAY_REL = ".repo/settings/claude.json";
const MCP_REL = ".mcp.json";
const MCP_OVERLAY_REL = ".repo/mcp.json";
const CLAUDE_BASE_REL = "agents/settings/claude.json";
const TASKS_REL = ".vscode/tasks.json";
const OVERLAY_SKILLS_REL = ".repo/skills";
/** Each stock dir of static grok files, and the tree dir it is copied to. */
const STATIC_ROOTS = [
  ["agents/grok/roles", ".grok/roles"],
  ["agents/grok/hooks", ".grok/hooks"],
] as const;

/** `over` onto `base`: objects merge key by key, lists append what they lack, anything else is replaced. */
function mergeSettings(base: unknown, over: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(over)) {
    return [...base, ...over.filter((item) => !base.some((have) => isDeepStrictEqual(have, item)))];
  }
  if (isObject(base) && isObject(over)) {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(over)) merged[key] = key in base ? mergeSettings(base[key], value) : value;
    return merged;
  }
  return over;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Throws the step's error, so one handler reports a failed emit step like a failed generator. */
function must(step: string, result: { ok: boolean; error?: string }): void {
  if (!result.ok) throw new Error(`${step}: ${result.error}`);
}

/** Every file under `dir`, as POSIX paths relative to it. */
function filesUnder(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((rel) => rel.replaceAll("\\", "/"))
    .filter((rel) => fs.statSync(path.join(dir, rel)).isFile());
}

/** The stock files no generator writes: grok's roles and hook configs. */
function staticFiles(stock: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const [from, to] of STATIC_ROOTS) {
    for (const rel of filesUnder(path.join(stock, from))) files.set(`${to}/${rel}`, fs.readFileSync(path.join(stock, from, rel), "utf8"));
  }
  return files;
}

function posix(rel: string): string {
  return rel.split(path.sep).join("/");
}

/** The skill links for `hosts`: `.agents/skills` for codex and antigravity, `.claude/skills` for claude. */
function skillLinks(ctx: SyncContext, stock: string, self: boolean): Output[] {
  const { hosts, skills } = ctx.config.agents;
  const own = self ? [] : listSkillDirNames(path.join(ctx.root, OVERLAY_SKILLS_REL));
  const optional = new Set<string>(SKILL_PACKS.filter((pack) => !skills.includes(pack)));
  const stockNames = listSkillDirNames(path.join(stock, STOCK_SKILLS_REL)).filter((name) => !optional.has(name));
  const names = [...new Set([...stockNames, ...own])].sort();
  const sourceOf = (name: string) =>
    own.includes(name) ? path.join(ctx.root, OVERLAY_SKILLS_REL, name) : path.join(stock, STOCK_SKILLS_REL, name);
  const agentsDir = hosts.includes("codex") || hosts.includes("antigravity");
  const links: Output[] = [];
  const add = (dir: string, name: string, target: string) =>
    links.push({ kind: "link", path: `${dir}/${name}`, target, tracked: self, managed: "whole" });
  for (const name of names) {
    if (agentsDir) add(WORKSPACE_SKILLS_REL, name, posix(path.relative(path.join(ctx.root, WORKSPACE_SKILLS_REL), sourceOf(name))));
    if (hosts.includes("claude")) {
      const target = agentsDir && !self ? `../../${WORKSPACE_SKILLS_REL}/${name}` : posix(path.relative(path.join(ctx.root, ".claude/skills"), sourceOf(name)));
      add(".claude/skills", name, target);
    }
  }
  return links;
}

/**
 * A `.repo/skills/<name>` dir named like a stock skill must say `overrides: <name>` in its SKILL.md, and an
 * `overrides` must name a stock skill. A skill with a new name is asked for nothing.
 */
function skillProblems(ctx: SyncContext, stock: string): string[] {
  const own = listSkillDirNames(path.join(ctx.root, OVERLAY_SKILLS_REL));
  const all = new Set(listSkillDirNames(path.join(stock, STOCK_SKILLS_REL)));
  const optional = new Set<string>(SKILL_PACKS.filter((pack) => !ctx.config.agents.skills.includes(pack)));
  const problems: string[] = [];
  for (const name of own) {
    const rel = `${OVERLAY_SKILLS_REL}/${name}/SKILL.md`;
    let overrides: unknown;
    try {
      overrides = parseDoc(rel, fs.readFileSync(path.join(ctx.root, rel), "utf8")).data["overrides"];
    } catch {
      overrides = undefined;
    }
    if (typeof overrides === "string" && !all.has(overrides)) {
      problems.push(`${rel}: overrides "${overrides}" but no stock skill has that name`);
    } else if (all.has(name) && !optional.has(name) && overrides !== name) {
      problems.push(`${OVERLAY_SKILLS_REL}/${name}: a stock skill has this name; add \`overrides: ${name}\` to its SKILL.md or rename it`);
    }
  }
  return problems;
}

/** Deep-merges the overlay file `overlayRel` (when it exists) over the staged JSON file `rel`. */
function mergeOverlay(ctx: SyncContext, stage: string, rel: string, overlayRel: string): void {
  const overlay = ctx.read(overlayRel);
  if (overlay === null) return;
  let own: unknown;
  try {
    own = JSON.parse(overlay);
  } catch (error) {
    throw new Error(`${overlayRel}: ${(error as Error).message}`);
  }
  if (!isObject(own)) throw new Error(`${overlayRel}: must be a JSON object`);
  const file = path.join(stage, rel);
  const base: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, `${JSON.stringify(mergeSettings(base, own), null, 2)}\n`);
}

/** Fills the stage: rules, subagents and hooks, the emit steps, the claude overlay and the static files; returns its files. */
function fillStage(ctx: SyncContext, stage: string, stock: string, self: boolean): Map<string, string> {
  const { hosts } = ctx.config.agents;
  const loaded = loadSources({ stockRoot: stock, consumerRoot: self ? null : ctx.root });
  if (!loaded.ok) throw new Problems(loaded.problems);
  const { sources } = loaded;
  const claudeBase = fs.readFileSync(path.join(stock, CLAUDE_BASE_REL), "utf8");
  const generated = [renderRules(sources, hosts), renderSubagents(sources, hosts), renderHooks(sources, hosts, claudeBase)];
  for (const [rel, text] of generated.flatMap((files) => [...files])) {
    fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true });
    fs.writeFileSync(path.join(stage, rel), text);
  }

  must("mcp policy", emitMcpPolicy({ workspaceRoot: stage, sourceRoot: stock, consumerRoot: ctx.root }));
  if (hosts.includes("claude")) {
    must("scout tools", emitAgentShellTools({ workspaceRoot: stage, sourceRoot: stock }));
  }
  must("hooks", applyUnion({ workspaceRoot: stage, sourceRoot: stock, consumerRoot: ctx.root }));

  if (hosts.includes("claude")) {
    mergeOverlay(ctx, stage, CLAUDE_SETTINGS_REL, CLAUDE_OVERLAY_REL);
    mergeOverlay(ctx, stage, MCP_REL, MCP_OVERLAY_REL);
  }

  const files = new Map<string, string>();
  for (const rel of filesUnder(stage)) files.set(rel, fs.readFileSync(path.join(stage, rel), "utf8"));
  if (hosts.includes("grok")) for (const [rel, text] of staticFiles(stock)) files.set(rel, text);
  return files;
}

/**
 * Every generated agent tree for the enabled hosts as outputs, built in a fresh `.repo/tmp/stage-*` dir (removed again) from
 * the stock package plus the `.repo/` overlay. Nothing outside the stage is written. In a consumer the trees are
 * ignored (`tracked: false`); in this repo they are the committed trees; `.vscode/tasks.json` is committed in both.
 */
export function renderTrees(ctx: SyncContext): TreesResult {
  const { hosts } = ctx.config.agents;
  if (hosts.length === 0) return { ok: true, outputs: [] };
  const self = isSelfName(ctx.workspace.manifest.name);
  const stock = self ? ctx.root : stockRoot(ctx.root);
  if (!fs.existsSync(path.join(stock, "agents"))) {
    return { ok: false, errors: [`${path.relative(ctx.root, stock).split(path.sep).join("/")} is missing; run \`bun install\``] };
  }

  // One stage per call: processes rendering the same root at once (parallel test files, two syncs) must not clear each other's.
  fs.mkdirSync(path.join(ctx.root, STAGE_DIR_REL), { recursive: true });
  const stage = fs.mkdtempSync(path.join(ctx.root, STAGE_DIR_REL, STAGE_PREFIX));
  let result: TreesResult;
  try {
    result = { ok: true, outputs: assemble(ctx, stage, stock, self) };
  } catch (error) {
    result = { ok: false, errors: error instanceof Problems ? error.problems : [(error as Error).message] };
  }
  fs.rmSync(stage, { recursive: true, force: true });
  return result;
}

/** The stage's host files, the skill links and the tasks file, sorted by path. */
function assemble(ctx: SyncContext, stage: string, stock: string, self: boolean): Output[] {
  const { hosts } = ctx.config.agents;
  const outputs: Output[] = [];
  const problems = self ? [] : skillProblems(ctx, stock);
  let files = new Map<string, string>();
  try {
    files = fillStage(ctx, stage, stock, self);
  } catch (error) {
    if (!(error instanceof Problems)) throw error;
    problems.push(...error.problems);
  }
  if (problems.length > 0) throw new Problems(problems);
  for (const [rel, content] of files) {
    if (isHostOutput(hosts, rel)) outputs.push({ kind: "file", path: rel, content, tracked: self, managed: "whole" });
  }
  outputs.push(...skillLinks(ctx, stock, self));
  const tasks = renderTasks(ctx.root, ctx.read(TASKS_REL));
  if (!tasks.ok) throw new Error(tasks.error);
  outputs.push({ kind: "file", path: TASKS_REL, content: tasks.text, tracked: true, managed: "whole" });
  return outputs.sort((a, b) => Number(a.path > b.path) - Number(a.path < b.path));
}
