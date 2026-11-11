import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { exists, file, fixture, link, only, snapshot, syncWith, useSyncKit, write } from "./fixtures/sync-kit.ts";

useSyncKit();

it("rejects an output outside the repo before writing anything", async () => {
  const root = fixture();
  expect(await syncWith(root, only(file("a.txt"), file("../escape.txt")))).toEqual({
    code: 1,
    stderr: "repo sync: ../escape.txt: not a path inside the repo\nrepo sync: nothing written\n",
    stdout: "",
  });
  expect(exists(root, "a.txt")).toBe(false);
});

it("names a missing output, a changed one and a prunable one, and writes nothing", async () => {
  const root = fixture();
  await syncWith(root, only(file("changed.txt"), file("gone.txt"), file("missing.txt")));
  write(root, "changed.txt", "edited\n");
  fs.rmSync(path.join(root, "missing.txt"));
  const before = snapshot(root);

  expect(await syncWith(root, only(file("changed.txt"), file("missing.txt"), file("fresh.txt")), "--check")).toEqual({
    code: 1,
    stderr:
      "repo sync: changed.txt is out of date; run `bun repo sync`\n" +
      "repo sync: missing.txt is out of date; run `bun repo sync`\n" +
      "repo sync: fresh.txt is out of date; run `bun repo sync`\n" +
      "repo sync: gone.txt is stale and would be removed; run `bun repo sync`\n",
    stdout: "",
  });
  expect(snapshot(root)).toEqual(before);
});

it("fails on a link that is missing or wrong and passes once it is current", async () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "store"));
  const deps = only(link("l", "store"));
  const { code } = await syncWith(root, deps, "--check");
  expect(code).toBe(1);
  await syncWith(root, deps);
  expect(await syncWith(root, deps, "--check")).toEqual({ code: 0, stderr: "", stdout: "repo sync: up to date\n" });
});

it("groups outputs that share a top dir and keeps single files by name", async () => {
  const root = fixture();
  const outputs = [file("a.md"), file(".claude/x"), file(".claude/y/z"), file("docs/one.md"), file(".claude/w")];
  const { stdout } = await syncWith(root, only(...outputs));
  expect(stdout).toBe("repo sync: wrote a.md, .claude/ (3), docs/one.md\n");
  const { stdout: removed } = await syncWith(root, only());
  expect(removed).toBe("repo sync: removed .claude/ (3), a.md, docs/one.md\n");
});
