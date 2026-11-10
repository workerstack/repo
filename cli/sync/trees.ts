import fs from "node:fs";
import path from "node:path";
import { renderTasks } from "../scripts/vscode-tasks.ts";
import { renderRules, type RuleFile } from "./agents/rules.ts";
import { loadSources, type Sources } from "./agents/sources.ts";
import { listedFiles } from "./git-files.ts";
import { isHostOutput } from "./hosts.ts";
import type { Output, SyncContext } from "./outputs.ts";
import { repoDirProblems } from "./repo-dir.ts";
import { isSelfName, stockRoot } from "./stock.ts";
import { packageSkillLinks, skillLinks } from "./trees-links.ts";
import { TreesProblems } from "./trees-problems.ts";
import { fillStage } from "./trees-stage.ts";

/** The outputs, or every problem found, one per entry. */
export type TreesResult = { ok: true; outputs: Output[] } | { ok: false; errors: string[] };

/** Where one render reads and stages: the stage dir, the stock package, and whether the root is this package. */
type Render = { stage: string; stock: string; self: boolean };

const STAGE_DIR_REL = ".repo/tmp";
const STAGE_PREFIX = "stage-";
const TASKS_REL = ".vscode/tasks.json";

/**
 * The rule files of the root and of every workspace package, each scope rendered on its own so no package rule folds
 * into the root `AGENTS.md`, and one problem line for each path two scopes plan.
 */
function renderScopes(ctx: SyncContext, sources: Sources): { files: Map<string, string>; clashes: string[] } {
  const { hosts } = ctx.config.agents;
  const planned = new Map<string, RuleFile>();
  const clashes: string[] = [];
  for (const scope of ["", ...ctx.workspace.packages.map((pkg) => pkg.dir)]) {
    for (const [rel, file] of renderRules(sources.rules, hosts, scope)) {
      const first = planned.get(rel);
      if (first === undefined) planned.set(rel, file);
      else clashes.push(`${rel}: planned by ${first.source} and ${file.source}; rename one`);
    }
  }
  return { files: new Map([...planned].map(([rel, file]) => [rel, file.text])), clashes };
}

/** The loaded sources and their rule files; throws every problem of the `.repo/` dir and the sources at once. */
function checkedSources(ctx: SyncContext, render: Render): { sources: Sources; rules: Map<string, string> } {
  const packages = ctx.workspace.packages.map((pkg) => pkg.dir);
  const { sources, problems: loadProblems } = loadSources({
    stockRoot: render.stock,
    consumerRoot: render.self ? null : ctx.root,
    packages,
  });
  // The checks run on the docs that loaded, so one bad file does not hide the problems of the others.
  const rules = renderScopes(ctx, sources);
  const listed = listedFiles(ctx.root, []);
  const { skills } = ctx.config.agents;
  const problems = [
    ...repoDirProblems(ctx.root, { sources, stock: render.stock, listed, skills, packages }),
    ...loadProblems,
    ...rules.clashes,
  ];
  if (problems.length > 0) throw new TreesProblems(problems);
  return { sources, rules: rules.files };
}

/** The stage's host files, the skill links and the tasks file, sorted by path. */
function assemble(ctx: SyncContext, render: Render): Output[] {
  const { hosts } = ctx.config.agents;
  const { self } = render;
  const outputs: Output[] = [];
  const files = fillStage(ctx, { dir: render.stage, stock: render.stock, ...checkedSources(ctx, render) });
  for (const [rel, content] of files) {
    if (isHostOutput(hosts, rel)) outputs.push({ kind: "file", path: rel, content, tracked: self, managed: "whole" });
  }
  outputs.push(...skillLinks(ctx, render.stock, self), ...packageSkillLinks(ctx, self));
  const tasks = renderTasks(ctx.root, ctx.read(TASKS_REL));
  if (!tasks.ok) throw new Error(tasks.error);
  outputs.push({ kind: "file", path: TASKS_REL, content: tasks.text, tracked: true, managed: "whole" });
  return outputs.sort((a, b) => Number(a.path > b.path) - Number(a.path < b.path));
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
    return {
      ok: false,
      errors: [`${path.relative(ctx.root, stock).split(path.sep).join("/")} is missing; run \`bun install\``],
    };
  }

  // One stage per call: processes rendering the same root at once (parallel test files, two syncs) must not clear each other's.
  fs.mkdirSync(path.join(ctx.root, STAGE_DIR_REL), { recursive: true });
  const stage = fs.mkdtempSync(path.join(ctx.root, STAGE_DIR_REL, STAGE_PREFIX));
  let result: TreesResult;
  try {
    result = { ok: true, outputs: assemble(ctx, { stage, stock, self }) };
  } catch (error) {
    const errors =
      error instanceof TreesProblems ? error.problems : [(error /* every step throws an Error */ as Error).message];
    result = { ok: false, errors };
  }
  fs.rmSync(stage, { recursive: true, force: true });
  return result;
}
