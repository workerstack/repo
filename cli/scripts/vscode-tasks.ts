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

import { z } from "zod";

import { type Json, readJson, tryJson } from "../json.ts";
import { packageJsonSchema } from "../package-json.ts";
import type { Result } from "../result.ts";
import { errorMessage } from "../sync-errors.ts";
import { byCodeUnit } from "../sync/by-code-unit.ts";
import { stamp } from "../sync/header.ts";
import { OWNED_MODE } from "../sync/write.constants.ts";
import { writeOwned } from "../sync/write.ts";
import { MODULES_DIR } from "./lint.constants.ts";
import { stripJsonc } from "./strip-jsonc.ts";
import { JSON_INDENT, SHELL_TYPE, TASKS_VERSION } from "./vscode-tasks.constants.ts";
import { resolveRoots } from "./workspace-root.ts";

const TASKS_REL = ".vscode/tasks.json";
const PRESENTATION = { panel: "new", reveal: "always" };

/** A tasks.json entry; hand-written ones may carry any other field. */
export type VsTask = {
  label?: string;
  type?: string;
  command?: string;
  dependsOn?: Json;
  options?: { cwd?: string };
  problemMatcher?: Json[];
  presentation?: { panel: string; reveal: string };
  [key: string]: Json | undefined;
};

export type TasksFile = {
  tasks: VsTask[];
  version: string;
};

/** The slice of a package.json the tasks come from: its name, scripts and workspace globs in either form. */
function packageSchema() {
  const globs = z.array(z.string());

  return packageJsonSchema.pick({ name: true, scripts: true }).extend({
    workspaces: z.union([globs, z.looseObject({ packages: globs.optional() })]).optional(),
  });
}

type PackageJson = z.output<ReturnType<typeof packageSchema>>;

/** A tasks.json: its tasks that are objects; a file with no tasks array has none. */
function tasksFileSchema() {
  const task = z.record(z.string(), z.json()).nullable().catch(null);

  return z.looseObject({ tasks: z.array(task).catch([]) }).catch({ tasks: [] });
}

const RUN_RE = /^bun run \S+$/;
const SCOPE_AT = /^@/;

/** True for a task this script writes: a plain `bun run <script>` shell task with no `dependsOn`. */
export function isGenerated(task: VsTask | null | undefined): boolean {
  return (
    task != null &&
    task.type === SHELL_TYPE &&
    (task.dependsOn == null || task.dependsOn === "") &&
    RUN_RE.test(String(task.command))
  );
}

function slash(p: string): string {
  return p.split(path.sep).join("/");
}

function readPackage(file: string): PackageJson | null {
  try {
    return tryJson(packageSchema(), fs.readFileSync(file, "utf8")) ?? null;
  } catch {
    return null;
  }
}

function globDirs(root: string, pattern: string): string[] {
  const hits = fs.globSync(pattern, {
    cwd: root,
    exclude: (entry: string) => path.basename(entry) === MODULES_DIR,
  });

  return hits.filter((hit) => !slash(hit).split("/").includes(MODULES_DIR)).map((hit) => path.join(root, hit));
}

/** The `workspaces` globs of `pkg`: the array form, or the object form's `packages`. */
function workspaceGlobs(pkg: PackageJson): string[] {
  const ws = pkg.workspaces;

  return Array.isArray(ws) ? ws : (ws?.packages ?? []);
}

function workspaceDirs(root: string, pkg: PackageJson): string[] {
  const patterns = workspaceGlobs(pkg);
  const dropped = new Set(patterns.filter((p) => p.startsWith("!")).flatMap((p) => globDirs(root, p.slice(1))));
  const dirs = new Set(patterns.filter((p) => !p.startsWith("!")).flatMap((p) => globDirs(root, p)));

  return [...dirs]
    .filter((dir) => !dropped.has(dir) && path.relative(root, dir) !== "")
    .filter((dir) => fs.existsSync(path.join(dir, "package.json")))
    .toSorted(byCodeUnit);
}

