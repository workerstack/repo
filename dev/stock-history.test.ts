import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../cli/__fixtures__/temp-dirs.ts";
import { git, write } from "../cli/scripts/__fixtures__/turn-repo.ts";
import { STOCK_HISTORY_REL } from "../cli/scripts/stock-history-collect.constants.ts";
import { collectHistory } from "../cli/scripts/stock-history-collect.ts";
import { OXFMT_CONFIG_PATH } from "../cli/sync/standards.ts";
import { STOCK_HISTORY_FILE, hashText, readStockHistory, type StockHistory } from "../cli/sync/stock-history.ts";
import { run } from "./stock-history.ts";

const REPO = path.resolve(import.meta.dirname, "..");
const { tempDir } = useTempDirs("workerstack-stock-history-run-");

/** Each of `rel`'s `hashes` that `table` lacks, as `rel@hash`. */
function unlisted(table: StockHistory, rel: string, hashes: readonly string[]): string[] {
  const listed = table[rel] ?? [];

  return hashes.filter((hash) => !listed.includes(hash)).map((hash) => `${rel}@${hash}`);
}

function lines() {
  const out: string[] = [];
  const err: string[] = [];

  return { err, io: { err: (line: string) => err.push(line), out: (line: string) => out.push(line) }, out };
}

describe("the shipped table", () => {
  it("is current: every staged stock file, and every committed version of one path, is in it", () => {
    const table = readStockHistory(STOCK_HISTORY_FILE);
    const fresh = collectHistory(REPO, ["HEAD"], "index");
    const missing = Object.entries(fresh).flatMap(([rel, hashes]) => unlisted(table, rel, hashes));

    const hint =
      "stock files changed: commit through the gate, which writes the table, or run `bun dev/stock-history.ts`";

    expect(missing, hint).toStrictEqual([]);
    expect(fresh["agents/hooks.jsonc"]?.length).toBeGreaterThan(0);
  });
});

describe("bun dev/stock-history.ts", () => {
  it("writes the table from main, HEAD and the working tree and prints its path count", () => {
    const root = tempDir();
    git(root, "init", "-q", "-b", "main");
    fs.copyFileSync(path.join(REPO, OXFMT_CONFIG_PATH), path.join(root, OXFMT_CONFIG_PATH));
    write(root, { [STOCK_HISTORY_REL]: "{}\n", "agents/hooks.jsonc": "{}\n" });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "one");
    write(root, { "AGENTS.md": "# A\n" });
    const { io, out, err } = lines();
    expect(run(io, root)).toBe(0);
    expect(err).toStrictEqual([]);
    expect(out).toStrictEqual([`wrote ${STOCK_HISTORY_REL}: 2 paths`]);

    expect(readStockHistory(path.join(root, STOCK_HISTORY_REL))).toStrictEqual({
      "AGENTS.md": [hashText("# A\n")],
      "agents/hooks.jsonc": [hashText("{}\n")],
    });
  });

  it("prints git's failure and exits 1 outside a git repo", () => {
    const root = tempDir();
    write(root, { [STOCK_HISTORY_REL]: "{}\n" });
    const { io, out, err } = lines();
    expect(run(io, root)).toBe(1);
    expect(out).toStrictEqual([]);
    expect(err.join("\n")).toMatch(/git log main failed/);
  });
});
