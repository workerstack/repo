import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { childEnv } from "../env.ts";
import { stamp } from "../sync/header.ts";
import { stripJsonc } from "./jsonc.ts";
import { buildTasks, isGenerated, run, type TasksFile, type VsTask } from "./vscode-tasks.ts";

const SCRIPT = fileURLToPath(new URL("../../bin/repo.ts", import.meta.url));
const PRESENTATION = { panel: "new", reveal: "always" };

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
});

function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-tasks-"));
  dirs.push(dir);
  return dir;
}

function write(root: string, rel: string, body: unknown) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body, null, 2));
}

function readTasks(root: string): TasksFile {
  return JSON.parse(stripJsonc(fs.readFileSync(path.join(root, ".vscode", "tasks.json"), "utf8"))) as TasksFile;
}

function silent(fn: () => number) {
  const logs: string[] = [];
  const errs: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a: unknown[]) => void logs.push(a.join(" "));
  console.error = (...a: unknown[]) => void errs.push(a.join(" "));
  try {
    return { code: fn(), errs, logs };
  } finally {
    console.log = log;
    console.error = error;
  }
}

describe("isGenerated", () => {
  it("accepts a plain shell `bun run <script>` task", () => {
    expect(isGenerated({ command: "bun run test", label: "test", type: "shell" })).toBe(true);
  });

  it("rejects anything hand-written", () => {
    expect(isGenerated({ command: "bun run test --watch", label: "a", type: "shell" })).toBe(false);
    expect(isGenerated({ command: "npm run test", label: "a", type: "shell" })).toBe(false);
    expect(isGenerated({ command: "bun run test", label: "a", type: "process" })).toBe(false);
    expect(isGenerated({ command: "bun run a", dependsOn: ["b"], label: "a", type: "shell" })).toBe(false);
    expect(isGenerated({ dependsOn: ["b"], label: "a" })).toBe(false);
    expect(isGenerated(null)).toBe(false);
  });
});

