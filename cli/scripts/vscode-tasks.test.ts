import { describe, expect, it } from "vitest";

import { tempRoot, write } from "./__fixtures__/vscode-tasks-kit.ts";
import { buildTasks, isGenerated, type VsTask } from "./vscode-tasks.ts";

const PRESENTATION = { panel: "new", reveal: "always" };

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
});

describe("buildTasks", () => {
  it("labels an unscoped workspace package <name>:<script>", () => {
    const root = tempRoot();
    write(root, "package.json", { workspaces: ["apps/*"] });
    write(root, "apps/web/nested/package.json", { name: "ignored", scripts: { x: "y" } });
    write(root, "apps/api/package.json", { name: "api", scripts: { test: "vitest" } });
    const { tasks } = buildTasks(root, []);
    expect(tasks.map((t: VsTask) => t.label)).toStrictEqual(["api:test"]);
    expect(tasks[0]?.options?.cwd).toBe("${workspaceFolder}/apps/api");
  });

  it("reads the object form of workspaces and nested globs", () => {
    const root = tempRoot();
    write(root, "package.json", { workspaces: { packages: ["libs/**"] } });
    write(root, "libs/group/util/package.json", { name: "@acme/util", scripts: { build: "x" } });
    const { tasks } = buildTasks(root, []);
    expect(tasks[0]?.label).toBe("acme:util:build");
    expect(tasks[0]?.options?.cwd).toBe("${workspaceFolder}/libs/group/util");
  });
});

describe("buildTasks", () => {
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
});

describe("buildTasks", () => {
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
    expect(tasks[0]?.options).toBeUndefined();
    expect(tasks[1]).toBe(mine);
  });

  it("has no tasks without a package.json", () => {
    expect(buildTasks(tempRoot(), []).tasks).toStrictEqual([]);
  });
});
