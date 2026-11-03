import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ignoreTarget,
  parentIgnoreFiles,
  projectEdit,
  redundantIgnoreLines,
  shellIgnoreEdits,
} from "./gitignore-guard.mjs";

const tmpDirs: string[] = [];
const savedEnv = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpDir(prefix: string) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(dir);
  return dir;
}

function put(root: string, rel: string, text: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

/** A git repo with root `.gitignore` `.tmp/` and `*.log`, and `packages/c/.gitignore` `dist-local/`. */
function repo() {
  const r = tmpDir("ignore-guard-");
  execFileSync("git", ["init", "-q"], { cwd: r });
  put(r, ".gitignore", ".tmp/\n*.log\n");
  put(r, "packages/c/.gitignore", "dist-local/\n");
  fs.mkdirSync(path.join(r, "packages/a"), { recursive: true });
  return r;
}

describe("redundantIgnoreLines", () => {
  it("names the parent rule that already ignores each added line", () => {
    const r = repo();
    expect(redundantIgnoreLines(path.join(r, "packages/a/.gitignore"), [".tmp/"])).toEqual([
      { line: ".tmp/", rule: `${path.join(r, ".gitignore")}:1 .tmp/` },
    ]);
    expect(redundantIgnoreLines(path.join(r, "packages/c/sub/.gitignore"), ["dist-local/"])).toEqual([
      { line: "dist-local/", rule: `${path.join(r, "packages/c/.gitignore")}:1 dist-local/` },
    ]);
  });

  it("allows lines the parents miss, globs, negations, mixed writes, the root file and non-git dirs", () => {
    const r = repo();
    const a = path.join(r, "packages/a/.gitignore");
    expect(redundantIgnoreLines(a, ["dist-local/"])).toEqual([]);
    expect(redundantIgnoreLines(a, ["*.tmp"])).toEqual([]);
    expect(redundantIgnoreLines(a, ["!keep"])).toEqual([]);
    expect(redundantIgnoreLines(a, [".tmp/", "out/"])).toEqual([]);
    expect(redundantIgnoreLines(path.join(r, ".gitignore"), [".tmp/"])).toEqual([]);
    const loose = tmpDir("ignore-loose-");
    put(loose, ".gitignore", ".tmp/\n");
    expect(redundantIgnoreLines(path.join(loose, "a/.gitignore"), [".tmp/"])).toEqual([]);
  });

  it("counts only the parent .gitignore files", () => {
    const r = repo();
    const a = path.join(r, "packages/a/.gitignore");
    put(r, ".git/info/exclude", "secret/\n");
    const home = tmpDir("ignore-home-");
    put(home, "excludes", "secret/\n");
    put(home, "template/info/exclude", "secret/\n");
    put(home, "gitconfig", `[core]\n\texcludesFile = ${path.join(home, "excludes")}\n[init]\n\ttemplateDir = ${path.join(home, "template")}\n`);
    process.env.GIT_CONFIG_GLOBAL = path.join(home, "gitconfig");
    expect(redundantIgnoreLines(a, ["secret/"])).toEqual([]);
    put(r, "packages/a/.gitignore", "foo/\n");
    expect(redundantIgnoreLines(a, ["foo/"])).toEqual([]);
    const other = repo();
    process.env.GIT_DIR = path.join(other, ".git");
    expect(redundantIgnoreLines(a, [".tmp/"])).toEqual([{ line: ".tmp/", rule: `${path.join(r, ".gitignore")}:1 .tmp/` }]);
  });

  it("keeps an unanchored line that a parent covers only at the top of its dir", () => {
    const r = repo();
    put(r, ".gitignore", "/packages/a/build/\n");
    const a = path.join(r, "packages/a/.gitignore");
    expect(redundantIgnoreLines(a, ["build/"])).toEqual([]);
    expect(redundantIgnoreLines(a, ["/build/"])).toEqual([{ line: "/build/", rule: `${path.join(r, ".gitignore")}:1 /packages/a/build/` }]);
  });
});

describe("shellIgnoreEdits", () => {
  const forms = [
    "echo .tmp/ > packages/a/.gitignore",
    "echo '.tmp/' >> packages/a/.gitignore",
    "printf '.tmp/\\n' >> packages/a/.gitignore",
    "cat <<'EOF' >> packages/a/.gitignore\n.tmp/\nEOF",
    "cat > packages/a/.gitignore <<EOF\n.tmp/\nEOF",
    "echo .tmp/ | tee -a packages/a/.gitignore",
    "tee packages/a/.gitignore <<'EOF'\n.tmp/\nEOF",
  ];
  it.each(forms)("reads the added lines of %j", (command) => {
    const r = repo();
    put(r, "packages/a/.gitignore", "out/\n");
    expect(shellIgnoreEdits(command, r)).toEqual([{ file: path.join(r, "packages/a/.gitignore"), added: [".tmp/"] }]);
  });

  const passes = [
    "cd packages/a && echo .tmp/ >> .gitignore",
    "echo $X >> packages/a/.gitignore",
    "printf '%s\\n' x >> packages/a/.gitignore",
    "sed -i 's/a/b/' packages/a/.gitignore",
    "cat <<EOF >> packages/a/.gitignore\n$HOME\nEOF",
  ];
  it.each(passes)("leaves %j alone", (command) => {
    expect(shellIgnoreEdits(command, repo())).toEqual([]);
  });
});

describe("projectEdit", () => {
  it("applies Claude edits, Antigravity replacements and chunks, and fails on a missing old string", () => {
    expect(projectEdit("a\nb\n", { edits: [{ old_string: "a", new_string: "x" }, { oldString: "b", newString: "y" }] })).toBe("x\ny\n");
    expect(projectEdit("a\nb\n", { TargetContent: "b", ReplacementContent: "b\nc" })).toBe("a\nb\nc\n");
    expect(
      projectEdit("a a\nb\n", {
        ReplacementChunks: [
          { TargetContent: "a", ReplacementContent: "z", AllowMultiple: true },
          { TargetContent: "b", ReplacementContent: "q" },
        ],
      }),
    ).toBe("z z\nq\n");
    expect(projectEdit("a\n", { old_string: "missing", new_string: "x" })).toBeNull();
  });
});

describe("paths", () => {
  it("resolves only .gitignore targets, on win32 too", () => {
    expect(ignoreTarget("packages\\a\\.gitignore", "C:\\r", path.win32)).toBe("C:\\r\\packages\\a\\.gitignore");
    expect(ignoreTarget("packages/a/notes.md", "/r")).toBeNull();
    expect(parentIgnoreFiles("C:\\r\\packages\\a\\.gitignore", "C:/r", path.win32)).toEqual([".gitignore", "packages/.gitignore"]);
    expect(parentIgnoreFiles("/r/.gitignore", "/r")).toEqual([]);
  });
});
