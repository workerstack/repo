import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { SKILL_PACKS, type Host } from "../config.ts";
import { emitAgentShellTools } from "../../.rulesync/scripts/emit-agent-shell-tools.ts";
import { emitMcpPolicy } from "../../.rulesync/scripts/emit-mcp-policy.ts";
import { applyUnion } from "../../.rulesync/scripts/hooks-union.ts";
import { SKILLS_SOURCE_REL, listSkillDirNames } from "../../.rulesync/scripts/skill-conflicts.ts";
import { renderTasks } from "../../.rulesync/scripts/vscode-tasks.ts";
import { spawnSync } from "../spawn.ts";
import { HOST_TREES, isHostOutput } from "./hosts.ts";
import type { Output, SyncContext } from "./outputs.ts";
import { isSelfName, stockRoot } from "./stock.ts";

export type TreesResult = { ok: true; outputs: Output[] } | { ok: false; error: string };
export type RulesyncBin = { ok: true; bin: string } | { ok: false; error: string };
/** Seam for tests: where the rulesync bin is looked up, given the real path of the stock package. */
export type TreesDeps = { rulesyncBin?: (stockReal: string) => RulesyncBin };

const STAGE_REL = ".repo/tmp/stage";
const INPUTS_REL = ".repo/tmp/inputs";
const OVERLAY_REL = ".repo";
const CLAUDE_SETTINGS_REL = ".claude/settings.json";
const CLAUDE_OVERLAY_REL = ".repo/settings/claude.json";
const MCP_REL = ".mcp.json";
const MCP_OVERLAY_REL = ".repo/mcp.json";
const CLAUDE_BASE_REL = ".rulesync/settings/claude.json";
const TASKS_REL = ".vscode/tasks.json";
const OVERLAY_SKILLS_REL = ".repo/skills";
const STATIC_ROOTS = [".grok/roles", ".grok/hooks"] as const;

type Calls = { feature: string; targets: readonly string[] }[];

/**
 * The rulesync calls for `hosts`: the three features of the old generate chain, each over only the targets that
 * feature ever ran for. Rules always include codexcli, whose AGENTS.md is the one every host reads; it goes last,
 * because the last target to write AGENTS.md wins and only codexcli folds the overlay's non-root rules into it.
 */
function rulesyncCalls(hosts: readonly Host[]): Calls {
  const enabled = new Set(hosts.map((host) => HOST_TREES[host].target));
  const pick = (targets: readonly string[]) => targets.filter((target) => enabled.has(target));
  return [
    { feature: "rules", targets: [...pick(["antigravity-cli", "grokcli"]), "codexcli"] },
    { feature: "subagents", targets: pick(["claudecode", "codexcli", "antigravity-cli", "grokcli", "cursor"]) },
    { feature: "hooks", targets: pick(["claudecode", "codexcli", "antigravity-cli", "cursor"]) },
  ].filter((call) => call.targets.length > 0);
}

/**
 * The rulesync bin the stock package depends on, found the way node finds a dependency: the nearest
 * `node_modules/rulesync` at or above `stockReal`, the stock package's real path.
 */
export function rulesyncBin(stockReal: string, dir: string = stockReal): RulesyncBin {
  const manifest = path.join(dir, "node_modules", "rulesync", "package.json");
  if (fs.existsSync(manifest)) return binOf(path.dirname(manifest), manifest);
  const parent = path.dirname(dir);
  if (parent === dir) return { ok: false, error: `rulesync is not installed for ${stockReal}; run \`bun install\`` };
  return rulesyncBin(stockReal, parent);
}

function binOf(dir: string, manifest: string): RulesyncBin {
  let bin: unknown;
  try {
    bin = (JSON.parse(fs.readFileSync(manifest, "utf8")) as { bin?: { rulesync?: unknown } }).bin?.rulesync;
  } catch {
    return { ok: false, error: `rulesync: cannot read ${manifest}` };
  }
  if (typeof bin !== "string") return { ok: false, error: `rulesync: ${manifest} has no bin` };
  return { ok: true, bin: path.join(dir, bin) };
}

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

