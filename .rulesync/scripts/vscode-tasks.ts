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
import { fileURLToPath } from "node:url";
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
    exclude: (entry: string | fs.Dirent) => (typeof entry === "string" ? path.basename(entry) : entry.name) === "node_modules",
  });
  return hits.filter((hit) => !slash(hit).split("/").includes("node_modules")).map((hit) => path.join(root, hit));
}

function workspaceDirs(root: string, pkg: PackageJson): string[] {
  const ws: unknown = Array.isArray(pkg.workspaces) ? pkg.workspaces : isRecord(pkg.workspaces) ? pkg.workspaces.packages : undefined;
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
  const taken = new Set(kept.map((task) => task?.label));
  const generated: VsTask[] = [];
  const add = (task: VsTask): void => {
    if (taken.has(task.label)) return;
    taken.add(task.label);
    generated.push(task);
  };
  for (const script of scriptsOf(pkg)) add(shellTask(script, script));
  for (const dir of workspaceDirs(root, pkg)) {
    const workspace = readPackage(path.join(dir, "package.json"));
    if (!workspace || typeof workspace.name !== "string" || !workspace.name) continue;
    const cwd = `\${workspaceFolder}/${slash(path.relative(root, dir))}`;
    for (const script of scriptsOf(workspace)) add(shellTask(`${labelPrefix(workspace.name)}:${script}`, script, cwd));
  }
  generated.sort((a, b) => ((a.label ?? "") < (b.label ?? "") ? -1 : (a.label ?? "") > (b.label ?? "") ? 1 : 0));
  return { tasks: [...generated, ...kept], version: "2.0.0" };
}

/** Writes `.vscode/tasks.json` under `root`; prints the count line; returns the exit code. */
export function run(root: string): number {
  const file = path.join(root, TASKS_REL);
  let existing: VsTask[] = [];
  if (fs.existsSync(file)) {
    try {
      const parsed: unknown = JSON.parse(stripJsonc(fs.readFileSync(file, "utf8")));
      if (isRecord(parsed) && Array.isArray(parsed.tasks)) existing = parsed.tasks.filter(isRecord);
    } catch (err) {
      console.error(`tasks: cannot parse ${file}: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }
  const pkgFile = path.join(root, "package.json");
  if (!readPackage(pkgFile)) {
    console.error(`tasks: cannot read ${pkgFile}`);
    return 1;
  }
  const result = buildTasks(root, existing);
  const kept = result.tasks.filter((task) => !isGenerated(task)).length;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Wrote ${result.tasks.length} tasks to ${TASKS_REL} (${result.tasks.length - kept} generated, ${kept} kept)`);
  return 0;
}

export function main(): number {
  return run(resolveRoots().checkout);
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === fileURLToPath(import.meta.url)) process.exitCode = main();
