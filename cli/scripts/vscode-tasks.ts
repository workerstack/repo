#!/usr/bin/env bun
/**
 * Write .vscode/tasks.json from package scripts (VS Code and Cursor: Tasks: Run Task).
 *
 * One `bun run <script>` shell task per root script, and one per script of every workspace package (root
 * `package.json` `workspaces` globs), labelled `<scope>:<name>:<script>` with a `${workspaceFolder}` cwd.
 * A task `isGenerated` rejects (hand-written, extra args, `dependsOn`) is kept, in order, after the generated block.
 */
import fs from "node:fs";
import path from "node:path";

import { stamp } from "../sync/header.ts";
import { OWNED_MODE } from "../sync/write.constants.ts";
import { writeOwned } from "../sync/write.ts";
import { isRecord } from "./hook-input.ts";
import { stripJsonc } from "./jsonc.ts";
import { resolveRoots } from "./workspace-root.ts";

const TASKS_REL = ".vscode/tasks.json";
const PRESENTATION = { panel: "new", reveal: "always" };

/** A tasks.json entry; hand-written ones may carry any other field. */
export interface VsTask {
  label?: string;
  type?: string;
  command?: string;
  dependsOn?: unknown;
  options?: { cwd?: string };
  problemMatcher?: unknown[];
  presentation?: { panel: string; reveal: string };
  [key: string]: unknown;
}

export interface TasksFile {
  tasks: VsTask[];
  version: string;
}

type PackageJson = Record<string, unknown>;
const RUN_RE = /^bun run \S+$/;

/** True for a task this script writes: a plain `bun run <script>` shell task with no `dependsOn`. */
export function isGenerated(task: VsTask | null | undefined): boolean {
  return task != null && task.type === "shell" && !task.dependsOn && RUN_RE.test(String(task.command));
}

const slash = (p: string): string => p.split(path.sep).join("/");

function readPackage(file: string): PackageJson | null {
  try {
    const pkg: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return isRecord(pkg) ? pkg : null;
  } catch {
    return null;
  }
}

function globDirs(root: string, pattern: string): string[] {
  const hits = fs.globSync(pattern, {
    cwd: root,
    exclude: (entry: string) => path.basename(entry) === "node_modules",
  });
  return hits.filter((hit) => !slash(hit).split("/").includes("node_modules")).map((hit) => path.join(root, hit));
}

function workspaceDirs(root: string, pkg: PackageJson): string[] {
  const ws: unknown = Array.isArray(pkg.workspaces)
    ? pkg.workspaces
    : isRecord(pkg.workspaces)
      ? pkg.workspaces.packages
      : undefined;
  const patterns = (Array.isArray(ws) ? ws : []).filter((p): p is string => typeof p === "string");
  const dropped = new Set(patterns.filter((p) => p.startsWith("!")).flatMap((p) => globDirs(root, p.slice(1))));
  const dirs = new Set(patterns.filter((p) => !p.startsWith("!")).flatMap((p) => globDirs(root, p)));
  return [...dirs]
    .filter((dir) => !dropped.has(dir) && path.relative(root, dir) !== "")
    .filter((dir) => fs.existsSync(path.join(dir, "package.json")))
    .sort();
}

/** `@acme/api` -> `acme:api`; `api` -> `api`. */
function labelPrefix(name: string): string {
  return name.replace(/^@/, "").replace(/\//g, ":");
}

function shellTask(label: string, script: string, cwd?: string): VsTask {
  return {
    label,
    type: "shell",
    command: `bun run ${script}`,
    ...(cwd ? { options: { cwd } } : {}),
    problemMatcher: [],
    presentation: { ...PRESENTATION },
  };
}

function scriptsOf(pkg: PackageJson): string[] {
  return isRecord(pkg.scripts) ? Object.keys(pkg.scripts) : [];
}

/**
 * @param root checkout root holding the package.json
 * @param existing the tasks array of the current tasks.json
 * @returns generated tasks sorted by label, then the kept ones in their order
 */
export function buildTasks(root: string, existing: VsTask[]): TasksFile {
  const pkg = readPackage(path.join(root, "package.json")) ?? {};
  const kept = existing.filter((task) => !isGenerated(task));
  const taken = new Set(kept.map((task) => task.label));
  const generated = new Map<string, VsTask>();
  const add = (label: string, task: VsTask): void => {
    if (taken.has(label)) return;
    taken.add(label);
    generated.set(label, task);
  };
  for (const script of scriptsOf(pkg)) add(script, shellTask(script, script));
  for (const dir of workspaceDirs(root, pkg)) {
    const workspace = readPackage(path.join(dir, "package.json"));
    if (!workspace || typeof workspace.name !== "string" || !workspace.name) continue;
    const cwd = `\${workspaceFolder}/${slash(path.relative(root, dir))}`;
    for (const script of scriptsOf(workspace)) {
      const label = `${labelPrefix(workspace.name)}:${script}`;
      add(label, shellTask(label, script, cwd));
    }
  }
  // Labels are unique in `generated`, so two never compare equal.
  const sorted = [...generated].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, task]) => task);
  return { tasks: [...sorted, ...kept], version: "2.0.0" };
}

export type RenderedTasks = { ok: true; text: string; generated: number; kept: number } | { ok: false; error: string };

/**
 * The text of `.vscode/tasks.json` for `root`: the generated tasks, then the ones kept from `existing` (the
 * current file's text, null when there is none).
 */
export function renderTasks(root: string, existing: string | null): RenderedTasks {
  let tasks: VsTask[] = [];
  if (existing !== null) {
    try {
      const parsed: unknown = JSON.parse(stripJsonc(existing));
      if (isRecord(parsed) && Array.isArray(parsed.tasks)) tasks = parsed.tasks.filter(isRecord);
    } catch (err) {
      return {
        error: `cannot parse ${TASKS_REL}: ${(err /* JSON.parse and stripJsonc throw only Error */ as Error).message}`,
        ok: false,
      };
    }
  }
  const result = buildTasks(root, tasks);
  const kept = result.tasks.filter((task) => !isGenerated(task)).length;
  return { generated: result.tasks.length - kept, kept, ok: true, text: `${JSON.stringify(result, null, 2)}\n` };
}

/** Writes `.vscode/tasks.json` under `root`, stamped and read-only as sync leaves it; prints the count line; returns the exit code. */
export function run(root: string): number {
  const written = writeTasks(root, path.join(root, TASKS_REL));
  if (typeof written === "string") {
    console.error(`tasks: ${written}`);
    return 1;
  }
  console.log(
    `Wrote ${written.generated + written.kept} tasks to ${TASKS_REL} (${written.generated} generated, ${written.kept} kept)`,
  );
  return 0;
}

/** Renders the tasks file at `file` and writes it; the task counts, or the error line. */
function writeTasks(root: string, file: string): { generated: number; kept: number } | string {
  const pkgFile = path.join(root, "package.json");
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const rendered = renderTasks(root, current);
  if (!rendered.ok) return rendered.error.replace(TASKS_REL, file);
  if (!readPackage(pkgFile)) return `cannot read ${pkgFile}`;
  const error = writeOwned(file, stamp(TASKS_REL, rendered.text), OWNED_MODE);
  return error === null ? rendered : `cannot write ${file}: ${error}`;
}

export function main(): number {
  return run(resolveRoots().checkout);
}