describe("buildTasks", () => {
  it("turns root scripts into sorted shell tasks", () => {
    const root = tempRoot();
    write(root, "package.json", { scripts: { build: "tsc", doctor: "x", test: "vitest" } });
    const { tasks, version } = buildTasks(root, []);
    expect(version).toBe("2.0.0");
    expect(tasks).toStrictEqual([
      { command: "bun run build", label: "build", presentation: PRESENTATION, problemMatcher: [], type: "shell" },
      { command: "bun run doctor", label: "doctor", presentation: PRESENTATION, problemMatcher: [], type: "shell" },
      { command: "bun run test", label: "test", presentation: PRESENTATION, problemMatcher: [], type: "shell" },
    ]);
  });

  it("labels a scoped workspace package acme:api:<script> and sets cwd with forward slashes", () => {
    const root = tempRoot();
    write(root, "package.json", { scripts: { test: "x" }, workspaces: ["packages/*"] });
    write(root, "packages/api/package.json", { name: "@acme/api", scripts: { dev: "x", test: "vitest" } });
    const { tasks } = buildTasks(root, []);
    expect(tasks.map((t: VsTask) => t.label)).toStrictEqual(["acme:api:dev", "acme:api:test", "test"]);
    expect(tasks.find((t: VsTask) => t.label === "acme:api:test")).toStrictEqual({
      command: "bun run test",
      label: "acme:api:test",
      options: { cwd: "${workspaceFolder}/packages/api" },
      presentation: PRESENTATION,
      problemMatcher: [],
      type: "shell",
    });
  });

  it("labels an unscoped workspace package <name>:<script>", () => {
    const root = tempRoot();
    write(root, "package.json", { workspaces: ["apps/*"] });
    write(root, "apps/web/nested/package.json", { name: "ignored", scripts: { x: "y" } });
    write(root, "apps/api/package.json", { name: "api", scripts: { test: "vitest" } });
    const { tasks } = buildTasks(root, []);
    expect(tasks.map((t: VsTask) => t.label)).toStrictEqual(["api:test"]);
    expect(tasks[0]!.options!.cwd).toBe("${workspaceFolder}/apps/api");
  });

  it("reads the object form of workspaces and nested globs", () => {
    const root = tempRoot();
    write(root, "package.json", { workspaces: { packages: ["libs/**"] } });
    write(root, "libs/group/util/package.json", { name: "@acme/util", scripts: { build: "x" } });
    const { tasks } = buildTasks(root, []);
    expect(tasks[0]!.label).toBe("acme:util:build");
    expect(tasks[0]!.options!.cwd).toBe("${workspaceFolder}/libs/group/util");
  });

  it("skips node_modules packages, negated workspaces, packages with no name or scripts", () => {
    const root = tempRoot();
    write(root, "package.json", { workspaces: ["packages/*", "**/pkg", "!packages/skipped"] });
    write(root, "packages/ok/package.json", { name: "@acme/ok", scripts: { test: "x" } });
    write(root, "packages/skipped/package.json", { name: "@acme/skipped", scripts: { test: "x" } });
    write(root, "packages/nameless/package.json", { scripts: { test: "x" } });
    write(root, "packages/bare/package.json", { name: "@acme/bare" });
    write(root, "packages/broken/package.json", "{ not json");
    write(root, "packages/nopkg/readme.md", "x");
    write(root, "node_modules/dep/pkg/package.json", { name: "dep", scripts: { test: "x" } });
    const { tasks } = buildTasks(root, []);
    expect(tasks.map((t: VsTask) => t.label)).toStrictEqual(["acme:ok:test"]);
  });

  it("keeps hand-written and dependsOn tasks in order after the generated block", () => {
    const root = tempRoot();
    write(root, "package.json", { scripts: { test: "x" } });
    const handwritten = { command: "bun run dev --port 3000", label: "serve", type: "shell" };
    const compound = { dependsOn: ["test"], dependsOrder: "sequence", label: "all" };
    const { tasks } = buildTasks(root, [handwritten, compound]);
    expect(tasks.map((t: VsTask) => t.label)).toStrictEqual(["test", "serve", "all"]);
    expect(tasks[1]).toBe(handwritten);
    expect(tasks[2]).toBe(compound);
  });

  it("drops a generated task whose script was removed", () => {
    const root = tempRoot();
    write(root, "package.json", { scripts: { test: "x" } });
    const stale = { command: "bun run gone", label: "gone", problemMatcher: [], type: "shell" };
    const { tasks } = buildTasks(root, [stale]);
    expect(tasks.map((t: VsTask) => t.label)).toStrictEqual(["test"]);
  });

  it("lets a kept task win a label clash and ignores duplicate package labels", () => {
    const root = tempRoot();
    write(root, "package.json", { scripts: { "acme:a:test": "y", test: "x" }, workspaces: ["packages/*"] });
    write(root, "packages/a/package.json", { name: "@acme/a", scripts: { test: "z" } });
    write(root, "packages/b/package.json", { name: "@acme/a", scripts: { test: "z" } });
    const mine = { command: "bun test --bail", label: "test", type: "shell" };
    const { tasks } = buildTasks(root, [mine]);
    expect(tasks.map((t: VsTask) => t.label)).toStrictEqual(["acme:a:test", "test"]);
    expect(tasks[0]!.options).toBeUndefined();
    expect(tasks[1]).toBe(mine);
  });

  it("has no tasks without a package.json", () => {
    expect(buildTasks(tempRoot(), []).tasks).toStrictEqual([]);
  });
});

