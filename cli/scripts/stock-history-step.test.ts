import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { OXFMT_CONFIG_PATH } from "../sync/standards.ts";
import { hashText, readStockHistory, STOCK_HISTORY_FILE } from "../sync/stock-history.ts";
import { cleanTemps, consumer, git, SLOW, staged, turn, write } from "./__fixtures__/turn-repo.ts";

afterEach(cleanTemps);

const TABLE = "cli/sync/stock-history.json";
const HOOKS = "agents/hooks.jsonc";

/** A committed consumer renamed to this package, so turn treats it as this package's checkout. */
function selfRepo(): string {
  const root = consumer({});
  write(root, { [TABLE]: "{}\n", "package.json": '{ "name": "@workerstack/repo", "type": "module" }\n' });
  git(root, "add", "-A");
  git(root, "commit", "-q", "--no-verify", "-m", "rename");

  return root;
}

it("--staged writes and stages the table with the staged, formatted stock file", { timeout: SLOW }, async () => {
  const root = selfRepo();
  const own = fs.readFileSync(STOCK_HISTORY_FILE, "utf8");
  const raw = '{"b":1,"a":2}\n';
  write(root, { [HOOKS]: raw });
  git(root, "add", HOOKS);
  const result = await turn(root, ["--staged"]);
  expect(result.err).toBe("");
  expect(result.out).toMatch(/ · stock history written · /);
  expect(result.code).toBe(0);
  expect(staged(root)).toStrictEqual([HOOKS, TABLE]);
  const formatted = git(root, "show", `:${HOOKS}`);
  expect(formatted).not.toBe(raw);
  expect(git(root, "show", `:${TABLE}`)).toBe(fs.readFileSync(path.join(root, TABLE), "utf8"));
  expect(readStockHistory(path.join(root, TABLE))[HOOKS]).toStrictEqual([hashText(formatted)]);
  expect(fs.readFileSync(STOCK_HISTORY_FILE, "utf8")).toBe(own);

  const again = await turn(root, ["--staged"]);
  expect(again.out).toMatch(/ · stock history ok · /);
  expect(again.code).toBe(0);
  expect(git(root, "diff", "--name-only")).toBe("");
});

it("without --staged writes the table from the working tree and stages nothing", { timeout: SLOW }, async () => {
  const root = selfRepo();
  const rule = "agents/rules/a.md";
  write(root, { [rule]: "# A\n" });
  const result = await turn(root, []);
  expect(result.out).toMatch(/ · stock history written · /);
  expect(result.code).toBe(0);
  expect(staged(root)).toStrictEqual([]);
  expect(readStockHistory(path.join(root, TABLE))[rule]).toStrictEqual([hashText("# A\n")]);
});

it("fails the turn and stages no table when the formatter cannot run", { timeout: SLOW }, async () => {
  const root = selfRepo();
  fs.rmSync(path.join(root, OXFMT_CONFIG_PATH));
  write(root, { [HOOKS]: "{}\n" });
  git(root, "add", HOOKS);
  const result = await turn(root, ["--staged"]);
  expect(result.out).toMatch(/ · stock history failed · /);
  expect(result.err).toContain(`${OXFMT_CONFIG_PATH} is missing`);
  expect(result.code).toBe(1);
  expect(staged(root)).not.toContain(TABLE);
});

it("skips the step in another package and for a change outside the stock paths", { timeout: SLOW }, async () => {
  const other = consumer({});
  write(other, { [HOOKS]: "{}\n" });
  git(other, "add", HOOKS);
  const consumerRun = await turn(other, ["--staged"]);
  expect(consumerRun.code).toBe(0);
  expect(consumerRun.out).not.toContain("stock history");
  expect(fs.existsSync(path.join(other, TABLE))).toBe(false);

  const root = selfRepo();
  write(root, { "docs/a.md": "# A\n" });
  git(root, "add", "docs/a.md");
  const docs = await turn(root, ["--staged"]);
  expect(docs.code).toBe(0);
  expect(docs.out).not.toContain("stock history");
});
