import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fencedLineSet } from "./persist-plan.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const referenceDir = path.join(here, "..", "..", "references");

/** Structure errors a doc pasted over itself leaves behind: a heading repeated, or heading markup glued mid-line. */
function headingErrors(text: string) {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  const lines = text.split("\n");
  const { fenced } = fencedLineSet(lines);
  lines.forEach((line, i) => {
    if (fenced.has(i)) return;
    const bare = line.replace(/`[^`]*`/g, "");
    const heading = /^(#{1,6}) +(.*\S)\s*$/.exec(bare);
    if (heading) {
      const key = `${heading[1]} ${heading[2]}`;
      const first = seen.get(key);
      if (first) errors.push(`line ${i + 1}: repeated heading "${key}" (first at line ${first}): remove or rename it`);
      else seen.set(key, i + 1);
    }
    if (/[^\s#]#{1,6} /.test(bare)) errors.push(`line ${i + 1}: heading markup mid-line: put the heading on its own line`);
  });
  return errors;
}

describe("reference docs", () => {
  it("flags repeated and glued headings, not fenced or inline ones", () => {
    const text = ["## Path", "```md", "## Goal", "```", "see `## x` here", "## Path", "text# Plan format"].join("\n");
    expect(headingErrors(text)).toEqual([
      'line 6: repeated heading "## Path" (first at line 1): remove or rename it',
      "line 7: heading markup mid-line: put the heading on its own line",
    ]);
  });

  for (const name of fs.readdirSync(referenceDir).filter((n) => n.endsWith(".md"))) {
    it(`${name} has each heading once, each on its own line`, () => {
      expect(headingErrors(fs.readFileSync(path.join(referenceDir, name), "utf8"))).toEqual([]);
    });
  }
});

describe("references in the package", () => {
  it("every file in references/ is in the tarball", () => {
    const out = execFileSync("bun", ["pm", "pack", "--dry-run"], { cwd: path.join(here, "..", ".."), encoding: "utf8" });
    const packed = new Set(
      out
        .split("\n")
        .map((line) => /^packed\s+\S+\s+(.+?)\s*$/.exec(line)?.[1])
        .filter((p): p is string => Boolean(p)),
    );
    const names = fs.readdirSync(referenceDir).filter((n) => n.endsWith(".md"));
    expect(names).toContain("INDEX.md");
    expect(names.filter((n) => !packed.has(`references/${n}`))).toEqual([]);
  });
});

describe("repo commands in tracked text", () => {
  const COMMAND_SCRIPTS = "job|worktree|lessons|browser|google-workspace|jev|listen|speak|setup|doctor|clean|sync-global-settings|purge-global-mcps|vscode-tasks|folder-map";
  const BY_PATH = new RegExp(`\\b(?:bun|node)\\s+(?:\\./)?(?:[^\\s\`'"()]*/)?\\.rulesync/scripts/(?:${COMMAND_SCRIPTS})\\.ts\\b`);
  const repoRoot = path.join(here, "..", "..");
  const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(?:md|ts|json|jsonc|toml)$/.test(f) && !/\.test\.ts$|(?:^|\/)fixtures\/|^CHANGELOG\.md$|^\.rulesync\/lessons\/|^dev\/codemod-[^/]*\.ts$/.test(f));

  it("say bun repo <cmd>: no script path, no bunx repo, no bare `repo <cmd>`", () => {
    const hits: string[] = [];
    for (const f of tracked) {
      const lines = fs.readFileSync(path.join(repoRoot, f), "utf8").split("\n");
      const bare = f.endsWith(".md") ? /(?<![\\\w])`repo [a-z]/ : /\\`repo [a-z]/;
      lines.forEach((line, i) => {
        if (BY_PATH.test(line) || /\bbunx repo\b/.test(line) || bare.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

describe("paths in references", () => {
  /** Read from the package, `../` lands in `node_modules/@workerstack/`: a repo file is named root-relative. */
  it("none names a ../ path outside fenced code, except the symlink target in map.md", () => {
    const hits: string[] = [];
    for (const name of fs.readdirSync(referenceDir).filter((n) => n.endsWith(".md"))) {
      const lines = fs.readFileSync(path.join(referenceDir, name), "utf8").split("\n");
      const { fenced } = fencedLineSet(lines);
      lines.forEach((line, i) => {
        if (fenced.has(i)) return;
        const rest = line.replace("a relative symlink to `../../.agents/skills/<name>`", "");
        if (rest.includes("../")) hits.push(`${name}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

describe("stock references in tracked text", () => {
  const repoRoot = path.join(here, "..", "..");
  /** `cli/init.ts` and the e2e specs name the old directory to clean it up or assert it is gone; the codemod holds the pattern it rewrites. */
  const ALLOWED = /\.test\.ts$|(?:^|\/)fixtures\/|^CHANGELOG\.md$|^\.rulesync\/lessons\/|\.e2e\.ts$|^cli\/init\.ts$|^dev\/codemod-[^/]*\.ts$/;
  it("none names .rulesync/reference: they live in references/ and are read from the package", () => {
    const hits: string[] = [];
    const files = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .filter((f) => f && !ALLOWED.test(f) && fs.statSync(path.join(repoRoot, f), { throwIfNoEntry: false })?.isFile());
    for (const f of files) {
      fs.readFileSync(path.join(repoRoot, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (line.includes(".rulesync/reference")) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
