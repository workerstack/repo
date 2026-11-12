import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Captured } from "../cli/scripts/lint.ts";
import { tempDir, useTempDirs } from "../cli/sync/__fixtures__/temp-dirs.ts";
import { CLEAN, lines, makeTree, NOOP_FORMAT, REAL_FORMAT } from "./__fixtures__/fmt-parity-tree.ts";
import { run } from "./fmt-parity.ts";

useTempDirs();

const FAILED = { code: 2, stderr: "first complaint\nthe last complaint\n\n", stdout: "" };

describe("fmt-parity: a tool fails", () => {
  it("names the tool, its code and its last stderr line, and leaves deps.tmp empty", () => {
    const { dir, tmp } = makeTree();
    const { err, io, out } = lines();

    const code = run([dir], io, { format: { ...NOOP_FORMAT, oxfmt: () => FAILED }, tmp });

    expect(err).toStrictEqual([`fmt-parity: ${dir} as is: oxfmt exited 2: the last complaint`]);
    expect(out).toStrictEqual([]);
    expect(code).toBe(1);
    expect(fs.readdirSync(tmp)).toStrictEqual([]);
  });

  it("names bun fmt and the perturbed input when its second run fails", () => {
    const { dir, tmp } = makeTree();
    const { err, io } = lines();
    let runs = 0;

    function bun(): Captured {
      runs += 1;

      return runs === 1 ? CLEAN : FAILED;
    }

    const code = run([dir], io, { format: { ...NOOP_FORMAT, "bun fmt": bun }, tmp });

    expect(err).toStrictEqual([`fmt-parity: ${dir} perturbed: bun fmt exited 2: the last complaint`]);
    expect(code).toBe(1);
    expect(fs.readdirSync(tmp)).toStrictEqual([]);
  });
});

describe("fmt-parity: the tree or the argv is wrong", () => {
  it("asks for a sync when the tree has no .oxfmtrc.jsonc", () => {
    const { dir, tmp } = makeTree({ config: false });
    const { err, io } = lines();

    const code = run([dir], io, { format: NOOP_FORMAT, tmp });

    expect(err).toStrictEqual([`fmt-parity: ${dir} has no .oxfmtrc.jsonc; run bun repo sync there first`]);
    expect(code).toBe(1);
  });
});

describe("fmt-parity: the tree is not a git repo or a dir is missing", () => {
  it("refuses a tree that is not a git repo", () => {
    const { dir, tmp } = makeTree({ git: false });
    const { err, io } = lines();

    const code = run([dir], io, { format: NOOP_FORMAT, tmp });

    expect(err).toStrictEqual([
      `fmt-parity: ${dir} is not a git repo; its .gitignore decides what the formatters skip`,
    ]);
    expect(code).toBe(1);
  });

  it("refuses a dir that does not exist", () => {
    const missing = path.join(tempDir("fmt-parity-none-"), "nope");
    const { err, io } = lines();

    const code = run([missing], io, { format: REAL_FORMAT, tmp: tempDir("fmt-parity-tmp-") });

    expect(err).toStrictEqual([`fmt-parity: ${missing} does not exist`]);
    expect(code).toBe(1);
  });

  it("refuses an unknown flag and prints the usage", () => {
    const { io, err, out } = lines();

    const code = run(["--x"], io, { format: NOOP_FORMAT, tmp: tempDir("fmt-parity-tmp-") });

    expect(err).toStrictEqual(["fmt-parity: unknown flag --x; usage: bun dev/fmt-parity.ts [dir...]"]);
    expect(out).toStrictEqual([]);
    expect(code).toBe(1);
  });
});
