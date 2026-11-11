import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { main } from "./phase-files.ts";

const PLAN = `---
serial: 7
name: x
---

## Steps
1 [ ] Read
2 [ ] Command (parallel: src/a.ts)
2.1 [ ] one
`;

const tmpDirs: string[] = [];

function plant(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "phase-files-edge-")));
  tmpDirs.push(dir);
  return dir;
}

function capture() {
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(process.stderr, "write").mockImplementation((s) => (err.push(String(s)), true));
  return err;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
});

describe("phase-files edges", () => {
  it("rejects a phase list with no phase in it", () => {
    const dir = plant();
    const plan = path.join(dir, "7-x.md");
    fs.writeFileSync(plan, PLAN);
    const err = capture();
    expect(main([plan, " , ,"], dir)).toBe(2);
    expect(err.join("")).toContain("usage: repo phase-files");
  });

  it("reports a git failure that carries no stderr by its message", () => {
    const dir = plant();
    const plan = path.join(dir, "7-x.md");
    fs.writeFileSync(plan, PLAN);
    const missing = path.join(dir, "gone");
    const err = capture();
    expect(main([plan, "2"], missing)).toBe(2);
    expect(err.join("")).toContain(`git status failed in ${missing}: `);
    expect(err.join("")).toContain("ENOENT");
  });
});

describe("phase-files defaults", () => {
  it("looks in the process cwd when none is given", () => {
    const dir = plant();
    const err = capture();
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    expect(main(["7", "2"])).toBe(2);
    expect(err.join("")).toContain("no plan 7 in ");
  });

  it("skips plan files whose name does not start with a serial", () => {
    const dir = plant();
    fs.mkdirSync(path.join(dir, ".tmp/repo/plans"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".tmp/repo/plans/notes.md"), PLAN);
    fs.writeFileSync(path.join(dir, ".tmp/repo/plans/7-x.txt"), PLAN);
    const err = capture();
    expect(main(["7", "2"], dir)).toBe(2);
    expect(err.join("")).toContain("no plan 7 in ");
  });
});
