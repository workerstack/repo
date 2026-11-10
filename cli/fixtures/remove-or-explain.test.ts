import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WINDOWS_PLATFORM } from "../actionlint.constants.ts";
import { removeOrExplain } from "./remove-or-explain.ts";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) {
    try {
      fs.chmodSync(path.join(d, "locked"), 0o700);
    } catch {
      // not made by this case
    }
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "remove-or-explain-"));
  made.push(d);
  return d;
}

describe("removeOrExplain", () => {
  it("removes a dir with contents", () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, "a/b"), { recursive: true });
    fs.writeFileSync(path.join(d, "a/b/f"), "x");
    removeOrExplain(d);
    expect(fs.existsSync(d)).toBe(false);
  });

  it("returns for a path that is already gone", () => {
    const d = tmp();
    removeOrExplain(path.join(d, "missing"));
  });

  it.skipIf(process.platform === WINDOWS_PLATFORM || process.getuid?.() === 0)("throws naming the path when the parent cannot be written", () => {
    const d = tmp();
    const locked = path.join(d, "locked");
    const child = path.join(locked, "child");
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(path.join(child, "f"), "x");
    fs.chmodSync(locked, 0o500);
    expect(() => removeOrExplain(child)).toThrow(new RegExp(`could not remove ${child.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });
});
