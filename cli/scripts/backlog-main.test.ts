import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { useCapturedRun } from "../__fixtures__/captured-run.ts";
import { USAGE } from "./backlog.constants.ts";
import { main } from "./backlog.ts";
import type { Roots } from "./workspace-root.ts";

const captured = useCapturedRun();

/** A temp root holding `text` as its backlog, or no file when `text` is null. */
function setup(text: string | null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-main-"));
  const file = path.join(root, ".repo", "backlog.md");

  captured.temps.push(root);

  if (text !== null) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }

  return { file, roots: { checkout: root, cwd: root, root } satisfies Roots };
}

function run(roots: Roots, ...argv: string[]): number {
  return main(argv, () => roots);
}

it("lists with no verb and prints the empty backlog for a missing file", () => {
  const { roots } = setup(null);

  expect(run(roots)).toBe(0);
  expect(captured.out).toStrictEqual(["backlog is empty\n"]);
});

it("exits 2 with usage for list with extra arguments", () => {
  const { roots } = setup(null);

  expect(run(roots, "list", "x")).toBe(2);
  expect(captured.err).toStrictEqual([`${USAGE}\n`]);
});

it("exits 2 for add with no text, done and start with no argument", () => {
  const { roots } = setup("- [ ] a\n");

  expect(run(roots, "add", " ")).toBe(2);
  expect(run(roots, "done")).toBe(2);
  expect(run(roots, "start")).toBe(2);
  expect(captured.err).toHaveLength(3);
});

it("exits 2 for clear with a bad flag or extra arguments", () => {
  const { roots } = setup("- [x] a\n");

  expect(run(roots, "clear", "--no")).toBe(2);
  expect(run(roots, "clear", "--yes", "x")).toBe(2);
});

it("says there are no done lines to clear", () => {
  const { roots } = setup("- [ ] a\n");

  expect(run(roots, "clear", "--yes")).toBe(0);
  expect(captured.out).toStrictEqual(["no done lines\n"]);
});

it("refuses text that matches no item", () => {
  const { roots } = setup("- [ ] a\n");

  expect(run(roots, "done", "zzz")).toBe(1);
  expect(captured.err).toStrictEqual(['no item matches "zzz"\n']);
});

it("says an item already in progress is in progress", () => {
  const { roots } = setup("- [-] a\n");

  expect(run(roots, "start", "1")).toBe(0);
  expect(captured.out).toStrictEqual(["line 1 is already in progress\n"]);
});

it("turns a done item back to in progress", () => {
  const { file, roots } = setup("- [x] a\n");

  expect(run(roots, "start", "a")).toBe(0);
  expect(fs.readFileSync(file, "utf8")).toBe("- [-] a\n");
});

it("flattens line breaks in add text", () => {
  const { file, roots } = setup(null);

  expect(run(roots, "add", "a\nb", "c")).toBe(0);
  expect(fs.readFileSync(file, "utf8")).toBe("- [ ] a b c\n");
});

it("adds to an empty existing file", () => {
  const { file, roots } = setup("");

  expect(run(roots, "add", "a")).toBe(0);
  expect(fs.readFileSync(file, "utf8")).toBe("- [ ] a\n");
  expect(captured.out).toStrictEqual([".repo/backlog.md:1  - [ ] a\n"]);
});

it("appends with CRLF to a CRLF file, with or without a trailing newline", () => {
  const { file, roots } = setup("- [ ] a\r\n");

  run(roots, "add", "b");
  expect(fs.readFileSync(file, "utf8")).toBe("- [ ] a\r\n- [ ] b\r\n");
  fs.writeFileSync(file, "- [ ] a\r\n- [ ] b");
  run(roots, "add", "c");
  expect(fs.readFileSync(file, "utf8")).toBe("- [ ] a\r\n- [ ] b\r\n- [ ] c\r\n");
});

it("appends with LF to an LF file with no trailing newline", () => {
  const { file, roots } = setup("x");

  run(roots, "add", "c");
  expect(fs.readFileSync(file, "utf8")).toBe("x\n- [ ] c\n");
});

it("exits 2 for an unknown verb", () => {
  const { roots } = setup(null);

  expect(run(roots, "frob")).toBe(2);
});

it("exits 1 with the message when the roots lookup throws", () => {
  expect(
    main(["list"], () => {
      throw new Error("no root");
    }),
  ).toBe(1);
  expect(captured.err).toStrictEqual(["no root\n"]);
});

it("lists items by box, then the count of lines that are not items", () => {
  const { roots } = setup("note\n- [x] a\n- [ ] b\n");

  expect(run(roots, "list")).toBe(0);
  expect(captured.out).toStrictEqual(["3  - [ ] b\n", "2  - [x] a\n", "1 lines are not items\n"]);
});

it("refuses a number past the end, a line that is not an item and an ambiguous text", () => {
  const { roots } = setup("note\n- [ ] ab\n- [ ] ac\n");

  expect(run(roots, "done", "9")).toBe(1);
  expect(run(roots, "done", "1")).toBe(1);
  expect(run(roots, "done", "a")).toBe(1);
  expect(captured.err).toStrictEqual([
    "no line 9 in .repo/backlog.md\n",
    "line 1 is not an item\n",
    '"a" matches lines 2, 3; pick one\n',
  ]);
});

it("says an item is already done and leaves the file alone", () => {
  const { roots } = setup("- [x] a\n");

  expect(run(roots, "done", "a")).toBe(0);
  expect(captured.out).toStrictEqual(["line 1 is already done\n"]);
});

it("asks before clearing, and clears with --yes", () => {
  const { file, roots } = setup("- [x] a\n- [ ] b\n");

  expect(run(roots, "clear")).toBe(0);
  expect(run(roots, "clear", "--yes")).toBe(0);
  expect(captured.out).toStrictEqual(["delete 1 done lines? rerun with --yes\n", "deleted 1 done lines\n"]);
  expect(fs.readFileSync(file, "utf8")).toBe("- [ ] b\n");
});

it("lists a last line with no newline and no lines that are not items", () => {
  const { roots } = setup("- [ ] a");

  expect(run(roots)).toBe(0);
  expect(captured.out).toStrictEqual(["1  - [ ] a\n"]);
});

it("finds its own roots from the working directory when none are given", () => {
  const { roots } = setup(null);

  vi.stubEnv("CLAUDE_PROJECT_DIR", "");
  vi.stubEnv("GROK_WORKSPACE_ROOT", "");
  process.chdir(roots.root);

  try {
    expect(main(["list"])).toBe(0);
  } finally {
    vi.unstubAllEnvs();
  }

  expect(captured.out).toStrictEqual(["backlog is empty\n"]);
});
