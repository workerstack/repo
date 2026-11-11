import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { inDir, plant, plantFiles, stashDirOf, useJobEnv } from "./fixtures/job-kit.ts";
import { runSlice } from "./job-exec.ts";

useJobEnv();

const rows = Array.from({ length: 30 }, (_, i) => (i === 10 ? "AgentChatInterface 11" : `row ${i + 1}`));

/** A planted root with a 30-line stash `search-g7k.txt` (no final newline); returns the root. */
function withStash(): string {
  const dir = plant();
  plantFiles(stashDirOf(dir), { "search-g7k.txt": rows.join("\n") });
  return dir;
}

const MISSING = "Command failed.\n- missing stash\n";

it("runSlice prints the lines from a start line to an end line", () => {
  const dir = withStash();
  const both = runSlice({ cwd: dir, from: "5", root: dir, stash: "g7k", to: "6" });
  expect(both).toStrictEqual({ code: 0, fallback: false, text: "2 lines.\n- stash:5 — row 5\n- stash:6 — row 6\n" });
  const upTo = runSlice({ cwd: dir, root: dir, stash: "g7k", to: "2" });
  expect(upTo.text).toBe("2 lines.\n- stash:1 — row 1\n- stash:2 — row 2\n");
  const from = runSlice({ cwd: dir, from: "29", root: dir, stash: "g7k" });
  expect(from.text).toBe("2 lines.\n- stash:29 — row 29\n- stash:30 — row 30\n");
});

it("runSlice takes numbers as well as text, and no range for blanks or words", () => {
  const dir = withStash();
  const num = runSlice({ cwd: dir, from: 29, root: dir, stash: "g7k", to: 29 });
  expect(num.text).toBe("1 line.\n- stash:29 — row 29\n");
  const one = runSlice({ cwd: dir, from: "abc", root: dir, stash: "g7k", to: "2" });
  expect(one.text).toBe("2 lines.\n- stash:1 — row 1\n- stash:2 — row 2\n");
  for (const range of [{}, { from: null, to: null }, { from: "", to: "" }, { from: "x", to: "y" }])
    expect(runSlice({ stash: "g7k", ...range, cwd: dir, root: dir }).text).toMatch(/^30 lines, 6 shown\. stash=/);
});

it("runSlice keeps only the lines that hold the filter", () => {
  const dir = withStash();
  const hit = runSlice({ cwd: dir, path: "AgentChat", root: dir, stash: "g7k" });
  expect(hit.text).toBe("1 line.\n- stash:11 — AgentChatInterface 11\n");
  const ranged = runSlice({ cwd: dir, from: "1", path: "row", root: dir, stash: "g7k", to: "2" });
  expect(ranged.text).toBe("2 lines.\n- stash:1 — row 1\n- stash:2 — row 2\n");
  expect(runSlice({ cwd: dir, path: "nowhere", root: dir, stash: "g7k" }).text).toBe("No output.\n");
});

it("runSlice shows six of a longer slice and names the stash relative to the root", () => {
  const dir = withStash();
  const r = runSlice({ cwd: dir, root: dir, stash: "g7k" });
  expect(r.text).toBe(
    [
      "30 lines, 6 shown. stash=.tmp/repo/stash/search-g7k.txt",
      "- stash:1 — row 1",
      "- stash:2 — row 2",
      "- stash:3 — row 3",
      "- stash:4 — row 4",
      "- stash:5 — row 5",
      "- stash:30 — row 30",
      "",
    ].join("\n"),
  );
});

it("runSlice names the stash absolutely when it runs away from the root", () => {
  const dir = withStash();
  const sub = path.join(dir, "pkg");
  fs.mkdirSync(sub);
  const r = runSlice({ cwd: sub, root: dir, stash: "g7k" });
  const abs = path.join(dir, ".tmp", "repo", "stash", "search-g7k.txt");
  expect(r.text.split("\n")[0]).toBe(`30 lines, 6 shown. stash=${abs}`);
});

it("runSlice finds the stash under the process cwd when it is given no places", () => {
  const dir = withStash();
  const r = inDir(dir, () => runSlice({ from: "1", stash: "g7k", to: "1" }));
  expect(r.text).toBe("1 line.\n- stash:1 — row 1\n");
  expect(inDir(dir, () => runSlice()).text).toBe(MISSING);
});

it("runSlice reports a missing stash as a failure, never as a fallback", () => {
  const dir = plant();
  const r = runSlice({ cwd: dir, root: dir, stash: "nope" });
  expect(r).toStrictEqual({ code: 0, fallback: false, text: MISSING });
  expect(runSlice({ cwd: dir, root: dir, stash: "../../etc/passwd" }).text).toBe(MISSING);
});

it("runSlice reports a stash that is a directory as missing", () => {
  const dir = plant();
  fs.mkdirSync(path.join(stashDirOf(dir), "search-dir.txt"));
  expect(runSlice({ cwd: dir, root: dir, stash: "dir" }).text).toBe(MISSING);
});

it("runSlice refuses a binary stash", () => {
  const dir = plant();
  plantFiles(stashDirOf(dir), { "exec-bin.txt": "a\0b\n" });
  const r = runSlice({ cwd: dir, root: dir, stash: "bin" });
  expect(r.text).toBe("Command failed.\n- binary stash\n");
});
