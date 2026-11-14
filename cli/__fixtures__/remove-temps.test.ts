import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WINDOWS_PLATFORM } from "../actionlint.constants.ts";
import { removeTemps } from "./remove-temps.ts";

const made: string[] = [];
const locked: string[] = [];

afterEach(() => {
  for (const dir of locked.splice(0)) fs.chmodSync(dir, 0o700);
  removeTemps(made.splice(0));
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remove-temps-"));
  made.push(dir);

  return dir;
}

/** A dir with a file in it, inside a parent nobody may write, so it cannot be removed. */
function stuck(): string {
  const parent = tmp();
  const dir = path.join(parent, "stuck");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "f"), "x");
  fs.chmodSync(parent, 0o500);
  locked.push(parent);

  return dir;
}

describe("removeTemps", () => {
  it("does nothing for no dirs", () => {
    removeTemps([]);
  });

  it("removes every dir and a path that is already gone", () => {
    const a = tmp();
    fs.writeFileSync(path.join(a, "f"), "x");
    removeTemps([a, path.join(tmp(), "missing")]);
    expect(fs.existsSync(a)).toBe(false);
  });

  it.skipIf(process.platform === WINDOWS_PLATFORM || process.getuid?.() === 0)(
    "keeps going past a dir it cannot remove, then names it with its code and what is left",
    () => {
      const bad = stuck();
      const good = tmp();
      let thrown: unknown;
      try {
        removeTemps([bad, good]);
      } catch (error) {
        thrown = error;
      }
      expect(fs.existsSync(good)).toBe(false);
      expect(thrown).toBeInstanceOf(Error);
      const lines = (thrown as Error).message.split("\n");
      expect(lines[0]).toBe("could not remove 1 temp dir:");
      expect(lines[1]).toMatch(new RegExp(`^${bad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: EACCES: .*; left: \\. mode=`));
      expect(lines).toHaveLength(2);
    },
  );
});
