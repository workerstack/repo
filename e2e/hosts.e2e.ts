/**
 * What init.e2e.ts leaves out: each host's hooks driven the way that host calls them, hosts that only get files
 * generated, and a linked worktree with no install of its own (T3 Code makes these under `~/.t3/worktrees/`).
 * Every spawned process clears CLAUDE_PROJECT_DIR and GROK_WORKSPACE_ROOT unless the case sets one.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { readManifest } from "../cli/sync/manifest.ts";
import type { Output } from "../cli/sync/outputs.ts";
import { validateOutputs } from "../cli/sync/validate.ts";
import { isRecord } from "./json";
import { PACKAGE_NAME } from "./registry";
import { BROKEN_RUNTIME, type Run, Sandbox, tail } from "./sandbox";

const ROOT_VARS = { CLAUDE_PROJECT_DIR: undefined, GROK_WORKSPACE_ROOT: undefined };
const GATE = " hook gate-fat-tools";
const MAP = " hook session-map";

function expectClean(sb: Sandbox, r: Run) {
  expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);
  sb.expectOk(r);
}

type Handler = { type?: string; command?: string };
type Group = { matcher?: string; hooks?: Handler[] };

/** The command hooks of `event` in a host's hook file, in file order; `ends` keeps those running one repo hook. */
function commands(sb: Sandbox, file: string, event: string, ends: string): string[] {
  const doc: unknown = JSON.parse(sb.read(file));
  const hooks = isRecord(doc) && isRecord(doc.hooks) ? doc.hooks[event] : undefined;
  const groups = Array.isArray(hooks) ? (hooks as Group[]) : [];
  return groups
    .flatMap((g) => g.hooks ?? [])
    .flatMap((h) => (h.type === "command" && h.command?.endsWith(ends) ? [h.command] : []));
}

function only(list: string[], what: string): string {
  expect(list, what).toHaveLength(1);
  return list[0]!;
}

/** Runs a hook command the way a host does, from `cwd`, with the payload on stdin. */
function runHook(
  sb: Sandbox,
  command: string,
  payload: unknown,
  { cwd, env }: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  const run = cwd ? `cd ${JSON.stringify(cwd)} && ${command}` : command;
  return sb.run("bash", ["-c", run], { input: JSON.stringify(payload), env: { ...ROOT_VARS, ...env } });
}

function json(r: Run): Record<string, unknown> {
  const doc: unknown = JSON.parse(r.stdout);
  if (!isRecord(doc)) throw new Error(`not a JSON object: ${tail(r.out)}`);
  return doc;
}

function output(r: Run): Record<string, unknown> {
  const doc = json(r).hookSpecificOutput;
  if (!isRecord(doc)) throw new Error(`no hookSpecificOutput: ${tail(r.out)}`);
  return doc;
}

