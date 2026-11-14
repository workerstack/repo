/** The helpers the init e2e files share: gate runs, generated-file hashes and the agent hosts' hook calls. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { expect } from "vitest";
import { z } from "zod";

import { packageJsonSchema } from "../cli/package-json.ts";
import { byCodeUnit } from "../cli/sync/by-code-unit.ts";
import { linkText } from "../dev/test-paths.ts";
import type { Run } from "./run.types";
import type { Sandbox } from "./sandbox";
import { BROKEN_RUNTIME } from "./sandbox.constants";
import { tail } from "./tail";

export function expectClean(sb: Sandbox, r: Run) {
  expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);
  sb.expectOk(r);
}

/** `repo turn` and `repo check` both fail the planted file's non-null assertion against an empty baseline. */
export async function expectPlantedFails(sb: Sandbox, env: Record<string, string>) {
  const turn = await sb.run("bun", ["repo", "turn"], { env });
  expect(turn.status, tail(turn.out)).toBe(1);
  expect(turn.stderr).toContain(
    "repo turn: src/planted.ts has 1 typescript(no-non-null-assertion), the baseline allows 0; fix the new one",
  );
  expect(turn.stdout).toMatch(/^turn: 1 file · fmt ok · comments ok · lint 2 over baseline · /);
  const check = await sb.run("bun", ["repo", "check"], { env });
  expect(check.status, tail(check.out)).toBe(1);
  expect(check.stderr).toContain(
    "repo check: .repo/lint-baseline.json: src/planted.ts has 1 typescript(no-non-null-assertion), " +
      "the baseline allows 0",
  );
}

const SKIP_REASON = "the lookup result is always present";

function skipOf(file: string, rule = "typescript/no-non-null-assertion") {
  return { files: [file], reason: SKIP_REASON, rules: [rule] };
}

/**
 * With `src/skipped.ts` planted: check reports the live skip and fails the one whose file is gone, leaving no
 * skip-free config behind, and sync refuses a skip of a rule the config never runs.
 */
export async function expectSkipsChecked(sb: Sandbox, original: string) {
  function withSkips(...skips: object[]) {
    return original.replace("packs:", `lint: { skip: ${JSON.stringify(skips)} },\n  packs:`);
  }

  sb.write("repo.config.ts", withSkips(skipOf("src/skipped.ts"), skipOf("src/gone.ts")));
  expectClean(sb, await sb.run("bun", ["repo", "sync"]));
  const check = await sb.run("bun", ["repo", "check"]);
  expect(check.status, tail(check.out)).toBe(1);
  expect(check.stdout).toContain(
    `repo check: skip typescript/no-non-null-assertion in src/skipped.ts: 1 hit (${SKIP_REASON})\n` +
      "repo check: skips: typescript/no-non-null-assertion 1\n",
  );
  expect(check.stderr).toContain(
    'repo check: lint.skip[1]: "src/gone.ts" matches no file; fix the path or delete the entry',
  );
  expect(fs.readdirSync(sb.repo).filter((name) => name.startsWith(".oxlintrc.unskipped-"))).toStrictEqual([]);
  sb.write("repo.config.ts", withSkips(skipOf("src/skipped.ts", "repo/no-modul-state")));
  const sync = await sb.run("bun", ["repo", "sync"]);
  expect(sync.status, tail(sync.out)).toBe(1);
  expect(sync.stderr).toContain(
    'repo sync: repo.config.ts: lint.skip[0].rules: "repo/no-modul-state" is not a rule the generated config runs',
  );
}

/** On a clean tree `repo turn` has nothing to gate and `repo check` passes. */
export async function expectGatesPass(sb: Sandbox, env: Record<string, string>) {
  const turn = await sb.run("bun", ["repo", "turn"], { env });
  expect({ status: turn.status, stdout: turn.stdout }, tail(turn.out)).toStrictEqual({
    status: 0,
    stdout: "turn: no changes\n",
  });
  expectClean(sb, await sb.run("bun", ["repo", "check"], { env }));
}

