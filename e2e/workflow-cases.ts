/** The workflow suite's cases: each mode's AGENTS.md paragraph, its gate verdicts and its finish, in one sandbox. */
import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { defaultBranchPushReason, mainCheckoutWriteText } from "../cli/scripts/worktree-guards.constants.ts";
import { WORKFLOW_ANCHOR, WORKFLOW_PARAGRAPHS } from "../cli/sync/agents/workflow-paragraph.constants.ts";
import type { GetSandbox } from "./get-sandbox.types";
import { expectClean, ROOT_VARS } from "./hosts-kit";
import type { Sandbox } from "./sandbox";
import {
  agentsLines,
  gateReason,
  ghCalls,
  ghEnv,
  markMerged,
  originTip,
  places,
  PR_URL,
  setMode,
  tipOf,
} from "./workflow-kit";

const MAIN = "refs/heads/main";
const WRITE = { input: { content: "export const x = 1;\n", file_path: "src/x.ts" }, tool: "Write" };
const PUSH = { input: { command: "git push origin main" }, tool: "Bash" };
const COMMIT = { input: { command: "git commit -m 'feat: x'" }, tool: "Bash" };

/** The stock worktree paragraph: the line of the shipped overview rule that starts with the anchor. */
function worktreeParagraph(): string {
  const overview = fs.readFileSync(path.join(import.meta.dirname, "..", "agents", "rules", "overview.md"), "utf8");
  const line = overview.split(/\r?\n/).find((l) => l.startsWith(WORKFLOW_ANCHOR));

  if (line === undefined) throw new Error("agents/rules/overview.md has no worktree paragraph");

  return line;
}

/** A Write to src/x.ts in the main checkout, its path absolute as Claude sends it. */
function writeCall(sb: Sandbox) {
  return { ...WRITE, input: { ...WRITE.input, file_path: path.join(sb.repo, WRITE.input.file_path) } };
}

/** Adds worktree `name` and commits one docs file in it; the worktree's dir and its branch's tip. */
async function workIn(sb: Sandbox, name: string): Promise<{ dir: string; tip: string }> {
  expectClean(sb, await sb.run("bun", ["repo", "worktree", "add", name], { env: ROOT_VARS }));
  const dir = path.join(sb.repo, ".worktrees", name);
  fs.writeFileSync(path.join(dir, `${name}.md`), `# ${name}\n`);
  await sb.git("-C", dir, "add", "-A");
  await sb.git("-C", dir, "commit", "-q", "-m", `docs: add ${name}`);

  return { dir, tip: await tipOf(sb, `refs/heads/wt/${name}`) };
}

/** Asserts finish removed `dir`; a failure names what is left in it and what finish printed. */
function expectGone(dir: string, out: string): void {
  const left = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).slice(0, 20).join(", ") : "";
  expect(fs.existsSync(dir), `left in ${dir}: [${left}]; finish printed: ${out}`).toBe(false);
}

function finish(sb: Sandbox, name: string) {
  return sb.run("bun", ["repo", "worktree", "finish", name], { env: ghEnv(sb) });
}

/** Squashes origin's `wt/<name>` onto origin's main from a separate clone, as a squash merge on GitHub does. */
async function squashOnOrigin(sb: Sandbox, name: string): Promise<void> {
  const merger = path.join(sb.root, "merger");
  await sb.git("clone", "-q", places(sb).origin, merger);
  await sb.git("-C", merger, "merge", "-q", "--squash", `origin/wt/${name}`);
  await sb.git("-C", merger, "commit", "-q", "-m", `docs: add ${name} (#1)`);
  await sb.git("-C", merger, "push", "-q", "--no-verify", "origin", "main");
}

/** Worktree: the main checkout takes no writes, main may be pushed, and finish lands on local main only. */
export function worktreeCase(get: GetSandbox) {
  it("worktree: denies main-checkout writes, allows pushing main, and finish lands on local main only", async () => {
    const sb = get();
    await setMode(sb, "worktree");
    await sb.git("push", "-q", "--no-verify", "origin", "main");
    const lines = agentsLines(sb);
    expect(lines).toContain(worktreeParagraph());
    expect(lines).not.toContain(WORKFLOW_PARAGRAPHS["pull-request"]);
    expect(await gateReason(sb, writeCall(sb))).toBe(mainCheckoutWriteText(fs.realpathSync(sb.repo), path));
    expect(await gateReason(sb, PUSH)).toBeNull();
    const before = await originTip(sb, MAIN);
    const { dir, tip } = await workIn(sb, "a");
    const landed = await finish(sb, "a");
    expectClean(sb, landed);
    expect(await tipOf(sb, MAIN)).toBe(tip);
    expect(await originTip(sb, MAIN)).toBe(before);
    expectGone(dir, landed.out);
    expect(ghCalls(sb)).toStrictEqual([]);
  });
}

/** Pull-request: main is never pushed; finish pushes the branch and opens one PR, then lands it once merged. */
export function pullRequestCase(get: GetSandbox) {
  it("pull-request: denies pushing main, finish opens one pull request, then lands it once merged", async () => {
    const sb = get();
    await setMode(sb, "pull-request");
    await sb.git("push", "-q", "--no-verify", "origin", "main");
    const lines = agentsLines(sb);
    expect(lines).toContain(WORKFLOW_PARAGRAPHS["pull-request"]);
    expect(lines).not.toContain(worktreeParagraph());
    expect(await gateReason(sb, PUSH)).toBe(defaultBranchPushReason("main", "pull-request"));
    const before = await tipOf(sb, MAIN);
    const { dir, tip } = await workIn(sb, "b");
    const opened = await finish(sb, "b");
    expectClean(sb, opened);
    expect(opened.stdout).toContain(PR_URL);
    expect(await originTip(sb, "refs/heads/wt/b")).toBe(tip);
    expect(ghCalls(sb).filter(([cmd, sub]) => cmd === "pr" && sub === "create")).toHaveLength(1);
    expect(await tipOf(sb, MAIN)).toBe(before);
    expect(await originTip(sb, MAIN)).toBe(before);
    await squashOnOrigin(sb, "b");
    markMerged(sb);
    const merged = await finish(sb, "b");
    expectClean(sb, merged);
    const landed = await originTip(sb, MAIN);
    expect(landed).not.toBe(before);
    expect(await tipOf(sb, MAIN)).toBe(landed);
    expectGone(dir, merged.out);
    expect(await tipOf(sb, "refs/heads/wt/b")).toBe("");
    expect(await originTip(sb, "refs/heads/wt/b")).toBe("");
  });
}

/** Main: the main checkout takes writes and commits, and main may be pushed. */
export function mainCase(get: GetSandbox) {
  it("main: allows writes and commits in the main checkout and pushing main", async () => {
    const sb = get();
    await setMode(sb, "main");
    const lines = agentsLines(sb);
    expect(lines).toContain(WORKFLOW_PARAGRAPHS.main);
    expect(lines).not.toContain(worktreeParagraph());
    expect(await gateReason(sb, writeCall(sb))).toBeNull();
    expect(await gateReason(sb, COMMIT)).toBeNull();
    expect(await gateReason(sb, PUSH)).toBeNull();
  });
}
