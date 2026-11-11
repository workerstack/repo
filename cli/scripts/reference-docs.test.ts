import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { fencedLineSet } from "./persist-sections.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const referenceDir = path.join(here, "..", "..", "references");
const repoRoot = path.join(here, "..", "..");

const HEADING = /^(#{1,6}) +(.*\S)\s*$/;
const INLINE_CODE = /`[^`]*`/g;
const GLUED_HEADING = /[^\s#]#{1,6} /;
const PACKED_LINE = /^packed\s+\S+\s+(.+?)\s*$/;

const TEXT_FILE = /\.(?:md|ts|json|jsonc|toml)$/;
const TEST_FILE = /\.test\.ts$/;
const FIXTURE_DIR = /(?:^|\/)fixtures\//;
const CHANGELOG = /^CHANGELOG\.md$/;
const LESSON_BODIES = /^\.repo\/lessons\//;
const INIT_FILE = /^cli\/init\.ts$/;
const INIT_CONSTANTS = /^cli\/init\.constants\.ts$/;
const MIGRATIONS = /^cli\/sync\/(?:migrat(?:e|ion)[\w.-]*\.ts|stock-history\.(?:ts|json))$/;

const MD_BARE_REPO = /(?<![\\\w])`repo [a-z]/;
const TS_BARE_REPO = /\\`repo [a-z]/;
const BUNX_REPO = /\bbunx repo\b/;

const COMMAND_SCRIPTS = [
  "job|worktree|lessons|browser|google-workspace|jev|listen|speak|setup|doctor",
  "clean|sync-global-settings|purge-global-mcps|vscode-tasks|folder-map",
].join("|");
const BY_PATH = new RegExp(`\\b(?:bun|node)\\s+(?:\\./)?(?:[^\\s\`'"()]*/)?cli/scripts/(?:${COMMAND_SCRIPTS})\\.ts\\b`);

/** One regex matching any of `parts`. */
function anyOf(...parts: RegExp[]): RegExp {
  return new RegExp(parts.map((part) => part.source).join("|"));
}

/** Files that name the old spelling on purpose: tests and fixtures assert it is gone; the rest is history. */
const OLD_SPELLING_EXEMPT = anyOf(TEST_FILE, FIXTURE_DIR, CHANGELOG, LESSON_BODIES, MIGRATIONS);

const RETIRED = anyOf(
  /\.rulesync\/lessons/,
  /\brepo generate\b/,
  /\brepo upgrade\b/,
  /rulesync:generate/,
  /rulesync:check/,
  /repo:rulesync/,
  /repo\.features\.jsonc/,
  /repo\.pipeline\.jsonc/,
  /hooks:check/,
);

/** Structure errors a doc pasted over itself leaves behind: a heading repeated, or heading markup glued mid-line. */
function headingErrors(text: string) {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  const lines = text.split("\n");
  const { fenced } = fencedLineSet(lines);
  for (const [i, line] of lines.entries()) {
    if (fenced.has(i)) continue;
    const bare = line.replaceAll(INLINE_CODE, "");
    const heading = HEADING.exec(bare);
    if (heading !== null) {
      const key = `${heading[1]} ${heading[2]}`;
      const first = seen.get(key);
      if (first === undefined) seen.set(key, i + 1);
      else errors.push(`line ${i + 1}: repeated heading "${key}" (first at line ${first}): remove or rename it`);
    }
    if (GLUED_HEADING.test(bare))
      errors.push(`line ${i + 1}: heading markup mid-line: put the heading on its own line`);
  }
  return errors;
}

function isFile(f: string): boolean {
  return fs.statSync(path.join(repoRoot, f), { throwIfNoEntry: false })?.isFile() === true;
}

/** The tracked files, minus those matching `exempt`, that exist on disk. */
function trackedFiles(exempt: RegExp): string[] {
  return execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter((f) => f !== "" && !exempt.test(f) && isFile(f));
}

/** One hit: where it is and the line's first 120 characters. */
function hitLine(file: string, index: number, line: string): string {
  return `${file}:${index + 1}: ${line.trim().slice(0, 120)}`;
}

/** A hit for each line of `files` that `matches`. */
function lineHits(files: string[], matches: (line: string, file: string) => boolean): string[] {
  const hits: string[] = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(repoRoot, f), "utf8").split("\n");
    for (const [i, line] of lines.entries()) if (matches(line, f)) hits.push(hitLine(f, i, line));
  }
  return hits;
}

