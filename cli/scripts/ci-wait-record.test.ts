import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { recordPath, recordRoot, recordSchema, writeRecord, type RecordFs, type WaitRecord } from "./ci-wait-record.ts";

const SHA = "b3f5e8a0123456789abcdef0123456789abcdef0";
const ROOT = path.join(path.sep, "main");

/** An fs that logs each operation and keeps the files in memory; with `fail` every write throws. */
function fakeFs({ fail = false } = {}) {
  const ops: string[] = [];
  const files = new Map<string, string>();

  const memory = {
    mkdirSync: (dir: string) => ops.push(`mkdir ${dir}`),
    renameSync: (from: string, to: string) => {
      ops.push(`rename ${from} ${to}`);
      files.set(to, files.get(from) ?? "");
      files.delete(from);
    },
    rmSync: (file: string) => ops.push(`rm ${file}`),
    writeFileSync: (file: string, data: string) => {
      ops.push(`write ${file}`);

      if (fail) throw new Error("disk full");
      files.set(file, data);
    },
  } as unknown /* only the methods a record calls are given */ as RecordFs;

  return { files, fs: memory, ops };
}

function record(outcome: WaitRecord["outcome"], failed: string[] = []): WaitRecord {
  return {
    at: "2026-11-10T10:00:00.000Z",
    branch: "main",
    failed,
    outcome,
  };
}

it.each(["passed", "failed", "superseded", "nothing", "error"] as const)(
  "a %s outcome leaves exactly one record, named by the full sha",
  (outcome) => {
    const world = fakeFs();
    const failed = outcome === "failed" ? ["test (windows-latest)"] : [];
    expect(writeRecord({ root: ROOT, sha: SHA }, record(outcome, failed), world.fs)).toBe(true);
    expect([...world.files.keys()]).toStrictEqual([recordPath(ROOT, SHA)]);
    expect(recordSchema().parse(JSON.parse(world.files.get(recordPath(ROOT, SHA)) ?? ""))).toStrictEqual(
      record(outcome, failed),
    );
  },
);

it("the record is written to a temp file and renamed over the final name", () => {
  const world = fakeFs();
  writeRecord({ root: ROOT, sha: SHA }, record("passed"), world.fs);
  const final = path.join(ROOT, ".tmp", "repo", "ci", `${SHA}.json`);
  expect(world.ops[0]).toBe(`mkdir ${path.dirname(final)}`);
  expect(world.ops[1]).toMatch(/^write .+\.tmp$/);
  const temp = world.ops[1]?.slice("write ".length);
  expect(temp).not.toBe(final);
  expect(world.ops[2]).toBe(`rename ${temp} ${final}`);
  expect(world.ops).toHaveLength(3);
});

it("a failed write leaves no final file, removes the temp and says so", () => {
  const world = fakeFs({ fail: true });
  expect(writeRecord({ root: ROOT, sha: SHA }, record("passed"), world.fs)).toBe(false);
  expect(world.files.size).toBe(0);
  expect(world.ops.some((op) => op.startsWith("rm ") && op.endsWith(".tmp"))).toBe(true);
});

it("writes with node's fs when none is given", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-wait-record-"));

  try {
    expect(writeRecord({ root: dir, sha: SHA }, record("nothing"))).toBe(true);
    expect(fs.readdirSync(path.join(dir, ".tmp", "repo", "ci"))).toStrictEqual([`${SHA}.json`]);
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

it("the root is the parent of the common git dir, so a worktree and the root meet; cwd outside git", () => {
  const common = path.join(ROOT, ".git");
  const args: string[][] = [];

  function git(a: string[]) {
    return (args.push(a), { code: 0, stderr: "", stdout: `${common}\n` });
  }

  expect(recordRoot(git, path.join(ROOT, ".worktrees", "x"))).toBe(ROOT);
  expect(args[0]).toStrictEqual(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  expect(recordRoot(() => ({ code: 128, stderr: "fatal", stdout: "" }), "/elsewhere")).toBe("/elsewhere");
  expect(recordRoot(() => ({ code: 0, stderr: "", stdout: "\n" }), "/elsewhere")).toBe("/elsewhere");
});
