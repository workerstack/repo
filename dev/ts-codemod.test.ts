import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renamePass, runtimePass } from "./ts-codemod.ts";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const A_SRC = `#!/usr/bin/env node
import { shout } from "./b.mjs";

/**
 * @typedef {object} Opts
 * @property {string} name
 * @property {number} [count]
 */

/**
 * @param {string} name
 * @param {Opts} opts
 * @returns {string}
 */
export function greet(name, opts) {
  return shout(name) + opts.name;
}
`;

const B_SRC = `/**
 * @param {string} s
 * @returns {string}
 */
export function shout(s) {
  return s.toUpperCase();
}
`;

const FILES: Record<string, string> = {
  ".rulesync/scripts/a.mjs": A_SRC,
  ".rulesync/scripts/b.mjs": B_SRC,
  "README.md": "Run `node .rulesync/scripts/a.mjs` and see vitest.config.mjs.\nGlobs: dist/*.js and '*.mjs' stay, `.rulesync/scripts/a*.mjs` changes.\nAlso `node ./.rulesync/scripts/b.mjs`.\n",
  ".claude/settings.json": '{ "command": "node \\"$d/.rulesync/scripts/a.mjs\\"" }\n',
  ".rulesync/scripts/a.test.ts": "expect(cmd).toMatch(/a\\.mjs --x/);\nexpect(imp).toBe('./b.mjs');\nexpect(msg).toMatch(/run bun .*b\\.mjs index/);\n",
  ".rulesync/lessons/some.md": '---\npaths: [".rulesync/scripts/a.mjs", ".rulesync/scripts/a*.mjs"]\n---\nbody\n',
  "vitest.config.mjs": "export default {};\n",
  "CHANGELOG.md": "old a.mjs path\n",
  "bun.lock": "a.mjs\n",
  "blob.bin": "a.mjs\0binary",
};

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ts-codemod-"));
  tmpDirs.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  for (const [rel, text] of Object.entries(FILES)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return root;
}

const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("runtimePass", () => {
  it("switches node to bun on rename-set scripts only, then changes nothing", () => {
    const root = fixture();
    const res = runtimePass(root);
    expect(res.changed.sort()).toEqual([".claude/settings.json", ".rulesync/scripts/a.mjs", "README.md"].sort());
    expect(read(root, "README.md")).toContain("`bun .rulesync/scripts/a.mjs`");
    expect(read(root, "README.md")).toContain("`bun ./.rulesync/scripts/b.mjs`");
    expect(read(root, ".claude/settings.json")).toContain('bun \\"$d/.rulesync/scripts/a.mjs\\"');
    expect(read(root, ".rulesync/scripts/a.mjs").startsWith("#!/usr/bin/env bun\n")).toBe(true);
    expect(read(root, "CHANGELOG.md")).toBe(FILES["CHANGELOG.md"]);
    expect(runtimePass(root).changed).toEqual([]);
  });
});

describe("renamePass", () => {
  it("renames, rewrites every spelling, converts JSDoc to types and is idempotent", () => {
    const root = fixture();
    runtimePass(root);
    const res = renamePass(root);

    expect(fs.existsSync(path.join(root, ".rulesync/scripts/a.mjs"))).toBe(false);
    expect(res.changed).toContain(".rulesync/scripts/a.ts");
    expect(res.changed).toContain(".rulesync/scripts/b.ts");
    expect(res.changed).toContain("README.md");
    expect(res.changed).not.toContain("vitest.config.mjs");
    expect(res.changed).not.toContain("CHANGELOG.md");
    expect(execFileSync("git", ["ls-files", ".rulesync/scripts"], { cwd: root, encoding: "utf8" })).toContain("a.ts");

    const a = read(root, ".rulesync/scripts/a.ts");
    expect(a.startsWith("#!/usr/bin/env bun\n")).toBe(true);
    expect(a).toContain('from "./b.ts"');
    expect(a).toMatch(/\b(type|interface) Opts\b/);
    expect(a).not.toContain("@typedef");
    expect(a).toMatch(/name: string/);
    expect(a).toMatch(/opts: Opts/);
    expect(a).not.toMatch(/@param \{/);
    expect(a).not.toMatch(/@returns \{/);
    expect(read(root, ".rulesync/scripts/b.ts")).toMatch(/shout\(s: string\): string/);

    expect(read(root, "README.md")).toContain("`bun .rulesync/scripts/a.ts`");
    expect(read(root, "README.md")).toContain("vitest.config.mjs");
    expect(read(root, "README.md")).toContain("dist/*.js and '*.mjs' stay, `.rulesync/scripts/a*.ts` changes.");
    expect(read(root, ".claude/settings.json")).toContain('bun \\"$d/.rulesync/scripts/a.ts\\"');
    expect(read(root, ".rulesync/scripts/a.test.ts")).toContain("/a\\.ts --x/");
    expect(read(root, ".rulesync/scripts/a.test.ts")).toContain("'./b.ts'");
    expect(read(root, ".rulesync/scripts/a.test.ts")).toContain("/run bun .*b\\.ts index/");
    expect(read(root, ".rulesync/lessons/some.md")).toContain(
      'paths: [".rulesync/scripts/a.ts", ".rulesync/scripts/a*.ts"]',
    );
    expect(read(root, "vitest.config.mjs")).toBe(FILES["vitest.config.mjs"]);
    expect(read(root, "CHANGELOG.md")).toBe(FILES["CHANGELOG.md"]);
    expect(read(root, "bun.lock")).toBe(FILES["bun.lock"]);
    expect(read(root, "blob.bin")).toBe(FILES["blob.bin"]);

    expect(renamePass(root).changed).toEqual([]);
    expect(runtimePass(root).changed).toEqual([]);
  });

  it("leaves a glob alone when no rename-set name matches it", () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "notes.md"), "see zzz-*.mjs and q.mjs\n");
    execFileSync("git", ["add", "-A"], { cwd: root });
    renamePass(root);
    expect(read(root, "notes.md")).toBe("see zzz-*.mjs and q.mjs\n");
  });
});

describe("cli", () => {
  const cli = path.resolve(import.meta.dirname, "ts-codemod.ts");
  const run = (...args: string[]) => spawnSync("bun", [cli, ...args], { encoding: "utf8" });

  it("prints changed paths, then nothing to convert on a rerun", () => {
    const root = fixture();
    const first = run("rename", root);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain(".rulesync/scripts/a.ts");
    const again = run("rename", root);
    expect(again.status).toBe(0);
    expect(again.stdout.trim()).toBe("nothing to convert");
    expect(run("runtime", root).stdout.trim()).toBe("nothing to convert");
  });

  it("runs the runtime pass and defaults the root to the git toplevel", () => {
    const root = fixture();
    const res = spawnSync("bun", [cli, "runtime"], { cwd: path.join(root, ".rulesync"), encoding: "utf8" });
    expect(res.stdout).toContain("README.md");
    expect(read(root, "README.md")).toContain("bun .rulesync/scripts/a.mjs");
  });

  it("rejects an unknown pass", () => {
    const res = run("bogus");
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("usage");
  });
});
