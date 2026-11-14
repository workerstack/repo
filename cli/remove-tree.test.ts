import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { removeTemps } from "./__fixtures__/remove-temps.ts";
import { removeTree } from "./remove-tree.ts";

const made: string[] = [];

afterEach(() => {
  removeTemps(made.splice(0));
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remove-tree-"));
  made.push(dir);

  return dir;
}

/** A dir holding `a/b/f`. */
function tree(): string {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "a/b"), { recursive: true });
  fs.writeFileSync(path.join(dir, "a/b/f"), "x");

  return dir;
}

function fsError(code: string, target: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: failed, rm '${target}'`), { code, path: target });
}

/** An rm that throws `codes` in turn, one per call, then removes for real; it counts its calls. */
function failing(...codes: string[]) {
  const seen = { calls: 0 };

  const rm = ((p: fs.PathLike, options?: fs.RmOptions) => {
    const code = codes[seen.calls];
    seen.calls += 1;

    if (code !== undefined) throw fsError(code, String(p));
    fs.rmSync(p, options);
  }) /* the stand-in takes the path and options removeTree passes */ as typeof fs.rmSync;

  return { rm, seen };
}

/** An rm that always throws `code`. */
function always(code: string) {
  const seen = { calls: 0 };

  const rm = ((p: fs.PathLike) => {
    seen.calls += 1;
    throw fsError(code, String(p));
  }) /* the stand-in takes the path removeTree passes */ as typeof fs.rmSync;

  return { rm, seen };
}

function noSleep(): void {
  // the tests need no real wait
}

it("removeTree removes a dir with contents", () => {
  const dir = tree();
  removeTree(dir);
  expect(fs.existsSync(dir)).toBe(false);
});

it("removeTree returns for a path that is already gone", () => {
  const { rm, seen } = always("EBUSY");
  removeTree(path.join(tmp(), "missing"), rm, noSleep);
  expect(seen.calls).toBe(0);
});

it("removeTree removes a link whose target is gone", () => {
  const dir = tmp();
  const link = path.join(dir, "link");
  fs.symlinkSync(path.join(dir, "missing"), link);
  removeTree(link);
  expect(fs.readdirSync(dir)).toStrictEqual([]);
});

it("removeTree removes a dir that is busy twice, in three calls", () => {
  const dir = tree();
  const { rm, seen } = failing("EBUSY", "EPERM");
  removeTree(dir, rm, noSleep);
  expect(seen.calls).toBe(3);
  expect(fs.existsSync(dir)).toBe(false);
});

it("removeTree tries again when rm throws ENOENT once while the dir is still there", () => {
  const dir = tree();
  const { rm, seen } = failing("ENOENT");
  removeTree(dir, rm, noSleep);
  expect(seen.calls).toBe(2);
  expect(fs.existsSync(dir)).toBe(false);
});

it("removeTree throws ENOENT after ten calls when rm keeps throwing it and the dir stays", () => {
  const dir = tree();
  const { rm, seen } = always("ENOENT");
  expect(() => removeTree(dir, rm, noSleep)).toThrow(expect.objectContaining({ code: "ENOENT", path: dir }));
  expect(seen.calls).toBe(10);
});

it("removeTree throws ENOTEMPTY naming the dir when rm returns but leaves it", () => {
  const dir = tree();
  let calls = 0;

  const rm = (() => {
    calls += 1;
  }) /* the stand-in ignores what removeTree passes */ as typeof fs.rmSync;

  expect(() => removeTree(dir, rm, noSleep)).toThrow(expect.objectContaining({ code: "ENOTEMPTY", path: dir }));
  expect(calls).toBe(10);
});

it("removeTree throws an error it does not retry at once, unchanged", () => {
  const dir = tree();
  const { rm, seen } = always("EACCES");
  expect(() => removeTree(dir, rm, noSleep)).toThrow(expect.objectContaining({ code: "EACCES", path: dir }));
  expect(seen.calls).toBe(1);
});

it("removeTree throws an error with no code at once", () => {
  const dir = tree();
  const plain = new Error("broken");

  const rm = (() => {
    throw plain;
  }) /* the stand-in ignores what removeTree passes */ as typeof fs.rmSync;

  expect(() => removeTree(dir, rm, noSleep)).toThrow(plain);
});

it("removeTree throws the busy error after ten calls, waiting longer each time", () => {
  const dir = tree();
  const { rm, seen } = always("EBUSY");
  const waits: number[] = [];

  function record(ms: number): void {
    waits.push(ms);
  }

  expect(() => removeTree(dir, rm, record)).toThrow(expect.objectContaining({ code: "EBUSY" }));
  expect(seen.calls).toBe(10);
  expect(waits).toStrictEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
});

it("removeTree waits for real by default between tries", () => {
  const dir = tree();
  const { rm } = failing("EBUSY");
  const started = Date.now();
  removeTree(dir, rm);
  expect(Date.now() - started).toBeGreaterThanOrEqual(90);
});
