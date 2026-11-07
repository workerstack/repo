#!/usr/bin/env node
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
import { stripJsonc } from "./jsonc.mjs";
import { resolveRoots } from "./workspace-root.mjs";

const TASKS_REL = ".vscode/tasks.json";
const PRESENTATION = { panel: "new", reveal: "always" };
const RUN_RE = /^bun run \S+$/;

/** True for a task this script writes: a plain `bun run <script>` shell task with no `dependsOn`. */
export function isGenerated(task) {
  return Boolean(task) && task.type === "shell" && !task.dependsOn && RUN_RE.test(String(task.command));
}

const slash = (p) => p.split(path.sep).join("/");

function readPackage(file) {
  try {
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    return pkg && typeof pkg === "object" ? pkg : null;
  } catch {
    return null;
  }
}

function globDirs(root, pattern) {
  const hits = fs.globSync(pattern, {
    cwd: root,
    exclude: (entry) => (typeof entry === "string" ? path.basename(entry) : entry.name) === "node_modules",
  });
  return hits.filter((hit) => !slash(hit).split("/").includes("node_modules")).map((hit) => path.join(root, hit));
}

function workspaceDirs(root, pkg) {
  const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
  const patterns = (Array.isArray(ws) ? ws : []).filter((p) => typeof p === "string");
  const dropped = new Set(patterns.filter((p) => p.startsWith("!")).flatMap((p) => globDirs(root, p.slice(1))));
  const dirs = new Set(patterns.filter((p) => !p.startsWith("!")).flatMap((p) => globDirs(root, p)));
  return [...dirs]
    .filter((dir) => !dropped.has(dir) && path.relative(root, dir) !== "")
    .filter((dir) => fs.existsSync(path.join(dir, "package.json")))
    .sort();
}

/** `@acme/api` -> `acme:api`; `api` -> `api`. */
function labelPrefix(name) {
  return name.replace(/^@/, "").replace(/\//g, ":");
}

function shellTask(label, script, cwd) {
  return {
    label,
    type: "shell",
    command: `bun run ${script}`,
    ...(cwd ? { options: { cwd } } : {}),
    problemMatcher: [],
    presentation: { ...PRESENTATION },
  };
}

function scriptsOf(pkg) {
  return pkg.scripts && typeof pkg.scripts === "object" ? Object.keys(pkg.scripts) : [];
}

/**
 * @param {string} root checkout root holding the package.json
 * @param {object[]} existing the tasks array of the current tasks.json
 * @returns {{ tasks: object[], version: string }} generated tasks sorted by label, then the kept ones in their order
 */
export function buildTasks(root, existing) {
  const pkg = readPackage(path.join(root, "package.json")) ?? {};
  const kept = existing.filter((task) => !isGenerated(task));
  const taken = new Set(kept.map((task) => task?.label));
  const generated = [];
  const add = (task) => {
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
  generated.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return { tasks: [...generated, ...kept], version: "2.0.0" };
}

/** Writes `.vscode/tasks.json` under `root`; prints the count line; returns the exit code. */
export function run(root) {
  const file = path.join(root, TASKS_REL);
  let existing = [];
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(stripJsonc(fs.readFileSync(file, "utf8")));
      if (Array.isArray(parsed?.tasks)) existing = parsed.tasks;
    } catch (err) {
      console.error(`tasks: cannot parse ${file}: ${err.message}`);
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

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === fileURLToPath(import.meta.url)) process.exitCode = run(resolveRoots().checkout);
