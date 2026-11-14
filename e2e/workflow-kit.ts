/** The workflow suite's helpers: a bare origin, a compiled stub gh, the mode switch, and the Claude gate's verdict. */
import fs from "node:fs";
import path from "node:path";

import { expect } from "vitest";
import { z } from "zod";

import { isString, readJson } from "../cli/json.ts";
import type { Workflow } from "../cli/workflow.ts";
import { claudePayload, commands, expectClean, GATE, only, output, ROOT_VARS, runHook } from "./hosts-kit";
import type { Sandbox } from "./sandbox";
import { BROKEN_RUNTIME } from "./sandbox.constants";
import { tail } from "./tail";

/** The URL the stub gh answers `pr create` with. */
export const PR_URL = "https://github.com/e2e/consumer/pull/1";

/** The stub gh's state file rows: what `gh pr list --json state,url,number,headRefOid` prints. */
function rowsSchema() {
  return z.array(z.object({ headRefOid: z.string(), number: z.number(), state: z.string(), url: z.string() }));
}

/** Where the sandbox keeps its bare origin, the stub gh's dir, its state file and its argv log. */
export function places(sb: Sandbox) {
  return {
    bin: path.join(sb.root, "bin"),
    log: path.join(sb.root, "gh-log.jsonl"),
    origin: path.join(sb.root, "origin.git"),
    state: path.join(sb.root, "gh-state.json"),
  };
}

/** The stub gh's source: logs its argv, answers auth status, pr list from the state file, and pr create. */
function stubSource(sb: Sandbox): string {
  const { log, origin, state } = places(sb);

  return `import { spawnSync } from "node:child_process";
import fs from "node:fs";
const [log, origin, state, url] = ${JSON.stringify([log, origin, state, PR_URL])};
const args = process.argv.slice(2);
fs.appendFileSync(log, JSON.stringify(args) + "\\n");
const after = (flag) => args[args.indexOf(flag) + 1];
if (args[0] === "auth" && args[1] === "status") process.exit(0);
if (args[0] === "pr" && args[1] === "list") {
  process.stdout.write(fs.existsSync(state) ? fs.readFileSync(state, "utf8") : "[]");
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "create") {
  const ref = "refs/heads/" + after("--head");
  const tip = spawnSync("git", ["--git-dir", origin, "rev-parse", ref], { encoding: "utf8" }).stdout.trim();
  fs.writeFileSync(state, JSON.stringify([{ headRefOid: tip, number: 1, state: "OPEN", url }]));
  process.stdout.write("Creating pull request\\n" + url + "\\n");
  process.exit(0);
}
process.exit(1);
`;
}

/** A bare origin holding main, and the stub gh compiled to a real executable, since gh is spawned with no shell. */
export async function makeOrigin(sb: Sandbox): Promise<void> {
  const { bin, origin } = places(sb);
  await sb.git("init", "-q", "--bare", "-b", "main", origin);
  await sb.git("remote", "add", "origin", origin);
  await sb.git("push", "-q", "--no-verify", "origin", "main");
  const source = path.join(sb.root, "gh-stub.ts");
  fs.writeFileSync(source, stubSource(sb));
  const exe = path.join(bin, process.platform === "win32" ? "gh.exe" : "gh");
  sb.expectOk(await sb.run(process.execPath, ["build", "--compile", source, "--outfile", exe]));
}

/** The env of a finish run: the stub gh's dir first on PATH, under the key the platform uses. */
export function ghEnv(sb: Sandbox): NodeJS.ProcessEnv {
  const key = Object.keys(sb.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";

  return { ...ROOT_VARS, [key]: `${places(sb).bin}${path.delimiter}${sb.env[key] ?? ""}` };
}

/** Every argv the stub gh was called with, in order. */
export function ghCalls(sb: Sandbox): string[][] {
  const { log } = places(sb);
  const text = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";

  return text
    .split(/\r?\n/)
    .filter((line) => line !== "")
    .map((line) => readJson(z.array(z.string()), line));
}

/** Marks the stub's one pull request merged, its head unchanged. */
export function markMerged(sb: Sandbox): void {
  const { state } = places(sb);
  const rows = readJson(rowsSchema(), fs.readFileSync(state, "utf8")).map((row) => ({ ...row, state: "MERGED" }));
  fs.writeFileSync(state, JSON.stringify(rows));
}

/** Writes `workflow` into repo.config.ts, syncs, and commits both. */
export async function setMode(sb: Sandbox, workflow: Workflow): Promise<void> {
  const bare = sb.read("repo.config.ts").replace(/\n {2}workflow: "[^"]*",/, "");
  sb.write("repo.config.ts", bare.replace("defineConfig({", `defineConfig({\n  workflow: "${workflow}",`));
  expectClean(sb, await sb.run("bun", ["repo", "sync"], { env: ROOT_VARS }));
  await sb.commit(`chore: workflow ${workflow}`);
}

/** The root AGENTS.md lines, split on either line end. */
export function agentsLines(sb: Sandbox): string[] {
  return sb.read("AGENTS.md").split(/\r?\n/);
}

/** One tool call the Claude gate judges: its tool and that tool's input. */
type Call = { tool: string; input: Record<string, string> };

/** The Claude PreToolUse gate's verdict on `call` from the main checkout: its deny reason, or null when it passes. */
export async function gateReason(sb: Sandbox, call: Call): Promise<string | null> {
  const command = only(commands(sb, ".claude/settings.json", { ends: GATE, event: "PreToolUse" }), "claude gate");
  const payload = claudePayload(sb, { hook_event_name: "PreToolUse", tool_input: call.input, tool_name: call.tool });
  const r = await runHook(sb, command, { env: { CLAUDE_PROJECT_DIR: sb.repo }, payload });
  expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);
  expect(r.status, tail(r.out)).toBe(0);

  if (r.stdout.trim() === "") return null;
  const { permissionDecision, permissionDecisionReason } = output(r);

  return permissionDecision === "deny" && isString(permissionDecisionReason) ? permissionDecisionReason : null;
}

/** The sha `ref` names in the main checkout, or "" when it is missing. */
export async function tipOf(sb: Sandbox, ref: string): Promise<string> {
  const r = await sb.run("git", ["rev-parse", "--verify", "-q", ref]);

  return r.stdout.trim();
}

/** The sha `ref` names in the bare origin, or "" when it is missing. */
export async function originTip(sb: Sandbox, ref: string): Promise<string> {
  const r = await sb.run("git", ["--git-dir", places(sb).origin, "rev-parse", "--verify", "-q", ref]);

  return r.stdout.trim();
}
