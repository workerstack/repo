/** The fresh-repo cases on the managed blocks and editor globs, and on the installed bin behind scripts and hooks. */
import path from "node:path";

import { parse } from "jsonc-parser";
import { expect, it } from "vitest";
import { z } from "zod";

import { readJson } from "../cli/json.ts";
import { installedBin } from "../dev/test-paths.ts";
import type { GetSandbox } from "./get-sandbox.types";
import { claudeGate, expectClean } from "./init-helpers";
import { PACKAGE_NAME } from "./registry";
import type { Sandbox } from "./sandbox";
import { BROKEN_RUNTIME } from "./sandbox.constants";
import { tail } from "./tail";

/** The gate's answer to a hook: the rewritten command or the permission decision, each absent when it gave none. */
function buildGateAnswerSchema() {
  const output = z.looseObject({
    permissionDecision: z.string().optional(),
    updatedInput: z.looseObject({ command: z.string().optional() }).optional(),
  });

  return z.looseObject({ hookSpecificOutput: output.optional() });
}

const gateAnswerSchema = /* @__PURE__ */ buildGateAnswerSchema();

/** The lines sync writes in the .gitignore block, in order. */
const IGNORED = [
  ".tmp/",
  ".worktrees/",
  "coverage/",
  "**/.repo/plans/",
  "**/.repo/plans-fast/",
  "**/.repo/roadmaps/",
  "**/.repo/roadmaps-fast/",
  "**/.repo/handoffs/",
  "**/.repo/implementations/",
  "**/.repo/scratch/",
  "**/.repo/tmp/",
  "**/.repo/backlog.md",
  "node_modules/",
  "knip.jsonc",
  "knip.unignored-*.jsonc",
  ".oxfmtrc.jsonc",
  ".oxlintrc.jsonc",
  ".oxlintrc.unskipped-*.jsonc",
  ".agents/",
  ".claude/",
  ".codex/",
  ".cursor/",
  ".grok/",
];

/** The env a claude hook runs with in these cases: the project dir set, Grok's root cleared. */
function claudeEnv(sb: Sandbox) {
  return { CLAUDE_PROJECT_DIR: sb.repo, GROK_WORKSPACE_ROOT: undefined };
}

/** The lines of the `# repo:ignore` or `# repo:generated` block in `text`. */
function block(text: string) {
  return /^# repo:(ignore|generated) [\da-f]{8}\n([\s\S]*?)^# \/repo:\1$/m.exec(text)?.[2]?.split("\n").filter(Boolean);
}

/** The editor's read-only globs sync writes in .vscode/settings.json. */
function readonlyGlobs(sb: Sandbox): Record<string, boolean> {
  const settings = parse(sb.read(".vscode/settings.json")) /* sync writes each read-only glob mapped to true */ as {
    "files.readonlyInclude": Record<string, boolean>;
  };

  return settings["files.readonlyInclude"];
}

/** The managed .gitignore and .gitattributes blocks and the editor's read-only globs. */
export function blocksCase(get: GetSandbox) {
  it("writes the gitignore and gitattributes blocks and the editor read-only globs from the planned outputs", () => {
    const sb = get();
    expect(block(sb.read(".gitignore"))).toStrictEqual(IGNORED);
    const attributes = block(sb.read(".gitattributes")) ?? [];
    expect(attributes[0]).toBe("* text=auto eol=lf");
    expect(attributes).toContain("bunfig.toml linguist-generated");
    expect(attributes).toContain(".vscode/tasks.json linguist-generated");
    // The untracked trees are ignored, not marked generated; the block files are never marked.
    expect(
      attributes.filter((line) =>
        /^(?:AGENTS\.md|\.mcp\.json|\.claude|\.codex|\.agents|\.grok|\.cursor|\.gitignore|\.gitattributes)/.test(line),
      ),
    ).toStrictEqual([]);
    const readonly = readonlyGlobs(sb);
    expect(readonly).toMatchObject({ ".claude/settings.json": true, "bunfig.toml": true });

    for (const yours of [".gitignore", "AGENTS.md", ".mcp.json"]) expect(Object.keys(readonly)).not.toContain(yours);
  });
}

