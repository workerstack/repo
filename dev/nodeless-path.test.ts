import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { nodelessPath } from "./nodeless-path.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
});

function temp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nodeless-"));
  temps.push(dir);
  return dir;
}

describe("nodelessPath", () => {
  it("links every command but node and its package managers", () => {
    const root = temp();
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    for (const name of ["bun", "git", "node", "npm", "npx", "nodejs"]) fs.writeFileSync(path.join(bin, name), name);
    const dir = nodelessPath(root, bin);
    expect(fs.readdirSync(dir).sort()).toStrictEqual(["bun", "git"]);
    expect(fs.readFileSync(path.join(dir, "git"), "utf8")).toBe("git");
  });

  it("links a dangling link seen through two PATH dirs once", () => {
    const root = temp();
    const [a, b] = [path.join(root, "a"), path.join(root, "b")];
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    for (const d of [a, b]) fs.symlinkSync(path.join(root, "missing"), path.join(d, "dangling"));
    const dir = nodelessPath(root, [a, b].join(path.delimiter));
    expect(fs.readdirSync(dir)).toStrictEqual(["dangling"]);
    expect(fs.readlinkSync(path.join(dir, "dangling"))).toBe(path.join(a, "dangling"));
  });
});