export async function installedVersion(sb: Sandbox) {
  return sb.expectOk(await sb.cli("version")).stdout.trim();
}

/** A package.json as init leaves it: scripts and devDependencies are always there. */
/** The package.json init writes: its scripts and devDependencies, each a map of strings. */
export const packageJsonWritten = /* @__PURE__ */ packageJsonSchema
  .pick({ devDependencies: true, scripts: true })
  .required();

function buildClaudeSettingsSchema() {
  return z.looseObject({ permissions: z.looseObject({ allow: z.array(z.string()) }) });
}

/** A claude settings file with its allowed permissions. */
export const claudeSettingsSchema = /* @__PURE__ */ buildClaudeSettingsSchema();

function buildHookConfigSchema() {
  const handler = z.looseObject({ command: z.string().optional(), type: z.string().optional() });
  const group = z.looseObject({ hooks: z.array(handler).optional(), matcher: z.string().optional() });

  return z.looseObject({ hooks: z.record(z.string(), z.array(group)).optional() });
}

/** An agent host's hook config: matcher groups of handlers keyed by event, when it has any. */
export const hookConfigSchema = /* @__PURE__ */ buildHookConfigSchema();

/** Every path `repo sync` generates for the default config; none is tracked in the consumer. */
export const GENERATED = [
  ".claude",
  ".codex",
  ".agents",
  ".grok",
  ".cursor",
  ".oxlintrc.jsonc",
  ".oxfmtrc.jsonc",
  "knip.jsonc",
];

export const NON_NULL =
  'export function first(names: string[]): string {\n  return names.find((name) => name !== "")!;\n}\n';

export const FLOATING = "export function start(load: () => Promise<void>): void {\n  load();\n}\n";

/** Dependencies, git internals and the hooks' scratch and state dirs are not sync output. */
const SKIPPED = /^(?:node_modules|\.git|\.tmp|\.worktrees|\.repo\/tmp)(?:\/|$)/;

function sha(data: Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

/** One line per file (sha256 of its bytes) and per link (its target) that `keep` accepts, links never followed. */
export function hashes(root: string, keep: (rel: string) => boolean, dir = ""): string[] {
  const lines: string[] = [];

  for (const name of fs.readdirSync(path.join(root, dir)).toSorted(byCodeUnit)) {
    const rel = dir === "" ? name : `${dir}/${name}`;

    if (SKIPPED.test(rel)) continue;
    const abs = path.join(root, rel);
    const stat = fs.lstatSync(abs);

    if (stat.isSymbolicLink()) {
      if (keep(rel)) lines.push(`${rel} -> ${linkText(abs)}`);
    } else if (stat.isDirectory()) {
      lines.push(...hashes(root, keep, rel));
    } else if (keep(rel)) {
      lines.push(`${rel} ${sha(fs.readFileSync(abs))}`);
    }
  }

  return lines;
}

/**
 * The ignored, untracked files and links git sees: what `repo sync` generated. Git for Windows walks into a
 * junction and lists the files behind it, so each of those is folded back into the link that holds it.
 */
export async function ignoredFiles(sb: Sandbox) {
  const ls = await sb.git("ls-files", "--others", "--ignored", "--exclude-standard", "-z");
  const listed = ls.stdout.split("\0").filter((f) => f !== "" && !SKIPPED.test(f));

  return [...new Set(listed.map((rel) => holdingLink(sb.repo, rel) ?? rel))];
}

/** The nearest parent of `rel` that is a link, or null when every parent is a real directory. */
function holdingLink(root: string, rel: string): string | null {
  const parts = rel.split("/");

  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(0, i).join("/");

    if (fs.lstatSync(path.join(root, parent)).isSymbolicLink()) return parent;
  }

  return null;
}

/** Removes a generated file, or a generated link without touching what it points to. */
export function removeGenerated(abs: string) {
  if (fs.lstatSync(abs, { throwIfNoEntry: false })?.isSymbolicLink() === true) fs.unlinkSync(abs);
  else fs.rmSync(abs, { force: true });
}

