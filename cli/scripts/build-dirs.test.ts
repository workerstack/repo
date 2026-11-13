import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { childEnv } from "../env.ts";
import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { planBuild, removeBuild } from "./build-dirs.ts";
import { toolEnv } from "./tool-env.ts";

useTempDirs();

function git(root: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: root,
    env: toolEnv(childEnv()),
  });
}

const IGNORE = ".next\n.turbo/\n!keep/.turbo/\n.vite\nnode_modules\n*.tsbuildinfo\n.flare\n.tmp/\ndist\n";

const FILES = {
  ".flare/state": "f",
  ".gitignore": IGNORE,
  ".next/cache/a.bin": "12345",
  ".repo/plans/note.md": "note",
  ".vite/tracked.json": "{}\n",
  "apps/web/.next/trace": "1",
  "apps/web/.turbo/log.txt": "123",
  "apps/web/node_modules/y/index.js": "12",
  "dist/out.js": "d",
  "keep/.turbo/log.txt": "kept",
  "node_modules/x/index.js": "1",
  "packages/a/tsconfig.tsbuildinfo": "1234567",
  "src/a.ts": "export {};\n",
};

/** A git repo with a real .gitignore, caches both ignored and not, and a `.vite` whose file is tracked anyway. */
function repo(): string {
  const root = fs.realpathSync(tempDir("workerstack-build-dirs-"));
  git(root, "init", "-q", "-b", "main");

  for (const [rel, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }

  git(root, "add", "-f", ".gitignore", "src/a.ts", ".vite/tracked.json");
  git(root, "commit", "-q", "--no-verify", "-m", "init");

  return root;
}

function at(root: string, ...rels: string[]) {
  return rels.map((rel) => path.join(root, rel));
}

function names(plan: ReturnType<typeof planBuild>, kind: string) {
  return plan.ok ? plan.items.filter((item) => item.kind === kind).map((item) => item.path) : [];
}

const BUILT = ["src/a.ts", "keep/.turbo/log.txt", ".vite/tracked.json", ".repo/plans/note.md"];

it("plans the ignored build dirs and tsbuildinfo files at any depth, and no tracked or unignored path", () => {
  const root = repo();
  const plan = planBuild(root, { deps: false, extra: [] });
  expect(names(plan, "dir").toSorted()).toStrictEqual(
    at(root, ".next", "apps/web/.next", "apps/web/.turbo").toSorted(),
  );
  expect(names(plan, "info")).toStrictEqual(at(root, "packages/a/tsconfig.tsbuildinfo"));
  expect(names(plan, "modules")).toStrictEqual([]);
  const everything = plan.ok ? plan.items.map((item) => item.path) : [];

  for (const kept of at(root, ".vite", "keep/.turbo", "dist", ".flare", "node_modules"))
    expect(everything).not.toContain(kept);
});

it("sizes each item by the bytes under it", () => {
  const plan = planBuild(repo(), { deps: false, extra: [] });
  const bytes = plan.ok ? plan.items.map((item) => item.bytes).toSorted((a, b) => a - b) : [];
  expect(bytes).toStrictEqual([1, 3, 5, 7]);
});

it("adds the ignored node_modules at any depth under deps", () => {
  const root = repo();
  const plan = planBuild(root, { deps: true, extra: [] });
  expect(names(plan, "modules").toSorted()).toStrictEqual(at(root, "apps/web/node_modules", "node_modules").toSorted());
  expect(names(plan, "dir")).toHaveLength(3);
});

it("adds the dir names the config lists, still only where git ignores them", () => {
  const root = repo();
  expect(names(planBuild(root, { deps: false, extra: [".flare"] }), "dir")).toContain(path.join(root, ".flare"));
  expect(names(planBuild(root, { deps: false, extra: ["dist", "src"] }), "dir")).toContain(path.join(root, "dist"));
  expect(names(planBuild(root, { deps: false, extra: ["src", "keep"] }), "dir")).not.toContain(path.join(root, "src"));
});

it("removes what was planned and nothing else, the tracked .vite and the unignored .turbo among what stays", () => {
  const root = repo();
  const plan = planBuild(root, { deps: true, extra: [] });
  const result = plan.ok ? removeBuild(plan.items, { dryRun: false, rm: fs.rmSync }) : null;
  expect(result?.skipped).toStrictEqual([]);
  expect(result?.done).toHaveLength(plan.ok ? plan.items.length : -1);

  for (const gone of at(root, ".next", "apps/web/.turbo", "node_modules", "packages/a/tsconfig.tsbuildinfo"))
    expect(fs.existsSync(gone)).toBe(false);

  for (const kept of [...BUILT, "dist/out.js", ".flare/state"]) expect(fs.existsSync(path.join(root, kept))).toBe(true);
});

it("removes nothing on a dry run, and lists the same items", () => {
  const root = repo();
  const plan = planBuild(root, { deps: true, extra: [] });
  const result = plan.ok ? removeBuild(plan.items, { dryRun: true, rm: fs.rmSync }) : null;
  expect(result?.done).toHaveLength(plan.ok ? plan.items.length : -1);
  expect(fs.existsSync(path.join(root, ".next/cache/a.bin"))).toBe(true);
  expect(fs.existsSync(path.join(root, "node_modules/x/index.js"))).toBe(true);
});

it("a second plan after removing finds nothing, and a path that fails is skipped with its code", () => {
  const root = repo();

  const busy = ((target: string) => {
    if (target.endsWith(".next")) throw Object.assign(new Error("busy"), { code: "EBUSY" });
    fs.rmSync(target, { force: true, recursive: true });
  }) /* the stand-in takes the path and options the report passes */ as typeof fs.rmSync;

  const plan = planBuild(root, { deps: false, extra: [] });
  const result = plan.ok ? removeBuild(plan.items, { dryRun: false, rm: busy }) : null;
  expect(result?.skipped.map((entry) => entry.code)).toStrictEqual(["EBUSY", "EBUSY"]);
  const clean = planBuild(root, { deps: false, extra: [] });
  expect(clean.ok ? names(clean, "dir").length : -1).toBe(2);

  if (clean.ok) removeBuild(clean.items, { dryRun: false, rm: fs.rmSync });
  expect(planBuild(root, { deps: false, extra: [] })).toStrictEqual({ items: [], ok: true });
});

it("says so when the root is not a git repo", () => {
  const root = fs.realpathSync(tempDir("workerstack-build-dirs-plain-"));
  const plan = planBuild(root, { deps: false, extra: [] });
  expect(plan.ok ? "" : plan.error).toMatch(/^git ls-files failed: /);
});