/** `@acme/api` -> `acme:api`; `api` -> `api`. */
function labelPrefix(name: string): string {
  return name.replace(SCOPE_AT, "").replaceAll("/", ":");
}

/** A generated task; its keys are listed in the order tasks.json holds them. */
function shellTask(label: string, script: string, cwd?: string): VsTask {
  const options: [string, Json][] = cwd === undefined ? [] : [["options", { cwd }]];

  return Object.fromEntries<Json>([
    ["label", label],
    ["type", SHELL_TYPE],
    ["command", `bun run ${script}`],
    ...options,
    ["problemMatcher", []],
    ["presentation", { ...PRESENTATION }],
  ]);
}

function scriptsOf(pkg: PackageJson): string[] {
  return Object.keys(pkg.scripts ?? {});
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

  function add(label: string, task: VsTask): void {
    if (taken.has(label)) return;
    taken.add(label);
    generated.set(label, task);
  }

  for (const script of scriptsOf(pkg)) add(script, shellTask(script, script));

  for (const dir of workspaceDirs(root, pkg)) {
    const workspace = readPackage(path.join(dir, "package.json"));

    if (workspace?.name === undefined || workspace.name === "") continue;
    const cwd = `\${workspaceFolder}/${slash(path.relative(root, dir))}`;

    for (const script of scriptsOf(workspace)) {
      const label = `${labelPrefix(workspace.name)}:${script}`;
      add(label, shellTask(label, script, cwd));
    }
  }

  // Labels are unique in `generated`, so two never compare equal.
  const sorted = [...generated].toSorted(([a], [b]) => byCodeUnit(a, b)).map(([, task]) => task);

  return { tasks: [...sorted, ...kept], version: TASKS_VERSION };
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
      tasks = readJson(tasksFileSchema(), stripJsonc(existing)).tasks.filter((task) => task !== null);
    } catch (error) {
      return { error: `cannot parse ${TASKS_REL}: ${errorMessage(error)}`, ok: false };
    }
  }

  const result = buildTasks(root, tasks);
  const kept = result.tasks.filter((task) => !isGenerated(task)).length;

  return {
    generated: result.tasks.length - kept,
    kept,
    ok: true,
    text: `${JSON.stringify(result, null, JSON_INDENT)}\n`,
  };
}

/** Where `run` prints: one line at a time, with no newline; the process streams unless a test hands its own. */
export type TasksIo = { stdout: (line: string) => void; stderr: (line: string) => void };

const PROCESS_IO: TasksIo = {
  stderr: (line) => process.stderr.write(`${line}\n`),
  stdout: (line) => process.stdout.write(`${line}\n`),
};

/**
 * Writes `.vscode/tasks.json` under `root`, stamped and read-only as sync leaves it; prints the count line; returns
 * the exit code.
 */
export function run(root: string, io: TasksIo = PROCESS_IO): number {
  const written = writeTasks(root, path.join(root, TASKS_REL));

  if (!written.ok) {
    io.stderr(`tasks: ${written.error}`);

    return 1;
  }

  const { generated, kept } = written.value;
  io.stdout(`Wrote ${generated + kept} tasks to ${TASKS_REL} (${generated} generated, ${kept} kept)`);

  return 0;
}

/** Renders the tasks file at `file` and writes it; the task counts, or the error line. */
function writeTasks(root: string, file: string): Result<{ generated: number; kept: number }, string> {
  const pkgFile = path.join(root, "package.json");
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const rendered = renderTasks(root, current);

  if (!rendered.ok) return { error: rendered.error.replace(TASKS_REL, file), ok: false };

  if (readPackage(pkgFile) === null) return { error: `cannot read ${pkgFile}`, ok: false };
  const error = writeOwned(file, stamp(TASKS_REL, rendered.text), OWNED_MODE);

  return error === null ? { ok: true, value: rendered } : { error: `cannot write ${file}: ${error}`, ok: false };
}

export function main(): number {
  return run(resolveRoots().checkout);
}
