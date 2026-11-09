import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { HOSTS, type Host } from "../../config.ts";
import { emitMcpPolicy } from "../../scripts/emit-mcp-policy.ts";
import { applyUnion } from "../../scripts/hooks-union.ts";
import { renderHooks } from "./hooks.ts";
import { type Sources, loadSources } from "./sources.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURES = path.join(ROOT, "cli/sync/fixtures");
const CONSUMER = path.join(FIXTURES, "consumer");
const STOCK = path.join(FIXTURES, "consumer-stock");
const GOLDEN = path.join(FIXTURES, "golden");
const HOOK_FILES = [".claude/settings.json", ".codex/hooks.json", ".agents/hooks.json", ".cursor/hooks.json"];
const BASE_REL = "agents/settings/claude.json";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * The hook files after the steps trees.ts still runs on the stage behind the generators: the MCP policy, then the
 * hooks union. Neither repo has `.repo/settings/claude.json`, so the overlay merge adds nothing.
 */
function afterStage(files: Map<string, string>, stock: string, consumer: string): Map<string, string> {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-hooks-"));
  temps.push(stage);
  for (const [rel, text] of files) {
    fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true });
    fs.writeFileSync(path.join(stage, rel), text);
  }
  expect(emitMcpPolicy({ workspaceRoot: stage, sourceRoot: stock, consumerRoot: consumer }).ok).toBe(true);
  expect(applyUnion({ workspaceRoot: stage, sourceRoot: stock, consumerRoot: consumer }).ok).toBe(true);
  return new Map(HOOK_FILES.map((rel) => [rel, fs.readFileSync(path.join(stage, rel), "utf8")]));
}

const cases = [
  { name: "the consumer fixture over the frozen stock", stock: STOCK, consumer: CONSUMER, expected: GOLDEN },
  { name: "this repo", stock: ROOT, consumer: ROOT, expected: ROOT },
];

describe.each(cases)("hooks of $name", ({ stock, consumer, expected }) => {
  const render = (hosts: readonly Host[] = HOSTS) =>
    renderHooks(loadSources({ stockRoot: stock, consumerRoot: consumer }).sources, hosts, fs.readFileSync(path.join(stock, BASE_REL), "utf8"));

  it("give the golden bytes once the MCP policy and hooks union ran over them", () => {
    const files = render();
    expect([...files.keys()]).toEqual(HOOK_FILES);
    const staged = afterStage(files, stock, consumer);
    for (const rel of HOOK_FILES) expect(staged.get(rel), rel).toBe(fs.readFileSync(path.join(expected, rel), "utf8"));
  });

  it("write only the files of the enabled hosts", () => {
    expect([...render(["grok"]).keys()]).toEqual([]);
    expect([...render(["codex", "cursor"]).keys()]).toEqual([".codex/hooks.json", ".cursor/hooks.json"]);
    expect([...render(["antigravity"]).keys()]).toEqual([".agents/hooks.json"]);
  });
});

const sources = (value: Record<string, unknown>): Sources => ({ rules: [], subagents: [], hooks: { rel: ".repo/hooks.jsonc", value } });
const json = (files: Map<string, string>, rel: string) => JSON.parse(files.get(rel)!) as Record<string, any>;