/** A script, the gate's rewrite and the session map all run through the installed repo bin. */
export function installedBinCase(get: GetSandbox) {
  it("runs scripts and hooks through the installed repo bin", async () => {
    const sb = get();
    const job = await sb.run("bash", ["-c", "cd src && bun repo job --job exec --query 'echo hi'"]);
    expectClean(sb, job);
    expect(job.stdout).toContain("hi");

    const env = claudeEnv(sb);

    const payload = {
      cwd: sb.repo,
      hook_event_name: "PreToolUse",
      session_id: "e2e",
      tool_input: { command: "cat src/index.ts" },
      tool_name: "Bash",
    };

    const rewrite = await sb.run("bash", ["-c", claudeGate(sb).command], { env, input: JSON.stringify(payload) });
    expectClean(sb, rewrite);

    const out = readJson(gateAnswerSchema, rewrite.stdout);
    expect(out.hookSpecificOutput?.updatedInput?.command).toMatch(
      new RegExp(`^${installedBin(sb.repo).replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")} job --job exec --query `),
    );

    const map = await sb.run("bash", ["-c", '"$CLAUDE_PROJECT_DIR/node_modules/.bin/repo" hook session-map'], {
      env,
      input: JSON.stringify({ cwd: sb.repo, hook_event_name: "SessionStart", session_id: "e2e", source: "startup" }),
    });

    expectClean(sb, map);
    expect(map.stdout).toContain("run `bun repo map <dir>`");
    expect(map.stdout).toContain("src/");
  });
}

/** The claude gate's decision on a Read of `rel`, timed; logs the latency and expects it under 5s. */
async function gateRead(sb: Sandbox, command: string, rel: string) {
  const env = claudeEnv(sb);

  const payload = {
    cwd: sb.repo,
    hook_event_name: "PreToolUse",
    session_id: "e2e",
    tool_input: { file_path: path.join(sb.repo, rel) },
    tool_name: "Read",
  };

  const started = Date.now();
  const r = await sb.run("bash", ["-c", command], { env, input: JSON.stringify(payload) });
  const ms = Date.now() - started;
  process.stdout.write(`gate latency ${ms}ms for Read ${rel}\n`);
  expect(ms, `${rel} took ${ms}ms`).toBeLessThan(5000);
  expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);

  const answer = readJson(gateAnswerSchema, r.stdout === "" ? "{}" : r.stdout);

  return { decision: answer.hookSpecificOutput?.permissionDecision, out: r.out, status: r.status };
}

/** The stock references resolve, and the gate allows one and denies a dependency file, each fast. */
export function gateLatencyCase(get: GetSandbox) {
  it("the generated gate allows a stock reference and denies a dependency, each within 5s", async () => {
    const sb = get();
    const stock = path.join("node_modules", PACKAGE_NAME, "references");
    expect(sb.exists(path.join(stock, "plan-format.md"))).toBe(true);

    const index = sb.read("references/INDEX.md");
    const section = /<!-- repo:stack [\da-f]{8} -->\n([\s\S]*?)<!-- \/repo:stack -->/.exec(index)?.[1] ?? "";
    const targets = [...section.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1] ?? "");
    expect(targets, section).toContain(`../node_modules/${PACKAGE_NAME}/references/INDEX.md`);

    for (const target of targets) expect(sb.exists(path.join("references", target)), target).toBe(true);

    const gate = claudeGate(sb);
    const allowed = await gateRead(sb, gate.command, path.join(stock, "plan-format.md"));
    expect(allowed.decision, allowed.out).not.toBe("deny");
    expect(allowed.status, allowed.out).toBe(0);
    const denied = await gateRead(sb, gate.command, path.join("node_modules", "rulesync", "package.json"));
    expect(denied.decision, denied.out).toBe("deny");
  });
}
