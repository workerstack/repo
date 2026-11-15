import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { REF, ZERO, consumer, git, gitMain, stdinOf } from "./__fixtures__/link-push-world.ts";
import { NAME, put, scene } from "./__fixtures__/link-world.ts";
import { main } from "./link.ts";

function movedTo(id: string): string {
  return `${ZERO} ${id} ${REF}`;
}

it("--hook pushes when main is out, clean and at the new id", async () => {
  const w = scene();
  const head = gitMain(w);
  const one = consumer(w, "one");
  expect(await main(["push", "--hook"], w.io(), stdinOf(movedTo(head)))).toBe(0);
  expect(w.out).toStrictEqual([`repo link: pushed ${NAME} 0.4.0-dev to ${one}`]);
});

it("--hook acts on the line for the default branch among others, and ignores untracked files", async () => {
  const w = scene();
  const head = gitMain(w);
  put(w.main, { "stray.txt": "x" });
  consumer(w, "one");
  await main(["push", "--hook"], w.io(), stdinOf(`${ZERO} ${head} refs/heads/other`, `${ZERO} ${head} ${REF}`));
  expect(w.out).toHaveLength(1);
});

it.each([
  ["another ref", (head: string) => `${ZERO} ${head} refs/heads/other`],
  ["a deletion", (head: string) => `${head} ${ZERO} ${REF}`],
  ["old equal to new", (head: string) => `${head} ${head} ${REF}`],
  ["a blank line", () => ""],
])("--hook does nothing for %s", async (_label, line) => {
  const w = scene();
  const head = gitMain(w);
  consumer(w, "one");
  expect(await main(["push", "--hook"], w.io(), stdinOf(line(head)))).toBe(0);
  expect(w.out).toStrictEqual([]);
  expect(w.err).toStrictEqual([]);
});

it("--hook warns and pushes nothing when the head is not the new id", async () => {
  const w = scene();
  gitMain(w);
  consumer(w, "one");
  expect(await main(["push", "--hook"], w.io(), stdinOf(movedTo("1".repeat(40))))).toBe(0);
  expect(w.out).toStrictEqual([]);
  expect(w.err).toStrictEqual([
    `repo link: warning: main moved but ${w.main} does not have it checked out clean; pushed nothing`,
  ]);
});

it("--hook warns when another branch is out, or tracked files changed", async () => {
  const w = scene();
  const head = gitMain(w);
  consumer(w, "one");
  fs.appendFileSync(path.join(w.main, "package.json"), " ");
  await main(["push", "--hook"], w.io(), stdinOf(movedTo(head)));
  git(w.main, "checkout", "-q", "--", "package.json");
  git(w.main, "checkout", "-q", "-b", "topic");
  await main(["push", "--hook"], w.io(), stdinOf(movedTo(head)));
  expect(w.out).toStrictEqual([]);
  expect(w.err).toHaveLength(2);
});

it("--hook pushes when the index is stale but the files equal the new commit", async () => {
  const w = scene();
  const head = gitMain(w);
  const one = consumer(w, "one");
  const file = path.join(w.main, "package.json");
  const original = fs.readFileSync(file, "utf8");
  fs.appendFileSync(file, " ");
  git(w.main, "add", "package.json");
  fs.writeFileSync(file, original);
  await main(["push", "--hook"], w.io(), stdinOf(movedTo(head)));
  expect(w.out).toStrictEqual([`repo link: pushed ${NAME} 0.4.0-dev to ${one}`]);
});

it("--hook returns 0 even when it fails, and prints why", async () => {
  const w = scene();
  expect(await main(["push", "--hook"], w.io(), () => Promise.reject(new Error("no stdin")))).toBe(0);
  expect(w.err).toStrictEqual(["repo link: no stdin"]);
});