describe("renderHooks", () => {
  it("prefixes only a leading ./ in claude commands with the project dir", () => {
    const files = renderHooks(
      sources({
        hooks: {
          preToolUse: [
            { matcher: "Bash", command: "./a.sh x" },
            { matcher: "Bash", command: "'./q r.sh'" },
            { matcher: "Bash", command: "bun ./a.ts" },
          ],
        },
      }),
      ["claude", "codex"],
      "{}",
    );
    const claude = json(files, ".claude/settings.json");
    expect(Object.keys(claude)).toEqual(["$schema", "hooks"]);
    expect(claude.hooks.PreToolUse).toEqual([
      {
        matcher: "Bash",
        hooks: [
          { type: "command", command: '"$CLAUDE_PROJECT_DIR"/a.sh x' },
          { type: "command", command: `"$CLAUDE_PROJECT_DIR"/'q r.sh'` },
          { type: "command", command: "bun ./a.ts" },
        ],
      },
    ]);
    expect(json(files, ".codex/hooks.json").hooks.PreToolUse[0].hooks[0].command).toBe("./a.sh x");
  });

  it("replaces a shared event in place with the target override and appends new override events", () => {
    const files = renderHooks(
      sources({
        hooks: { stop: [{ command: "shared-stop" }], preToolUse: [{ matcher: "Read", command: "r" }] },
        claudecode: { hooks: { stop: [{ command: "override-stop" }], notification: [{ command: "n" }] } },
      }),
      ["claude", "antigravity"],
      '{"hooks":{"Old":[]},"z":1}',
    );
    const claude = json(files, ".claude/settings.json");
    expect(Object.keys(claude)).toEqual(["$schema", "hooks", "z"]);
    expect(Object.keys(claude.hooks)).toEqual(["Stop", "PreToolUse", "Notification"]);
    expect(claude.hooks.Stop).toEqual([{ hooks: [{ type: "command", command: "override-stop" }] }]);
    expect(json(files, ".agents/hooks.json")).toEqual({
      rulesync: {
        Stop: [{ type: "command", command: "shared-stop" }],
        PreToolUse: [{ matcher: "(?:read_file|view_file)", hooks: [{ type: "command", command: "r" }] }],
      },
    });
  });

  it("translates every event of each host's map and skips the events a host lacks", () => {
    const claude = {
      sessionStart: "SessionStart", sessionEnd: "SessionEnd", preToolUse: "PreToolUse", postToolUse: "PostToolUse",
      beforeSubmitPrompt: "UserPromptSubmit", stop: "Stop", subagentStop: "SubagentStop", preCompact: "PreCompact",
      permissionRequest: "PermissionRequest", notification: "Notification", setup: "Setup", worktreeCreate: "WorktreeCreate",
      worktreeRemove: "WorktreeRemove", messageDisplay: "MessageDisplay", instructionsLoaded: "InstructionsLoaded",
      userPromptExpansion: "UserPromptExpansion", postToolUseFailure: "PostToolUseFailure", postToolBatch: "PostToolBatch",
      permissionDenied: "PermissionDenied", subagentStart: "SubagentStart", taskCreated: "TaskCreated",
      taskCompleted: "TaskCompleted", stopFailure: "StopFailure", teammateIdle: "TeammateIdle", configChange: "ConfigChange",
      cwdChanged: "CwdChanged", fileChanged: "FileChanged", directoryAdded: "DirectoryAdded", postCompact: "PostCompact",
      elicitation: "Elicitation", elicitationResult: "ElicitationResult", preModelSwitch: "PreModelSwitch",
      postModelSwitch: "PostModelSwitch",
    };
    const codex = {
      sessionStart: "SessionStart", sessionEnd: "SessionEnd", preToolUse: "PreToolUse", postToolUse: "PostToolUse",
      beforeSubmitPrompt: "UserPromptSubmit", stop: "Stop", stopCancelled: "Interrupt", permissionRequest: "PermissionRequest",
      subagentStart: "SubagentStart", subagentStop: "SubagentStop", preCompact: "PreCompact", postCompact: "PostCompact",
      preModelInvocation: "PreModelRequest", postModelInvocation: "PostModelRequest",
    };
    const antigravity = {
      sessionStart: "SessionStart", preToolUse: "PreToolUse", postToolUse: "PostToolUse",
      preModelInvocation: "PreInvocation", postModelInvocation: "PostInvocation", stop: "Stop",
    };
    const cursorEvents = [
      "sessionStart", "sessionEnd", "preToolUse", "postToolUse", "beforeSubmitPrompt", "stop", "subagentStop", "preCompact",
      "postToolUseFailure", "subagentStart", "beforeShellExecution", "afterShellExecution", "beforeMCPExecution",
      "afterMCPExecution", "beforeReadFile", "afterFileEdit", "afterAgentResponse", "afterAgentThought", "beforeTabFileRead",
      "afterTabFileEdit", "workspaceOpen",
    ];
    const events = [...new Set([...Object.keys(claude), ...Object.keys(codex), ...cursorEvents, "unknownEvent"])];
    const files = renderHooks(sources({ hooks: Object.fromEntries(events.map((event) => [event, [{ command: "c" }]])) }), HOSTS, "{}");
    const toolNames = (map: Record<string, string>) => events.filter((event) => event in map).map((event) => map[event]);
    expect(Object.keys(json(files, ".claude/settings.json").hooks)).toEqual(toolNames(claude));
    expect(Object.keys(json(files, ".codex/hooks.json").hooks)).toEqual(toolNames(codex));
    expect(Object.keys(json(files, ".agents/hooks.json").rulesync)).toEqual(toolNames(antigravity));
    expect(Object.keys(json(files, ".cursor/hooks.json").hooks)).toEqual(events.filter((event) => cursorEvents.includes(event)));
  });

  it("drops the matcher on claude's matcher-less events but keeps each matcher's group apart", () => {
    const noMatcher = ["worktreeCreate", "worktreeRemove", "messageDisplay", "postToolBatch", "taskCreated", "taskCompleted", "teammateIdle", "cwdChanged", "beforeSubmitPrompt", "stop"];
    const files = renderHooks(
      sources({ hooks: Object.fromEntries([...noMatcher, "subagentStop"].map((event) => [event, [{ matcher: "x", command: "a" }, { command: "b" }]])) }),
      ["claude"],
      "{}",
    );
    const hooks = json(files, ".claude/settings.json").hooks;
    const split = [{ hooks: [{ type: "command", command: "a" }] }, { hooks: [{ type: "command", command: "b" }] }];
    for (const event of Object.keys(hooks).filter((event) => event !== "SubagentStop")) expect(hooks[event], event).toEqual(split);
    expect(Object.keys(hooks)).toHaveLength(noMatcher.length + 1);
    expect(hooks.SubagentStop).toEqual([{ matcher: "x", hooks: [{ type: "command", command: "a" }] }, split[1]]);
  });

  it("writes each claude hook type with its payload, drops other types and keeps an existing $schema", () => {
    const files = renderHooks(
      sources({
        hooks: {
          preToolUse: [
            { type: "http", url: "u", headers: { a: "b" }, allowedEnvVars: ["E"], timeout: null },
            { type: "mcp_tool", server: "s", tool: "t", input: { k: 1 } },
            { type: "prompt", prompt: "p", model: "m", timeout: 9 },
            { type: "agent", prompt: "q", model: null },
            { type: "other", command: "dropped" },
          ],
          stop: [{ type: "other", command: "dropped" }],
        },
      }),
      ["claude"],
      '{"a":1,"$schema":"own"}',
    );
    expect(files.get(".claude/settings.json")).toBe(
      `${JSON.stringify(
        {
          a: 1,
          $schema: "own",
          hooks: {
            PreToolUse: [
              {
                hooks: [
                  { type: "http", url: "u", headers: { a: "b" }, allowedEnvVars: ["E"] },
                  { type: "mcp_tool", server: "s", tool: "t", input: { k: 1 } },
                  { type: "prompt", timeout: 9, prompt: "p", model: "m" },
                  { type: "agent", prompt: "q" },
                ],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );
  });

  it("writes codex name and description last and drops handlers codex refuses", () => {
    const files = renderHooks(
      sources({
        hooks: {
          preToolUse: [
            { description: "d", name: "n", command: "c", timeout: 1 },
            { type: "mcp_tool", server: "s", tool: "t", input: { k: [1] } },
            { type: "prompt", prompt: "unsupported" },
            { command: "negative", timeout: -1 },
            { command: "fraction", timeout: 1.5 },
            { command: "text", timeout: "5" },
            { type: "mcp_tool", tool: "t" },
            { type: "mcp_tool", server: "s", tool: "" },
            { type: "mcp_tool", server: "s", tool: "t", input: { k: [null] } },
          ],
          stop: [{ command: "gone", timeout: -1 }],
        },
        codexcli: { hooks: { worktreeCreate: [{ command: "w" }] } },
      }),
      ["codex"],
      "{}",
    );
    expect(json(files, ".codex/hooks.json")).toEqual({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { type: "command", command: "c", timeout: 1, name: "n", description: "d" },
              { type: "mcp_tool", server: "s", tool: "t", input: { k: [1] } },
            ],
          },
        ],
        worktreeCreate: [{ hooks: [{ type: "command", command: "w" }] }],
      },
    });
    expect(Object.keys(json(files, ".codex/hooks.json").hooks.PreToolUse[0].hooks[0])).toEqual(["type", "command", "timeout", "name", "description"]);
  });

  it("flattens antigravity's matcher-less events untranslated and translates only whole tool names elsewhere", () => {
    const files = renderHooks(
      sources({
        hooks: {
          sessionStart: [{ matcher: "Bash", command: "s" }],
          preModelInvocation: [{ command: "m" }],
          postToolUse: [
            { matcher: "Bash|\\bRead|[Edit]|MyBash|Grep", command: "p" },
            { type: "prompt", prompt: "dropped" },
          ],
        },
      }),
      ["antigravity"],
      "{}",
    );
    expect(json(files, ".agents/hooks.json")).toEqual({
      rulesync: {
        SessionStart: [{ type: "command", command: "s" }],
        PreInvocation: [{ type: "command", command: "m" }],
        PostToolUse: [{ matcher: "run_command|\\b(?:read_file|view_file)|[Edit]|MyBash|Grep", hooks: [{ type: "command", command: "p" }] }],
      },
    });
  });

  it("writes an empty antigravity object and cursor version 1 when there are no hooks", () => {
    const files = renderHooks(sources({}), ["antigravity", "cursor"], "{}");
    expect(files.get(".agents/hooks.json")).toBe("{}\n");
    expect(json(files, ".cursor/hooks.json")).toEqual({ version: 1, hooks: {} });
  });

  it("maps cursor entries flat, keeping command and prompt handlers only", () => {
    const files = renderHooks(
      sources({
        version: 2,
        hooks: {
          stop: [
            { failClosed: true, matcher: "", loop_limit: 3, command: "a", timeout: null },
            { type: "prompt", prompt: "p", model: "x", timeout: 3, loop_limit: null },
            { type: "command", command: "b", model: "ignored" },
            { type: "agent", command: "dropped" },
          ],
          sessionEnd: [{ type: "agent", command: "dropped" }],
        },
        cursor: { hooks: { customEvent: [{ command: "c" }] } },
      }),
      ["cursor"],
      "{}",
    );
    expect(files.get(".cursor/hooks.json")).toBe(
      `${JSON.stringify(
        {
          version: 2,
          hooks: {
            stop: [
              { command: "a", loop_limit: 3, matcher: "", failClosed: true },
              { type: "prompt", timeout: 3, loop_limit: null, prompt: "p", model: "x" },
              { type: "command", command: "b" },
            ],
            customEvent: [{ command: "c" }],
          },
        },
        null,
        2,
      )}\n`,
    );
  });

  describe("passthrough fields", () => {
    const every = {
      args: ["x"], shell: "bash", statusMessage: "m", if: "Bash(git *)", continueOnBlock: true, asyncRewake: false, async: false,
      once: true, failClosed: true, additionalContextLimit: 100, commandWindows: "c.cmd", loop_limit: 2, unknown: "u",
    };
    const render = (host: Host, event: string, def: Record<string, unknown>) => {
      const files = renderHooks(sources({ hooks: { [event]: [def] } }), [host], "{}");
      const file = json(files, [...files.keys()][0]!);
      return (host === "antigravity" ? file.rulesync : file.hooks) as Record<string, any>;
    };

    it.each([
      ["claude", ["once", "async", "asyncRewake", "continueOnBlock", "onFailure", "if", "statusMessage", "shell", "args", "type", "command", "timeout"]],
      ["codex", ["async", "additionalContextLimit", "commandWindows", "statusMessage", "type", "command", "timeout"]],
      ["antigravity", ["type", "command", "timeout"]],
      ["cursor", ["command", "timeout", "loop_limit", "matcher", "failClosed"]],
    ] as const)("%s keeps each of its fields in rulesync's order", (host, keys) => {
      const hooks = render(host, "preToolUse", { ...every, matcher: "Bash", command: "c", timeout: 5 });
      const hook = host === "cursor" ? hooks.preToolUse[0] : Object.values(hooks)[0][0].hooks[0];
      expect(Object.keys(hook)).toEqual(keys);
      if (host === "claude") expect(hook.onFailure).toBe("block");
    });

    it("drops command-only fields from other hook types and values of the wrong kind", () => {
      const claude = render("claude", "preToolUse", { type: "http", url: "u", ...every, once: "yes", statusMessage: "" });
      expect(claude.PreToolUse[0].hooks[0]).toEqual({ continueOnBlock: true, onFailure: "block", if: "Bash(git *)", type: "http", url: "u" });
      const codex = render("codex", "preToolUse", { type: "mcp_tool", server: "s", tool: "t", ...every });
      expect(codex.PreToolUse[0].hooks[0]).toEqual({ statusMessage: "m", type: "mcp_tool", server: "s", tool: "t" });
      const invalid = render("codex", "preToolUse", { command: "c", async: "yes", additionalContextLimit: Infinity, args: [1] });
      expect(invalid.PreToolUse[0].hooks[0]).toEqual({ type: "command", command: "c" });
      expect(render("claude", "preToolUse", { command: "c", args: ["a", 1] }).PreToolUse[0].hooks[0]).toEqual({ type: "command", command: "c" });
    });

    it.each([
      ["a command hook", "preToolUse", { command: "c" }, true],
      ["an http hook", "preToolUse", { type: "http", url: "u" }, true],
      ["a prompt hook", "preToolUse", { type: "prompt", prompt: "p" }, false],
      ["a false value", "preToolUse", { command: "c", failClosed: false }, false],
      ...["stop", "subagentStop", "taskCompleted", "teammateIdle"].map((event) => [`the ${event} event`, event, { command: "c" }, false] as const),
      ["an async command hook", "preToolUse", { command: "c", async: true }, false],
      ["an asyncRewake command hook", "preToolUse", { command: "c", asyncRewake: true }, false],
      ["an http hook with async set", "preToolUse", { type: "http", url: "u", async: true }, true],
    ] as const)("writes claude's onFailure from failClosed on %s: %s", (_, event, def, written) => {
      const hooks = render("claude", event, { failClosed: true, ...def });
      expect(Object.values(hooks)[0][0].hooks[0].onFailure).toBe(written ? "block" : undefined);
    });

    it("prefixes a leading ./ of an exec-form claude command with the braced project dir, quotes stripped", () => {
      const command = (value: string) => render("claude", "preToolUse", { command: value, args: [] }).PreToolUse[0].hooks[0].command;
      expect(command("./a.sh")).toBe("${CLAUDE_PROJECT_DIR}/a.sh");
      expect(command("'./q r.sh'")).toBe("${CLAUDE_PROJECT_DIR}/q r.sh");
      expect(command(`"./half`)).toBe("${CLAUDE_PROJECT_DIR}/half");
      expect(command("bin/x")).toBe("bin/x");
    });
  });
});