export async function generatedHashes(sb: Sandbox) {
  const ignored = new Set(await ignoredFiles(sb));

  return hashes(sb.repo, (rel) => ignored.has(rel));
}

/** Overwrite the config's `agents.hosts` list. */
export function setHosts(sb: Sandbox, hosts: string[]) {
  const text = sb.read("repo.config.ts");
  expect(text).toMatch(/hosts: \[[^\]]*\]/);
  sb.write("repo.config.ts", text.replace(/hosts: \[[^\]]*\]/, `hosts: ${JSON.stringify(hosts)}`));
}

type HookCall = { file: string; event: string; matcher?: string; command: string };

type HookGroup = NonNullable<z.output<typeof hookConfigSchema>["hooks"]>[string][number];

/** The command hooks of one event's matcher groups in `file`. */
function groupCalls(file: string, event: string, groups: HookGroup[]): HookCall[] {
  return groups.flatMap((g) =>
    (g.hooks ?? []).flatMap((h) =>
      h.type === "command" && h.command !== undefined ? [{ command: h.command, event, file, matcher: g.matcher }] : [],
    ),
  );
}

/** The command hooks one host config file holds. */
function fileCalls(sb: Sandbox, file: string): HookCall[] {
  const hooks = sb.json(file, hookConfigSchema).hooks ?? {};

  return Object.entries(hooks).flatMap(([event, groups]) => groupCalls(file, event, groups));
}

/** Every command hook the consumer's agent hosts would run. */
export function hookCalls(sb: Sandbox): HookCall[] {
  const files = [".claude/settings.json", ".codex/hooks.json", ".agents/hooks.json"];
  const grokDir = path.join(sb.repo, ".grok", "hooks");

  for (const f of fs.readdirSync(grokDir)) if (f.endsWith(".json")) files.push(`.grok/hooks/${f}`);

  return files.flatMap((file) => fileCalls(sb, file));
}

export function claudeGate(sb: Sandbox) {
  const gate = hookCalls(sb).find(
    (c) => c.file === ".claude/settings.json" && c.event === "PreToolUse" && c.command.endsWith(" hook gate-fat-tools"),
  );

  expect(gate, "claude gate hook").toBeDefined();

  if (gate === undefined) throw new Error("no claude gate hook");

  return gate;
}

const TOOL_CALLS = [
  { tool_input: { file_path: "src/index.ts" }, tool_name: "Read" },
  { tool_input: { command: "git status", description: "status" }, tool_name: "Bash" },
  { tool_input: { description: "look", prompt: "List the src folder.", subagent_type: "scout" }, tool_name: "Agent" },
];

export function hookPayloads(sb: Sandbox, call: HookCall) {
  const base = {
    cwd: sb.repo,
    hook_event_name: call.event,
    session_id: "e2e-session",
    transcript_path: path.join(sb.root, "transcript.jsonl"),
  };

  if (call.event === "PreToolUse" || call.event === "PostToolUse") {
    const re = new RegExp(`^(?:${call.matcher === undefined || call.matcher === "" ? ".*" : call.matcher})$`);

    return TOOL_CALLS.filter((t) => re.test(t.tool_name)).map((t) => ({
      ...base,
      ...t,
      tool_input: t.tool_name === "Read" ? { file_path: path.join(sb.repo, "src/index.ts") } : t.tool_input,
      ...(call.event === "PostToolUse" ? { tool_response: { success: true } } : {}),
    }));
  }

  if (call.event === "UserPromptSubmit") return [{ ...base, prompt: "Summarize src/index.ts." }];

  if (call.event === "SessionStart") return [{ ...base, source: "startup" }];

  // Create then Remove, in settings order, so the sandbox ends with no worktree.
  if (call.event === "WorktreeCreate") return [{ ...base, name: "e2e" }];

  if (call.event === "WorktreeRemove") return [{ ...base, worktree_path: path.join(sb.repo, ".worktrees", "e2e") }];

  return [{ ...base, stop_hook_active: false }];
}
