import fs from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { useTempDirs } from "../cli/sync/__fixtures__/temp-dirs.ts";
import { lines, makeTree, narrowBun, NOOP_FORMAT, REAL_FORMAT } from "./__fixtures__/fmt-parity-tree.ts";
import { run } from "./fmt-parity.ts";

useTempDirs();

const SLOW = 120_000;

describe("fmt-parity: real tools", () => {
  it(
    "reports 0 differing files as is and perturbed, and leaves deps.tmp empty",
    () => {
      const { dir, files, tmp } = makeTree();
      const { err, io, out } = lines();

      const code = run([dir], io, { format: REAL_FORMAT, tmp });

      expect(out).toStrictEqual([
        `fmt-parity: ${dir} as is: 0 of ${files.length} files differ`,
        `fmt-parity: ${dir} perturbed: 0 of ${files.length} files differ`,
      ]);
      expect(err).toStrictEqual([]);
      expect(code).toBe(0);
      expect(fs.readdirSync(tmp)).toStrictEqual([]);
    },
    SLOW,
  );
});

describe("fmt-parity: one tool drifts", () => {
  it(
    "names a file one tool lays out differently, counts it, exits 1 and leaves deps.tmp empty",
    () => {
      const { dir, files, tmp } = makeTree();
      const { io, out } = lines();

      const code = run([dir], io, { format: { ...REAL_FORMAT, "bun fmt": narrowBun }, tmp });

      expect(code).toBe(1);
      expect(out).toContain(`fmt-parity: ${dir} as is: long.ts differs`);
      expect(out).toContain(`fmt-parity: ${dir} as is: synced.json differs`);
      expect(out).toContain(`fmt-parity: ${dir} as is: 2 of ${files.length} files differ`);
      expect(out).not.toContain(`fmt-parity: ${dir} as is: a.ts differs`);
      expect(fs.readdirSync(tmp)).toStrictEqual([]);
    },
    SLOW,
  );
});

describe("fmt-parity: argv", () => {
  it("labels the tree `.` when no dir is given and runs in the current directory", () => {
    const { dir, files, tmp } = makeTree();
    const { io, out } = lines();
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);

    const code = run([], io, { format: NOOP_FORMAT, tmp });

    cwd.mockRestore();
    expect(out).toStrictEqual([
      `fmt-parity: . as is: 0 of ${files.length} files differ`,
      `fmt-parity: . perturbed: 0 of ${files.length} files differ`,
    ]);
    expect(code).toBe(0);
  });

  it("reports each named tree in turn", () => {
    const first = makeTree();
    const second = makeTree();
    const { io, out } = lines();

    const code = run([first.dir, second.dir], io, { format: NOOP_FORMAT, tmp: first.tmp });

    expect(out.map((line) => line.split(" ").slice(0, 2).join(" "))).toStrictEqual([
      `fmt-parity: ${first.dir}`,
      `fmt-parity: ${first.dir}`,
      `fmt-parity: ${second.dir}`,
      `fmt-parity: ${second.dir}`,
    ]);
    expect(code).toBe(0);
  });
});