describe("run", () => {
  it("creates .vscode/tasks.json and prints the count line", () => {
    const root = tempRoot();
    write(root, "package.json", { scripts: { build: "y", test: "x" } });
    const { code, logs } = silent(() => run(root));
    expect(code).toBe(0);
    expect(logs).toStrictEqual(["Wrote 2 tasks to .vscode/tasks.json (2 generated, 0 kept)"]);
    const file = fs.readFileSync(path.join(root, ".vscode", "tasks.json"), "utf8");
    expect(file).toBe(stamp(".vscode/tasks.json", `${JSON.stringify(readTasks(root), null, 2)}\n`));
    expect(readTasks(root).version).toBe("2.0.0");
  });

  it("reads a commented tasks.json and counts kept tasks", () => {
    const root = tempRoot();
    write(root, "package.json", { scripts: { test: "x" } });
    write(
      root,
      ".vscode/tasks.json",
      `{
  // my tasks
  "version": "2.0.0",
  /* block */
  "tasks": [
    { "label": "mine", "type": "shell", "command": "echo hi" },
    { "label": "old", "type": "shell", "command": "bun run old" }
  ]
}`,
    );
    const { code, logs } = silent(() => run(root));
    expect(code).toBe(0);
    expect(logs).toStrictEqual(["Wrote 2 tasks to .vscode/tasks.json (1 generated, 1 kept)"]);
    expect(readTasks(root).tasks.map((t: VsTask) => t.label)).toStrictEqual(["test", "mine"]);
  });

  it("is idempotent", () => {
    const root = tempRoot();
    write(root, "package.json", { scripts: { test: "x" } });
    silent(() => run(root));
    const first = fs.readFileSync(path.join(root, ".vscode", "tasks.json"), "utf8");
    const { logs } = silent(() => run(root));
    expect(fs.readFileSync(path.join(root, ".vscode", "tasks.json"), "utf8")).toBe(first);
    expect(logs).toStrictEqual(["Wrote 1 tasks to .vscode/tasks.json (1 generated, 0 kept)"]);
  });

  it("refuses to overwrite a tasks.json it cannot parse", () => {
    const root = tempRoot();
    write(root, "package.json", { scripts: { test: "x" } });
    write(root, ".vscode/tasks.json", "{ nope");
    const { code, errs } = silent(() => run(root));
    expect(code).toBe(1);
    expect(errs[0]).toMatch(/^tasks: cannot parse .*tasks\.json/);
    expect(fs.readFileSync(path.join(root, ".vscode", "tasks.json"), "utf8")).toBe("{ nope");
  });

  it("treats a tasks.json with no tasks array as empty", () => {
    const root = tempRoot();
    write(root, "package.json", { scripts: { test: "x" } });
    write(root, ".vscode/tasks.json", "{}");
    expect(silent(() => run(root)).logs).toStrictEqual(["Wrote 1 tasks to .vscode/tasks.json (1 generated, 0 kept)"]);
  });

  it("fails when package.json is missing or unreadable", () => {
    const root = tempRoot();
    const missing = silent(() => run(root));
    expect(missing.code).toBe(1);
    expect(missing.errs[0]).toMatch(/^tasks: cannot read .*package\.json/);
    write(root, "package.json", "{ nope");
    expect(silent(() => run(root)).code).toBe(1);
  });
});

describe("cli", () => {
  it("runs from the checkout cwd and prints the line", () => {
    const root = tempRoot();
    write(root, "package.json", { scripts: { test: "x" } });
    const env = childEnv({ CLAUDE_PROJECT_DIR: undefined, GROK_WORKSPACE_ROOT: undefined });
    const out = execFileSync("bun", [SCRIPT, "tasks"], { cwd: root, encoding: "utf8", env });
    expect(out).toBe("Wrote 1 tasks to .vscode/tasks.json (1 generated, 0 kept)\n");
    expect(readTasks(root).tasks[0]!.label).toBe("test");
  });
});

/** Asserts `.vscode/tasks.json` is 0444; win32 keeps only a read-only flag, so there that it is set. */
function expectReadOnly(root: string): void {
  const mode = fs.statSync(path.join(root, ".vscode", "tasks.json")).mode & 0o777;
  if (process.platform === "win32") expect(mode & 0o222).toBe(0);
  else expect(mode).toBe(0o444);
}

describe("run modes", () => {
  it("leaves a stamped, read-only tasks.json and rewrites one that is already read-only", () => {
    const root = tempRoot();
    write(root, "package.json", { scripts: { test: "x" } });
    expect(silent(() => run(root)).code).toBe(0);
    const text = fs.readFileSync(path.join(root, ".vscode", "tasks.json"), "utf8");
    expect(text.split("\n")[0]).toBe("// @generated by @workerstack/repo");
    expectReadOnly(root);
    write(root, "package.json", { scripts: { build: "y", test: "x" } });
    expect(silent(() => run(root)).logs).toStrictEqual(["Wrote 2 tasks to .vscode/tasks.json (2 generated, 0 kept)"]);
    expect(readTasks(root).tasks.map((t: VsTask) => t.label)).toStrictEqual(["build", "test"]);
    expect(fs.readFileSync(path.join(root, ".vscode", "tasks.json"), "utf8").match(/@generated/g)).toHaveLength(1);
    expectReadOnly(root);
  });

  it("reports a tasks.json it cannot write and exits 1", () => {
    const root = tempRoot();
    write(root, "package.json", { scripts: { test: "x" } });
    write(root, ".vscode", "a file where the dir belongs\n");
    const { code, errs } = silent(() => run(root));
    expect(code).toBe(1);
    expect(errs[0]).toMatch(/^tasks: cannot write .*tasks\.json: /);
  });
});
