import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { ci, plant } from "./__fixtures__/ci-run.ts";
import { cleanTemps } from "./__fixtures__/turn-repo.ts";
import { mergeMain } from "./ci-merge.ts";
import { main } from "./ci.ts";
import type { Captured } from "./lint.ts";

afterEach(cleanTemps);

function blobs(...names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [`blobs/${name}`, "[]"]));
}

const MERGED: Captured = { code: 0, stderr: "", stdout: " Tests  6649 passed (6649)\n" };

async function merge(files: Record<string, string>, result: Captured | null = MERGED, dir = "blobs") {
  const root = plant(files);
  const calls: { args: string[]; cwd: string }[] = [];
  const out: string[] = [];
  const err: string[] = [];

  const code = await mergeMain(dir, {
    bins: {
      tsc: () => Promise.resolve(MERGED),
      vitest: (args, cwd) => {
        calls.push({ args, cwd });

        return result === null ? null : Promise.resolve(result);
      },
    },
    cwd: root,
    stderr: (s) => err.push(s),
    stdout: (s) => out.push(s),
  });

  return { calls, code, err: err.join(""), out: out.join(""), root };
}

it("runs the merged report with the floors on the blobs, prints vitest's output then the summary, exit 0", async () => {
  const run = await merge(blobs("blob-1-2.json", "blob-2-2.json"));
  expect(run.calls).toStrictEqual([
    { args: ["run", `--merge-reports=${path.join(run.root, "blobs")}`, "--coverage"], cwd: run.root },
  ]);
  expect(run).toMatchObject({
    code: 0,
    err: "",
    out: " Tests  6649 passed (6649)\nrepo ci merge: 2 blobs, 6649 tests, every floor met\n",
  });
});

it("exits 1 with the failure line on stdout when vitest does, after its own output", async () => {
  const bad = { code: 1, stderr: "ERROR: Coverage for lines (99%) does not meet threshold\n", stdout: "" };
  const run = await merge(blobs("blob-1-2.json", "blob-2-2.json"), bad);
  expect(run).toMatchObject({
    code: 1,
    err: "",
    out: `${bad.stderr}repo ci merge: 2 blobs, floors or tests failed (vitest's ERROR lines above)\n`,
  });
});

it("a single blob of 1 is a whole set", async () => {
  expect(await merge(blobs("blob-1-1.json"))).toMatchObject({ code: 0 });
});

it.each([
  ["a missing dir", {}],
  ["a dir with no blob", { "blobs/other.json": "[]" }],
])("%s: no blob-*.json, exit 1, vitest not run", async (_name, files) => {
  const run = await merge(files);
  expect(run).toMatchObject({ calls: [], code: 1, err: "repo ci merge: no blob-*.json in blobs\n", out: "" });
});

it("no vitest in the root reads as no blob, exit 1", async () => {
  const run = await merge(blobs("blob-1-2.json", "blob-2-2.json"), null);
  expect(run).toMatchObject({ code: 1, err: "repo ci merge: no blob-*.json in blobs\n", out: "" });
});

it.each([
  [["blob-1-3.json", "blob-1-2.json"], "blob-1-2.json, blob-1-3.json"],
  [["blob-1-2.json"], "blob-1-2.json"],
  [["blob-1-2.json", "blob-2-2.json", "blob-2-3.json"], "blob-1-2.json, blob-2-2.json, blob-2-3.json"],
  [["blob-1-2.json", "blob-x.json"], "blob-1-2.json, blob-x.json"],
  [["blob-2-2.json", "blob-3-2.json"], "blob-2-2.json, blob-3-2.json"],
])("blobs %j are not one whole set: refused, vitest not run", async (names, shown) => {
  const run = await merge(blobs(...names));
  expect(run).toMatchObject({
    calls: [],
    code: 1,
    err: `repo ci merge: blobs holds ${shown}; want blob-1-n … blob-n-n of one n\n`,
  });
});

it("is refused outside a repo", async () => {
  const err: string[] = [];

  const code = await mergeMain("blobs", {
    bins: { tsc: () => Promise.resolve(MERGED), vitest: () => Promise.resolve(MERGED) },
    cwd: "/",
    stderr: (s) => err.push(s),
    stdout: (s) => err.push(s),
  });

  expect(code).toBe(1);
  expect(err.join("")).toMatch(/^repo ci merge: no repo\.config\.ts in \//);
});

it("repo ci merge <dir> is dispatched from main to the root's vitest", async () => {
  const root = plant(blobs("blob-1-2.json", "blob-2-2.json"));
  const run = await ci(root, ["merge", "blobs"]);
  expect(run.code).toBe(0);
  expect(run.calls.vitest).toStrictEqual([`run --merge-reports=${path.join(root, "blobs")} --coverage`]);
  expect(run.out).toContain("repo ci merge: 2 blobs, 4 tests, every floor met\n");
});

it("repo ci merge <dir> without injected bins uses the real ones, which never run on a dir with no blob", async () => {
  const root = plant();
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(["merge", "blobs"], { cwd: root, stderr: (s) => err.push(s), stdout: (s) => out.push(s) });
  expect(code).toBe(1);
  expect(err.join("")).toBe("repo ci merge: no blob-*.json in blobs\n");
  expect(out).toStrictEqual([]);
});