describe("hosts", () => {
  let sb: Sandbox;

  beforeAll(async () => {
    sb = new Sandbox("hosts");
    await sb.scaffold();
    expectClean(sb, await sb.launch(PACKAGE_NAME, "init"));
  });

  describe("codex calls .codex/hooks.json with its cwd and nothing else", () => {
    const base = () => ({
      session_id: "codex-e2e",
      turn_id: "t1",
      cwd: sb.repo,
      transcript_path: null,
      model: "gpt-5",
      hook_event_name: "PreToolUse",
    });
    const gate = () => only(commands(sb, ".codex/hooks.json", "PreToolUse", GATE), "codex gate");
    const call = (command: string) =>
      runHook(
        sb,
        gate(),
        { ...base(), tool_name: "Bash", tool_use_id: "u1", tool_input: { command } },
        { cwd: sb.repo },
      );

    it("lets a git command through", async () => {
      const r = await call("git status");
      expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);
      expect(r.status, tail(r.out)).toBe(0);
      expect(r.stdout).not.toContain("deny");
    });

    it("rewrites a file dump through the installed bin", async () => {
      const r = await call("cat src/index.ts");
      expect(r.status, tail(r.out)).toBe(0);
      const updated = output(r).updatedInput;
      expect(isRecord(updated) ? updated.command : null).toMatch(
        new RegExp(
          `^${fs.realpathSync(sb.repo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/node_modules/\\.bin/repo job --job exec --query `,
        ),
      );
    });

    it("denies a read inside a dependency", async () => {
      const r = await call("cat node_modules/typescript/package.json");
      expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);
      expect(r.status === 2 || output(r).permissionDecision === "deny", tail(r.out)).toBe(true);
    });

    it("SessionStart injects the folder map", async () => {
      const r = await runHook(
        sb,
        only(commands(sb, ".codex/hooks.json", "SessionStart", MAP), "codex session-map"),
        { ...base(), hook_event_name: "SessionStart", source: "startup" },
        { cwd: sb.repo },
      );
      expectClean(sb, r);
      expect(output(r).hookEventName).toBe("SessionStart");
      expect(output(r).additionalContext).toContain("src/");
    });

    it("Stop runs every hook without blocking", async () => {
      const doc: unknown = JSON.parse(sb.read(".codex/hooks.json"));
      const stop =
        isRecord(doc) && isRecord(doc.hooks) && Array.isArray(doc.hooks.Stop) ? (doc.hooks.Stop as Group[]) : [];
      const stops = stop.flatMap((g) => g.hooks ?? []).flatMap((h) => (h.command ? [h.command] : []));
      expect(stops.length).toBeGreaterThan(0);
      for (const command of stops) {
        const r = await runHook(
          sb,
          command,
          { ...base(), hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "done" },
          { cwd: sb.repo },
        );
        expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);
        expect([0, 2], tail(r.out)).toContain(r.status);
      }
    });
  });

  describe("claude payload shapes", () => {
    const withRoot = () => ({ CLAUDE_PROJECT_DIR: sb.repo });
    const payload = (extra: Record<string, unknown>) => ({
      session_id: "claude-e2e",
      transcript_path: path.join(sb.root, "transcript.jsonl"),
      cwd: sb.repo,
      ...extra,
    });

    it.each(["startup", "resume", "clear", "compact"])("SessionStart source %s gets the folder map", async (source) => {
      const command = only(commands(sb, ".claude/settings.json", "SessionStart", MAP), "claude session-map");
      const r = await runHook(sb, command, payload({ hook_event_name: "SessionStart", source, model: "claude-opus" }), {
        env: withRoot(),
      });
      expectClean(sb, r);
      expect(output(r).hookEventName).toBe("SessionStart");
      expect(output(r).additionalContext).toContain("src/");
      expect(output(r).additionalContext).not.toContain("this worktree has no install");
    });

    it.each([false, true])("Stop with stop_hook_active %s runs every hook without blocking", async (active) => {
      const doc: unknown = JSON.parse(sb.read(".claude/settings.json"));
      const stop =
        isRecord(doc) && isRecord(doc.hooks) && Array.isArray(doc.hooks.Stop) ? (doc.hooks.Stop as Group[]) : [];
      for (const command of stop.flatMap((g) => g.hooks ?? []).flatMap((h) => (h.command ? [h.command] : []))) {
        const r = await runHook(sb, command, payload({ hook_event_name: "Stop", stop_hook_active: active }), {
          env: withRoot(),
        });
        expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);
        expect([0, 2], tail(r.out)).toContain(r.status);
      }
    });
  });

  describe("hosts that only get files generated", () => {
    /** Every file and link sync planned for the host, read back from disk as the outputs validation checks. */
    function planned(): Output[] {
      return readManifest(sb.repo).paths.flatMap((rel): Output[] => {
        const abs = path.join(sb.repo, rel);
        const stat = fs.lstatSync(abs, { throwIfNoEntry: false });
        expect(stat, `${rel} was planned but is missing`).toBeDefined();
        if (stat?.isSymbolicLink())
          return [{ kind: "link", path: rel, target: fs.readlinkSync(abs), tracked: false, managed: "whole" }];
        if (stat?.isFile())
          return [{ kind: "file", path: rel, content: fs.readFileSync(abs, "utf8"), tracked: false, managed: "whole" }];
        return [];
      });
    }

    it.each([
      {
        host: "grok",
        owns: ".grok/",
        others: [".claude", ".codex", ".cursor"],
        expected: [".grok/config.toml", ".grok/hooks/rtk.json", ".grok/roles"],
      },
      { host: "cursor", owns: ".cursor/", others: [".claude", ".codex", ".grok"], expected: [".cursor/hooks.json"] },
      {
        host: "antigravity",
        owns: ".agents/",
        others: [".claude", ".codex", ".grok", ".cursor"],
        expected: [".agents/hooks.json"],
      },
    ])(
      "$host: sync with only that host writes every planned file, and each passes validateOutputs",
      async ({ host, owns, others, expected }) => {
        const config = sb.read("workerstack.config.ts");
        sb.write("workerstack.config.ts", config.replace(/hosts: \[[^\]]*\]/, `hosts: ${JSON.stringify([host])}`));
        try {
          expectClean(sb, await sb.run("bun", ["repo", "sync"], { env: ROOT_VARS }));
          const outputs = planned();
          const own = outputs.filter((o) => o.path.startsWith(owns));
          expect(own.length, `${host} planned files`).toBeGreaterThan(0);
          for (const rel of expected)
            expect(sb.exists(rel) || own.some((o) => o.path.startsWith(`${rel}/`)), rel).toBe(true);
          for (const rel of others) expect(sb.exists(rel), rel).toBe(false);
          expect(validateOutputs(sb.repo, outputs)).toEqual([]);
          expectClean(sb, await sb.run("bun", ["repo", "sync", "--check"], { env: ROOT_VARS }));
        } finally {
          sb.write("workerstack.config.ts", config);
          await sb.run("bun", ["repo", "sync"], { env: ROOT_VARS });
        }
      },
    );
  });

  describe("a linked worktree with no install", () => {
    let wt: string;
    let main: string;

    beforeAll(async () => {
      main = fs.realpathSync(sb.repo);
      await sb.commit("hosts");
      // Outside the sandbox root, where T3 Code puts its worktrees.
      wt = path.join(fs.realpathSync(fs.mkdtempSync(path.join(inject("runRoot"), "t3-"))), "worktrees", "fix-x");
      await sb.git("worktree", "add", "-q", "-b", "fix-x", wt);
      expect(fs.existsSync(path.join(wt, "node_modules"))).toBe(false);
    });

    const env = () => ({ CLAUDE_PROJECT_DIR: wt });

    it("SessionStart says which bin runs, once, and still gives the map", async () => {
      const command = only(commands(sb, ".claude/settings.json", "SessionStart", MAP), "claude session-map");
      const r = await runHook(
        sb,
        command,
        { session_id: "wt-e2e", cwd: wt, hook_event_name: "SessionStart", source: "startup" },
        { cwd: wt, env: env() },
      );
      expectClean(sb, r);
      const context = String(output(r).additionalContext);
      expect(
        context.startsWith(
          `repo: hooks run ${main}/node_modules/.bin/repo (this worktree has no install); run \`bun install\` here to use its own code\n`,
        ),
      ).toBe(true);
      expect(context.split("hooks run").length).toBe(2);
      expect(context).toContain("src/");
    });

    it("the gate rewrites through the main checkout's bin with the worktree's paths", async () => {
      const command = only(commands(sb, ".claude/settings.json", "PreToolUse", GATE), "claude gate");
      const r = await runHook(
        sb,
        command,
        {
          session_id: "wt-e2e",
          cwd: wt,
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: `cat ${wt}/src/index.ts` },
        },
        { cwd: wt, env: env() },
      );
      expectClean(sb, r);
      const updated = output(r).updatedInput;
      const rewritten = String(isRecord(updated) ? updated.command : "");
      expect(rewritten.startsWith(`${main}/node_modules/.bin/repo job --job exec --query `), rewritten).toBe(true);
      expect(rewritten).toContain(`${wt}/src/index.ts`);
      expect(rewritten).not.toContain(`${main}/src/index.ts`);
    });

    it("a hook with no install anywhere still says to run bun install", async () => {
      const bare = fs.mkdtempSync(path.join(inject("runRoot"), "bare-"));
      const command = only(commands(sb, ".claude/settings.json", "SessionStart", MAP), "claude session-map");
      const r = await runHook(
        sb,
        command,
        { session_id: "x", cwd: bare },
        { cwd: bare, env: { CLAUDE_PROJECT_DIR: bare } },
      );
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`repo: ${fs.realpathSync(bare)}/node_modules/.bin/repo is missing; run bun install`);
    });
  });
});
