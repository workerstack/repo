import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { redundantIgnoreLines, redundantIgnoreReason } from "./redundant-ignore-lines.ts";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
});

function tmpDir(prefix: string) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function repo() {
  vi.stubEnv("GIT_DIR", undefined);
  vi.stubEnv("GIT_INDEX_FILE", undefined);
  const r = tmpDir("ignore-reason-");
  execFileSync("git", ["init", "-q"], { cwd: r });
  fs.writeFileSync(path.join(r, ".gitignore"), ".tmp/\n");
  fs.mkdirSync(path.join(r, "pkg"), { recursive: true });
  return r;
}

/** A git stand-in that forwards to the real git except for the named subcommand, which exits `code`. */
function fakeGit(failing: string, code: number) {
  const bin = path.join(tmpDir("ignore-fake-git-"), "git");
  const script = `#!/bin/sh\nfor a in "$@"; do [ "$a" = "${failing}" ] && exit ${code}; done\nexec git "$@"\n`;
  fs.writeFileSync(bin, script, { mode: 0o755 });
  return bin;
}

describe("redundantIgnoreReason", () => {
  it("names the first edit whose lines a parent already ignores", () => {
    const r = repo();
    const file = path.join(r, "pkg/.gitignore");
    const reason = redundantIgnoreReason([
      { added: [], file: path.join(r, "pkg/empty/.gitignore") },
      { added: ["fresh/"], file: path.join(r, "pkg/x/.gitignore") },
      { added: [".tmp/"], file },
    ]);
    expect(reason).toBe(
      `redundant .gitignore lines in ${file}: ".tmp/" (ignored by ${path.join(r, ".gitignore")}:1 .tmp/). ` +
        "Leave them out; the parent rules already ignore them",
    );
  });

  it("is null when no edit is redundant", () => {
    const r = repo();
    expect(redundantIgnoreReason([{ added: ["fresh/"], file: path.join(r, "pkg/.gitignore") }])).toBeNull();
    expect(redundantIgnoreReason([])).toBeNull();
  });
});

describe("redundantIgnoreLines when git misbehaves", () => {
  it("passes when the scratch repo cannot be created", () => {
    const r = repo();
    const git = fakeGit("init", 1);
    // rev-parse still works through the stand-in; only the scratch `git init` fails.
    expect(redundantIgnoreLines(path.join(r, "pkg/.gitignore"), [".tmp/"], { git })).toStrictEqual([]);
  });

  it("passes when check-ignore fails outright", () => {
    const r = repo();
    const git = fakeGit("check-ignore", 128);
    expect(redundantIgnoreLines(path.join(r, "pkg/.gitignore"), [".tmp/"], { git })).toStrictEqual([]);
  });

  it("judges a target whose directory does not exist yet by its nearest existing parent", () => {
    const r = repo();
    expect(redundantIgnoreLines(path.join(r, "pkg/new/deeper/.gitignore"), [".tmp/"])).toStrictEqual([
      { line: ".tmp/", rule: `${path.join(r, ".gitignore")}:1 .tmp/` },
    ]);
  });
});
