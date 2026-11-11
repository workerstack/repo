import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../cli/fixtures/temp-dirs.ts";
import { byCodeUnit } from "../cli/sync/by-code-unit.ts";
import { STOCK_HISTORY_FILE, hashText, readStockHistory, type StockHistory } from "../cli/sync/stock-history.ts";
import { collectHistory } from "./stock-history.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { tempDir } = useTempDirs("workerstack-stock-history-");

function git(cwd: string, ...args: string[]): void {
  const run = spawnSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(run.stderr);
}

function put(root: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

/** An empty git repo in a temp dir, on branch `main`. */
function initRepo(): string {
  const root = tempDir();
  git(root, "init", "-q", "-b", "main");
  return root;
}

/** An empty git repo in a temp dir, on git's default branch. */
function initDefaultBranchRepo(): string {
  const root = tempDir();
  git(root, "init", "-q");
  return root;
}

/** Each of `rel`'s `hashes` that `table` lacks, as `rel@hash`. */
function unlisted(table: StockHistory, rel: string, hashes: readonly string[]): string[] {
  const listed = table[rel] ?? [];
  return hashes.filter((hash) => !listed.includes(hash)).map((hash) => `${rel}@${hash}`);
}

/** Two commits and an uncommitted edit of a stock file, with a non-stock file and `AGENTS.md` beside it. */
function threeVersions(root: string): void {
  put(root, "agents/hooks.jsonc", "v1\n");
  put(root, "src/other.ts", "not stock\n");
  put(root, "AGENTS.md", "agents\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "one");
  put(root, "agents/hooks.jsonc", "v2\r\n");
  put(root, ".agents/skills/ask/SKILL.md", "ask\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "two");
  put(root, "agents/hooks.jsonc", "v3 uncommitted\n");
}

describe("collectHistory", () => {
  it("hashes every committed version of a stock path plus the working tree, sorted, and nothing else", () => {
    const root = initRepo();
    threeVersions(root);

    const history = collectHistory(root);
    expect(history).toStrictEqual({
      ".agents/skills/ask/SKILL.md": [hashText("ask\n")],
      "AGENTS.md": [hashText("agents\n")],
      "agents/hooks.jsonc": [hashText("v1\n"), hashText("v2\n"), hashText("v3 uncommitted\n")].toSorted(byCodeUnit),
    });
    expect(Object.keys(history)).toStrictEqual([".agents/skills/ask/SKILL.md", "AGENTS.md", "agents/hooks.jsonc"]);
    expect(collectHistory(root)).toStrictEqual(history);
  });

  it("skips a committed symlink under a stock path: its blob is a link target, not a stock version", () => {
    const root = initRepo();
    put(root, "agents/skills/ask/SKILL.md", "ask\n");
    fs.mkdirSync(path.join(root, ".agents/skills"), { recursive: true });
    fs.symlinkSync("../../agents/skills/ask", path.join(root, ".agents/skills/ask"));
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "link");
    // the working tree still reads through the link, as a copy at the old path would hold the same text
    expect(collectHistory(root, ["HEAD"])).toStrictEqual({
      ".agents/skills/ask/SKILL.md": [hashText("ask\n")],
      "agents/skills/ask/SKILL.md": [hashText("ask\n")],
    });
  });

  it("reports a ref that git does not have", () => {
    const root = initDefaultBranchRepo();
    expect(() => collectHistory(root, ["nope"])).toThrow(/git log nope failed: .*bad revision/s);
  });
});

describe("collectHistory, from the index", () => {
  it("hashes the staged stock file, not an unstaged edit of it, and skips a staged symlink", () => {
    const root = initRepo();
    put(root, "agents/hooks.jsonc", "committed\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "one");
    put(root, "agents/hooks.jsonc", "instrumented\n");
    expect(collectHistory(root, ["HEAD"], "index")["agents/hooks.jsonc"]).toStrictEqual([hashText("committed\n")]);
    expect(collectHistory(root, ["HEAD"])["agents/hooks.jsonc"]).toContain(hashText("instrumented\n"));
    fs.mkdirSync(path.join(root, ".agents/skills"), { recursive: true });
    fs.symlinkSync("../../agents", path.join(root, ".agents/skills/link"));
    git(root, "add", "-A");
    put(root, "agents/hooks.jsonc", "instrumented again\n");
    const staged = collectHistory(root, ["HEAD"], "index");
    expect(staged["agents/hooks.jsonc"]).toStrictEqual(
      [hashText("committed\n"), hashText("instrumented\n")].toSorted(byCodeUnit),
    );
    expect(Object.keys(staged)).toStrictEqual(["agents/hooks.jsonc"]);
  });
});

describe("the shipped table", () => {
  it("is current: every staged stock file, and every committed version of one path, is in it", () => {
    const table = readStockHistory(STOCK_HISTORY_FILE);
    const fresh = collectHistory(REPO, ["HEAD"], "index");
    const missing = Object.entries(fresh).flatMap(([rel, hashes]) => unlisted(table, rel, hashes));
    expect(missing, "stock files changed: run `bun dev/stock-history.ts`").toStrictEqual([]);
    expect(fresh["agents/hooks.jsonc"]?.length).toBeGreaterThan(0);
  });
});