/** Throws the step's error, so one handler reports a failed emit step like a failed rulesync call. */
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

/** The stock files no generator writes: grok's roles and hook configs. Hook scripts stay in the package. */
function staticFiles(stock: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const dir of STATIC_ROOTS) {
    for (const rel of filesUnder(path.join(stock, dir))) {
      if (dir === ".grok/hooks" && (!rel.endsWith(".json") || rel === "package.json")) continue;
      files.set(`${dir}/${rel}`, fs.readFileSync(path.join(stock, dir, rel), "utf8"));
    }
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
  const stockNames = listSkillDirNames(path.join(stock, SKILLS_SOURCE_REL)).filter((name) => !optional.has(name));
  const names = [...new Set([...stockNames, ...own])].sort();
  const sourceOf = (name: string) =>
    own.includes(name) ? path.join(ctx.root, OVERLAY_SKILLS_REL, name) : path.join(stock, SKILLS_SOURCE_REL, name);
  const agentsDir = hosts.includes("codex") || hosts.includes("antigravity");
  const links: Output[] = [];
  const add = (dir: string, name: string, target: string) =>
    links.push({ kind: "link", path: `${dir}/${name}`, target, tracked: self });
  for (const name of names) {
    if (agentsDir && !self) add(SKILLS_SOURCE_REL, name, posix(path.relative(path.join(ctx.root, SKILLS_SOURCE_REL), sourceOf(name))));
    if (hosts.includes("claude")) {
      const target = agentsDir || self ? `../../${SKILLS_SOURCE_REL}/${name}` : posix(path.relative(path.join(ctx.root, ".claude/skills"), sourceOf(name)));
      add(".claude/skills", name, target);
    }
  }
  return links;
}

