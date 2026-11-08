import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { STOCK_HISTORY_FILE, hashText, readStockHistory } from "../cli/sync/stock-history.ts";
import { collectHistory, renderHistory } from "./stock-history.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const run = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr);
}

function put(root: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

describe("collectHistory", () => {
  it("hashes every committed version of a stock path plus the working tree, sorted, and nothing else", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-stock-history-"));
    temps.push(root);
    git(root, "init", "-q", "-b", "main");
    put(root, ".rulesync/hooks.jsonc", "v1\n");
    put(root, "src/other.ts", "not stock\n");
    put(root, "AGENTS.md", "agents\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "one");
    put(root, ".rulesync/hooks.jsonc", "v2\r\n");
    put(root, ".agents/skills/ask/SKILL.md", "ask\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "two");
    put(root, ".rulesync/hooks.jsonc", "v3 uncommitted\n");

    const history = collectHistory(root);
    expect(history).toEqual({
      ".agents/skills/ask/SKILL.md": [hashText("ask\n")],
      ".rulesync/hooks.jsonc": [hashText("v1\n"), hashText("v2\n"), hashText("v3 uncommitted\n")].sort(),
      "AGENTS.md": [hashText("agents\n")],
    });
    expect(Object.keys(history)).toEqual([".agents/skills/ask/SKILL.md", ".rulesync/hooks.jsonc", "AGENTS.md"]);
    expect(collectHistory(root)).toEqual(history);
    expect(renderHistory(history)).toBe(
      `{\n  ".agents/skills/ask/SKILL.md": ["${hashText("ask\n")}"],\n  ".rulesync/hooks.jsonc": ${JSON.stringify(history[".rulesync/hooks.jsonc"])},\n  "AGENTS.md": ["${hashText("agents\n")}"]\n}\n`,
    );
  });

  it("reports a ref that git does not have", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-stock-history-"));
    temps.push(root);
    git(root, "init", "-q");
    expect(() => collectHistory(root, ["nope"])).toThrow(/git log nope failed: .*bad revision/s);
  });
});

describe("the shipped table", () => {
  it("is current: every stock file in the working tree, and every committed version of one path, is in it", () => {
    const table = readStockHistory(STOCK_HISTORY_FILE);
    const fresh = collectHistory(REPO, ["HEAD"]);
    const missing = Object.entries(fresh).flatMap(([rel, hashes]) =>
      hashes.filter((hash) => !(table[rel] ?? []).includes(hash)).map((hash) => `${rel}@${hash}`),
    );
    expect(missing, "stock files changed: run `bun dev/stock-history.ts`").toEqual([]);
    expect(fresh[".rulesync/hooks.jsonc"]!.length).toBeGreaterThan(0);
  });
});
