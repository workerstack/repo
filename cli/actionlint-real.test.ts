import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { checkActionlintAt } from "./actionlint.ts";

const SLOW = 180_000;
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A release-pack repo whose one workflow has `jobs` as its job section. */
function planted(jobs: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-actionlint-real-"));
  dirs.push(root);
  fs.writeFileSync(path.join(root, "workerstack.config.ts"), 'export default { packs: ["release"] };\n');
  fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
  const body = `name: x\non: push\njobs:\n  build:\n${jobs}\n    steps:\n      - run: echo hi\n`;
  fs.writeFileSync(path.join(root, ".github", "workflows", "ci.yml"), body);
  return root;
}

it("lints a planted workflow with the real binary from the real cache: runs_on fails", { timeout: SLOW }, async () => {
  const out = await checkActionlintAt(planted("    runs_on: ubuntu-latest"));
  const line = 'actionlint: .github/workflows/ci.yml:5:5: unexpected key "runs_on" for "job" section';
  expect(out.problems.some((problem) => problem.startsWith(line) && problem.endsWith("[syntax-check]"))).toBe(true);
});

it("gives no line for a clean workflow", { timeout: SLOW }, async () => {
  const out = await checkActionlintAt(planted("    runs-on: ubuntu-latest"));
  expect(out).toStrictEqual({ problems: [] });
});