describe("reference docs", () => {
  it("flags repeated and glued headings, not fenced or inline ones", () => {
    const text = ["## Path", "```md", "## Goal", "```", "see `## x` here", "## Path", "text# Plan format"].join("\n");
    expect(headingErrors(text)).toStrictEqual([
      'line 6: repeated heading "## Path" (first at line 1): remove or rename it',
      "line 7: heading markup mid-line: put the heading on its own line",
    ]);
  });

  for (const name of fs.readdirSync(referenceDir).filter((n) => n.endsWith(".md"))) {
    it(`${name} has each heading once, each on its own line`, () => {
      expect(headingErrors(fs.readFileSync(path.join(referenceDir, name), "utf8"))).toStrictEqual([]);
    });
  }
});

describe("references in the package", () => {
  it("every file in references/ is in the tarball", () => {
    const out = execFileSync("bun", ["pm", "pack", "--dry-run", "--ignore-scripts"], {
      cwd: path.join(here, "..", ".."),
      encoding: "utf8",
    });
    const packed = new Set(
      out
        .split("\n")
        .map((line) => PACKED_LINE.exec(line)?.[1])
        .filter((p): p is string => p !== undefined && p !== ""),
    );
    const names = fs.readdirSync(referenceDir).filter((n) => n.endsWith(".md"));
    expect(names).toContain("INDEX.md");
    expect(names.filter((n) => !packed.has(`references/${n}`))).toStrictEqual([]);
  });
});

describe("repo commands in tracked text", () => {
  // `cli/init.ts` lists the script values older inits wrote, to remove them from a consumer.
  const exempt = anyOf(TEST_FILE, FIXTURE_DIR, CHANGELOG, LESSON_BODIES, INIT_FILE);
  const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter((f) => TEXT_FILE.test(f) && !exempt.test(f));

  it("say bun repo <cmd>: no script path, no bunx repo, no bare `repo <cmd>`", () => {
    const hits = lineHits(tracked, (line, f) => {
      const bare = f.endsWith(".md") ? MD_BARE_REPO : TS_BARE_REPO;
      return BY_PATH.test(line) || BUNX_REPO.test(line) || bare.test(line);
    });
    expect(hits).toStrictEqual([]);
  });
});

describe("paths in references", () => {
  /**
   * Read from the package, a `../../` path into a stock dir lands in `node_modules/@workerstack/`: a repo file is
   * named root-relative.
   */
  it("none names a ../../ path into .rulesync/, agents/ or cli/scripts/ outside fenced code", () => {
    const stockDirs = ["../../.rulesync/", "../../agents/", "../../cli/scripts/"];
    const hits: string[] = [];
    for (const name of fs.readdirSync(referenceDir).filter((n) => n.endsWith(".md"))) {
      const lines = fs.readFileSync(path.join(referenceDir, name), "utf8").split("\n");
      const { fenced } = fencedLineSet(lines);
      for (const [i, line] of lines.entries()) {
        if (fenced.has(i)) continue;
        if (stockDirs.some((dir) => line.includes(dir))) hits.push(hitLine(name, i, line));
      }
    }
    expect(hits).toStrictEqual([]);
  });
});

describe("stock references in tracked text", () => {
  /** The migration modules and the shipped-file table name the old directory to move it. */
  it("none names .rulesync/reference: they live in references/ and are read from the package", () => {
    const hits = lineHits(trackedFiles(OLD_SPELLING_EXEMPT), (line) => line.includes(".rulesync/reference"));
    expect(hits).toStrictEqual([]);
  });
});

describe("retired pipeline names in tracked text", () => {
  /**
   * Each exception names the old spelling to move or remove it: tests and fixtures assert it is gone; the CHANGELOG
   * and lesson bodies are history; `stock-history.*` and the `migrate*` and `migration-*` modules list the old files
   * and lessons dir a copied install holds; `init.constants.ts` lists the script values older inits wrote.
   */
  const allowed = anyOf(OLD_SPELLING_EXEMPT, INIT_CONSTANTS);
  it("none names the old lessons dir, generate, upgrade, the rulesync scripts or the feature files", () => {
    expect(lineHits(trackedFiles(allowed), (line) => RETIRED.test(line))).toStrictEqual([]);
  });
});
