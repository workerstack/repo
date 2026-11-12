import fs from "node:fs";
import nodePath from "node:path";

import { afterEach, expect, it } from "vitest";

import { git, removePlanted } from "./__fixtures__/planted-repo.ts";
import { change } from "./__fixtures__/red-proof-change.ts";
import { PASS, fakeVitest, plant, plantUnborn, stage, staged } from "./__fixtures__/red-proof-repo.ts";
import { redProof } from "./red-proof.ts";

/** What the HEAD tree holds when vitest runs in it, seen through a stand-in runner on planted repos. */
afterEach(removePlanted);

function read(cwd: string, file: string) {
  return fs.existsSync(nodePath.join(cwd, file)) ? fs.readFileSync(nodePath.join(cwd, file), "utf8") : null;
}

function boom(): never {
  throw new Error("boom");
}

/** A stand-in vitest that records, per watched file, what the HEAD tree held when it ran. */
function watcher() {
  const seen: Record<string, string | null> = {};

  const run = fakeVitest(
    () => true,
    (cwd) => {
      for (const file of [...WATCHED, "app.config.ts", "notes.md"]) seen[file] = read(cwd, file);
    },
  );

  return { run, seen };
}

const BASE = { "__fixtures__/f.ts": "old\n", "__snapshots__/a.snap": "old\n", "gone.ts": "gone\n", "s.ts": "head\n" };

const STAGED = {
  "__fixtures__/f.ts": "newer\n",
  "__fixtures__/helper.ts": "h\n",
  "__snapshots__/a.snap": "newer\n",
  "a.test.ts": PASS,
  "app.config.ts": "cfg\n",
  "new.ts": "new\n",
  "notes.md": "n\n",
  "s.ts": "staged\n",
};

const MIXED = change(
  ["M", "s.ts"],
  ["A", "new.ts"],
  ["D", "gone.ts"],
  ["M", "__fixtures__/f.ts"],
  ["A", "__fixtures__/helper.ts"],
  ["M", "__snapshots__/a.snap"],
  ["A", "app.config.ts"],
  ["A", "a.test.ts"],
  ["A", "notes.md"],
);

const WATCHED = ["s.ts", "new.ts", "gone.ts", "__fixtures__/f.ts", "__fixtures__/helper.ts", "__snapshots__/a.snap"];

it("puts a changed source file back and removes a new one on the HEAD tree", () => {
  const root = plant(BASE);
  stage(root, STAGED);
  git(root, "rm", "-q", "gone.ts");
  const { seen, run } = watcher();
  expect(redProof(root, MIXED, { vitest: run })).toMatchObject({ ok: true });
  expect(seen).toMatchObject({ "gone.ts": "gone\n", "new.ts": null, "s.ts": "head\n" });
});

it("keeps fixtures, snapshots, configs and other files as staged", () => {
  const root = plant(BASE);
  stage(root, STAGED);
  const { seen, run } = watcher();
  redProof(root, MIXED, { vitest: run });
  expect(seen).toMatchObject({
    "__fixtures__/f.ts": "newer\n",
    "__fixtures__/helper.ts": "h\n",
    "__snapshots__/a.snap": "newer\n",
    "app.config.ts": "cfg\n",
    "notes.md": "n\n",
  });
  expect(git(root, "status", "--porcelain")).toContain("M  s.ts");
});

it("puts a renamed file's old path back", () => {
  const root = plant({ "old.ts": "old\n" });
  git(root, "mv", "old.ts", "new.ts");
  stage(root, { "a.test.ts": PASS });
  const seen: (string | null)[] = [];

  const run = fakeVitest(
    () => true,
    (cwd) => seen.push(read(cwd, "old.ts"), read(cwd, "new.ts")),
  );

  const files = change(["D", "old.ts"], ["A", "new.ts"], ["A", "a.test.ts"]);
  expect(redProof(root, files, { vitest: run }).ok).toBe(true);
  expect(seen).toStrictEqual(["old\n", null]);
});

it("runs two packages each in their own HEAD-tree dir with their modules linked", () => {
  const root = plant({ "pkg-a/package.json": { name: "a" }, "pkg-b/package.json": { name: "b" } });
  fs.mkdirSync(nodePath.join(root, "pkg-a", "node_modules"));
  stage(root, { "pkg-a/a.test.ts": PASS, "pkg-b/b.test.ts": PASS, "pkg-b/c.test.ts": PASS });
  const calls: unknown[] = [];

  const run = fakeVitest(
    (file) => file === "a.test.ts",
    (cwd, args) =>
      calls.push({
        cwd: nodePath.relative(root, cwd),
        files: args.filter((arg) => arg.endsWith(".ts")),
        linked: fs.existsSync(nodePath.join(cwd, "node_modules")),
        rootLinked: fs.existsSync(nodePath.join(cwd, "..", "node_modules")),
      }),
  );

  const files = change(["A", "pkg-a/a.test.ts"], ["A", "pkg-b/b.test.ts"], ["A", "pkg-b/c.test.ts"]);
  expect(redProof(root, files, { vitest: run })).toStrictEqual({
    line: "red-proof: 1 of 3 changed test files failed on HEAD",
    ok: true,
  });
  const name = nodePath.join(".tmp", "repo", `red-proof-${process.pid}`);
  expect(calls).toStrictEqual([
    { cwd: nodePath.join(name, "pkg-a"), files: ["a.test.ts"], linked: true, rootLinked: true },
    { cwd: nodePath.join(name, "pkg-b"), files: ["b.test.ts", "c.test.ts"], linked: false, rootLinked: true },
  ]);
});

it("removes its dir after a pass and after a throw", () => {
  const root = plant({ "s.ts": "head\n" });
  stage(root, { "a.test.ts": PASS });
  const tree = nodePath.join(root, ".tmp", "repo", `red-proof-${process.pid}`);
  const seen: boolean[] = [];

  const run = fakeVitest(
    () => true,
    () => seen.push(fs.existsSync(tree)),
  );

  redProof(root, change(["A", "a.test.ts"]), { vitest: run });
  expect(seen).toStrictEqual([true]);
  expect(fs.existsSync(tree)).toBe(false);
  expect(() => redProof(root, change(["A", "a.test.ts"]), { vitest: boom })).toThrow("boom");
  expect(fs.existsSync(tree)).toBe(false);
});

it("skips with a line when there is no HEAD", () => {
  const root = plantUnborn({ "a.test.ts": PASS });
  expect(redProof(root, change(["A", "a.test.ts"]), { vitest: fakeVitest(() => true) })).toStrictEqual({
    line: "red-proof: skipped, no HEAD to run against",
    ok: true,
  });
  expect(staged(root)).toBe("A\ta.test.ts\n");
});

it("owns a nested test by the nearest package dir above it", () => {
  const root = plant({ "cli/package.json": { name: "c" } });
  stage(root, { "cli/sub/deep/a.test.ts": PASS, "top/b.test.ts": PASS });
  const calls: unknown[] = [];

  const run = fakeVitest(
    () => false,
    (cwd, args) => calls.push([nodePath.relative(root, cwd), args[1]]),
  );

  redProof(root, change(["A", "cli/sub/deep/a.test.ts"], ["A", "top/b.test.ts"]), { vitest: run });
  const name = nodePath.join(".tmp", "repo", `red-proof-${process.pid}`);
  expect(calls).toStrictEqual([
    [nodePath.join(name, "cli"), "sub/deep/a.test.ts"],
    [name, "top/b.test.ts"],
  ]);
});
