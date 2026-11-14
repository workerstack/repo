import fs from "node:fs";
import path from "node:path";

import { offSkills } from "../config.ts";
import { renderTasks } from "../scripts/vscode-tasks.ts";
import { agentsFile, isAgentsFile } from "./agents-file.ts";
import { loadSources } from "./agents/load-sources.ts";
import { renderRules, type RuleFile } from "./agents/rules.ts";
import type { Sources } from "./agents/sources.types.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import { listedFiles } from "./git-files.ts";
import { isHostOutput } from "./hosts.ts";
import type { Output, SyncContext } from "./outputs.ts";
import { repoDirProblems } from "./repo-dir.ts";
import { readStockHistory } from "./stock-history.ts";
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
function renderScopes(ctx: SyncContext, sources: Sources) {
  const { hosts, defaultEffort } = ctx.config.agents;
  const planned = new Map<string, RuleFile>();
  const clashes: string[] = [];

  for (const scope of ["", ...ctx.workspace.packages.map((pkg) => pkg.dir)]) {
    for (const [rel, file] of renderRules(sources.rules, { effort: defaultEffort, hosts, scope })) {
      const first = planned.get(rel);

      if (first === undefined) planned.set(rel, file);
      else clashes.push(`${rel}: planned by ${first.source} and ${file.source}; rename one`);
    }
  }

  return { clashes, files: new Map([...planned].map(([rel, file]) => [rel, file.text])) };
}

/** The loaded sources and their rule files; throws every problem of the `.repo/` dir and the sources at once. */
function checkedSources(ctx: SyncContext, render: Render) {
  const packages = ctx.workspace.packages.map((pkg) => pkg.dir);

  const { sources, problems: loadProblems } = loadSources({
    consumerRoot: render.self ? null : ctx.root,
    packages,
    stockRoot: render.stock,
  });

  // The checks run on the docs that loaded, so one bad file does not hide the problems of the others.
  const rules = renderScopes(ctx, sources);
  const listed = listedFiles(ctx.root, []);
  const off = offSkills(ctx.config);

  const problems = [
    ...repoDirProblems(ctx.root, { listed, off, packages, sources, stock: render.stock }),
    ...loadProblems,
    ...rules.clashes,
  ];

  if (problems.length > 0) throw new TreesProblems(problems);

  return { rules: rules.files, sources };
}

/**
 * The stage's host files (each `AGENTS.md` its shared form over the file on disk), the skill links and the tasks file,
 * sorted by path.
 */
function assemble(ctx: SyncContext, render: Render): Output[] {
  const { hosts } = ctx.config.agents;
  const { self } = render;
  const outputs: Output[] = [];
  const files = fillStage(ctx, { dir: render.stage, stock: render.stock, ...checkedSources(ctx, render) });
  const history = readStockHistory();

  for (const [rel, content] of files) {
    if (!isHostOutput(hosts, rel)) continue;

    if (isAgentsFile(rel)) outputs.push(agentsFile(rel, content, { history, text: ctx.read(rel) }));
    else outputs.push({ content, kind: "file", managed: "whole", path: rel, tracked: self });
  }

  outputs.push(...skillLinks(ctx, render.stock, { self }), ...packageSkillLinks(ctx, { self }));
  const tasks = renderTasks(ctx.root, ctx.read(TASKS_REL));

  if (!tasks.ok) throw new Error(tasks.error);
  outputs.push({ content: tasks.text, kind: "file", managed: "whole", path: TASKS_REL, tracked: true });

  return outputs.toSorted((a, b) => byCodeUnit(a.path, b.path));
}

/**
 * Every generated agent tree for the enabled hosts as outputs, built in a fresh `.repo/tmp/stage-*` dir (removed
 * again) from the stock package plus the `.repo/` overlay. Nothing outside the stage is written. In a consumer the
 * trees are ignored (`tracked: false`); in this repo they are the committed trees; `.vscode/tasks.json` is committed
 * in both.
 * Each `AGENTS.md` is a tracked shared file in both: sync writes only its `repo:rules` region.
 */
export function renderTrees(ctx: SyncContext): TreesResult {
  const { hosts } = ctx.config.agents;

  if (hosts.length === 0) return { ok: true, outputs: [] };
  const self = isSelfName(ctx.workspace.manifest.name);
  const stock = self ? ctx.root : stockRoot(ctx.root);

  if (!fs.existsSync(path.join(stock, "agents"))) {
    return {
      errors: [`${path.relative(ctx.root, stock).split(path.sep).join("/")} is missing; run \`bun install\``],
      ok: false,
    };
  }

  // One stage per call: processes rendering the same root at once (parallel test files, two syncs) must not clear
  // each other's.
  fs.mkdirSync(path.join(ctx.root, STAGE_DIR_REL), { recursive: true });
  const stage = fs.mkdtempSync(path.join(ctx.root, STAGE_DIR_REL, STAGE_PREFIX));
  let result: TreesResult;

  try {
    result = { ok: true, outputs: assemble(ctx, { self, stage, stock }) };
  } catch (error) {
    const errors =
      error instanceof TreesProblems ? error.problems : [(error /* every step throws an Error */ as Error).message];

    result = { errors, ok: false };
  }

  fs.rmSync(stage, { force: true, recursive: true });

  return result;
}
