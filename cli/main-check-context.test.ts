import fs from "node:fs";

import { expect, it } from "vitest";

import { commitMain, writeConfigs } from "./__fixtures__/check-repo.ts";
import { useMainCheckRepo } from "./__fixtures__/main-check-repo.ts";
import { start } from "./main.ts";

const { fakes, repo, written } = useMainCheckRepo();

/** A repo whose main holds a 10-byte rules budget and whose feature branch grows the rules to 20 bytes. */
function growRules(budgeted: number): void {
  writeConfigs(repo);
  repo.put("agents/rules/overview.md", "r".repeat(10));
  repo.write("context-budget.json", { index: 0, rules: 10, skills: 0 });
  commitMain(repo);
  repo.put("agents/rules/overview.md", "r".repeat(20));
  repo.write("context-budget.json", { index: 0, rules: budgeted, skills: 0 });
}

it("fails shipped context that grew over main with no ledger line", { timeout: 60_000 }, async () => {
  growRules(20);
  await start(fakes);
  expect(repo.besidesKnip()).toBe(
    'repo check: context: rules 10 -> 20 bytes (+10) over main; record it: bun repo check --write --reason "<why>"\n',
  );
  expect(process.exitCode).toBe(1);
});

it("passes a rise recorded by check --write --reason, which runs no other check", { timeout: 60_000 }, async () => {
  growRules(10);
  process.argv = ["node", "repo", "check", "--write", "--reason", "add the eval rule"];
  await start(fakes);
  expect(written.out.join("")).toBe("context-budget.json written; .repo/context-growth.jsonl +1 line(s)\n");
  expect(fs.readFileSync(`${repo.dir()}/.repo/context-growth.jsonl`, "utf8")).toBe(
    '{"bucket":"rules","from":10,"to":20,"reason":"add the eval rule"}\n',
  );
  expect(process.exitCode).toBe(0);
  process.argv = ["node", "repo", "check"];
  await start(fakes);
  expect(repo.besidesKnip()).toBe("");
});

it("refuses check --write over a rise with no --reason", { timeout: 60_000 }, async () => {
  growRules(10);
  process.argv = ["node", "repo", "check", "--write"];
  await start(fakes);
  expect(written.err.join("")).toBe("--reason is required for a rise over main (rules 10 -> 20)\n");
  expect(process.exitCode).toBe(1);
  expect(fs.existsSync(`${repo.dir()}/.repo/context-growth.jsonl`)).toBe(false);
});