/** Runs one rulesync call in the stage; the error names the command and shows what rulesync said. */
function runRulesync(bin: string, stage: string, inputs: readonly string[], call: Calls[number]): void {
  const label = `rulesync generate -t ${call.targets.join(",")} -f ${call.feature}`;
  const args = [bin, "generate", "--input-roots", ...inputs, "-o", stage, "-t", call.targets.join(","), "-f", call.feature];
  const run = spawnSync(process.execPath, args, { cwd: stage, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`\`${label}\` failed: ${`${run.stdout}${run.stderr}`.trim()}`);
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

/**
 * A rule that targets `agentsmd` is meant for AGENTS.md, which every host reads and which only the codexcli target
 * folds rules into, so its target becomes `codexcli` too; nothing runs the `agentsmd` target. Other targets stay.
 */
export function retargetRule(text: string): string {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (front === null) return text;
  const head = front[1]!;
  const key = /^targets:[^\n]*(?:\n[ \t]+-[^\n]*)*/m.exec(head);
  if (key === null || !/\bagentsmd\b/.test(key[0]) || /\bcodexcli\b/.test(key[0])) return text;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  let fixed: string;
  if (/^targets:[ \t]*\[/.test(key[0])) fixed = key[0].replace(/(["']?)agentsmd\1/, "$&, codexcli");
  else if (/^targets:[ \t]*\S/.test(key[0])) fixed = "targets: [agentsmd, codexcli]";
  else fixed = key[0].replace(/^([ \t]+)-[ \t]*(["']?)agentsmd\2[^\r\n]*/m, `$&${eol}$1- codexcli`);
  return text.slice(0, front.index + front[0].indexOf(head)) + head.replace(key[0], () => fixed) + text.slice(front.index + front[0].indexOf(head) + head.length);
}

/**
 * The overlay rulesync reads as an input root: `.repo/` itself, or, when a rule there targets `agentsmd`, a copy in
 * `.repo/tmp/inputs` with that rule retargeted.
 */
function overlayInput(ctx: SyncContext): string {
  const overlay = path.join(ctx.root, OVERLAY_REL);
  const rules = path.join(overlay, "rules");
  const names = fs.existsSync(rules) ? fs.readdirSync(rules).filter((name) => name.endsWith(".md")) : [];
  const retargeted = names.filter((name) => retargetRule(fs.readFileSync(path.join(rules, name), "utf8")) !== fs.readFileSync(path.join(rules, name), "utf8"));
  if (retargeted.length === 0) return overlay;
  const copy = path.join(ctx.root, INPUTS_REL);
  fs.rmSync(copy, { recursive: true, force: true });
  fs.mkdirSync(copy, { recursive: true });
  for (const name of fs.readdirSync(overlay).filter((entry) => entry !== "tmp" && entry !== "lessons")) {
    fs.cpSync(path.join(overlay, name), path.join(copy, name), { recursive: true });
  }
  for (const name of retargeted) {
    const file = path.join(copy, "rules", name);
    fs.writeFileSync(file, retargetRule(fs.readFileSync(file, "utf8")));
  }
  return copy;
}

/** Fills the stage: rulesync, the emit steps, the claude overlay, the static files and the tasks; returns its files. */
function fillStage(ctx: SyncContext, stage: string, stock: string, bin: string): Map<string, string> {
  const { hosts } = ctx.config.agents;
  const inputs = [path.join(stock, ".rulesync"), overlayInput(ctx)];
  // Rulesync merges its hooks into an existing settings file, so the stock's own keys go in first and keep their place.
  if (hosts.includes("claude")) {
    fs.mkdirSync(path.join(stage, ".claude"), { recursive: true });
    fs.copyFileSync(path.join(stock, CLAUDE_BASE_REL), path.join(stage, CLAUDE_SETTINGS_REL));
  }
  for (const call of rulesyncCalls(hosts)) runRulesync(bin, stage, inputs, call);

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
 * Every generated agent tree for the enabled hosts as outputs, built in `.repo/tmp/stage/` (removed again) from
 * the stock package plus the `.repo/` overlay. Nothing outside the stage is written. In a consumer the trees are
 * ignored (`tracked: false`); in this repo they are the committed trees; `.vscode/tasks.json` is committed in both.
 */
export function renderTrees(ctx: SyncContext, deps: TreesDeps = {}): TreesResult {
  const { hosts } = ctx.config.agents;
  if (hosts.length === 0) return { ok: true, outputs: [] };
  const self = isSelfName(ctx.workspace.manifest.name);
  const stock = self ? ctx.root : stockRoot(ctx.root);
  if (!fs.existsSync(path.join(stock, ".rulesync"))) {
    return { ok: false, error: `${path.relative(ctx.root, stock).split(path.sep).join("/")} is missing; run \`bun install\`` };
  }
  const bin = (deps.rulesyncBin ?? rulesyncBin)(fs.realpathSync(stock));
  if (!bin.ok) return bin;

  const stage = path.join(ctx.root, STAGE_REL);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  let result: TreesResult;
  try {
    result = { ok: true, outputs: assemble(ctx, stage, stock, bin.bin, self) };
  } catch (error) {
    result = { ok: false, error: (error as Error).message };
  }
  fs.rmSync(stage, { recursive: true, force: true });
  fs.rmSync(path.join(ctx.root, INPUTS_REL), { recursive: true, force: true });
  return result;
}

/** The stage's host files, the skill links and the tasks file, sorted by path. */
function assemble(ctx: SyncContext, stage: string, stock: string, bin: string, self: boolean): Output[] {
  const { hosts } = ctx.config.agents;
  const outputs: Output[] = [];
  for (const [rel, content] of fillStage(ctx, stage, stock, bin)) {
    if (isHostOutput(hosts, rel)) outputs.push({ kind: "file", path: rel, content, tracked: self });
  }
  outputs.push(...skillLinks(ctx, stock, self));
  const tasks = renderTasks(ctx.root, ctx.read(TASKS_REL));
  if (!tasks.ok) throw new Error(tasks.error);
  outputs.push({ kind: "file", path: TASKS_REL, content: tasks.text, tracked: true });
  return outputs.sort((a, b) => Number(a.path > b.path) - Number(a.path < b.path));
}
