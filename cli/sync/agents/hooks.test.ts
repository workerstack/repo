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
  for (const dir of temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
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
  expect(emitMcpPolicy({ consumerRoot: consumer, sourceRoot: stock, workspaceRoot: stage }).ok).toBe(true);
  expect(applyUnion({ consumerRoot: consumer, sourceRoot: stock, workspaceRoot: stage }).ok).toBe(true);
  return new Map(HOOK_FILES.map((rel) => [rel, fs.readFileSync(path.join(stage, rel), "utf8")]));
}

const cases = [
  { consumer: CONSUMER, expected: GOLDEN, name: "the consumer fixture over the frozen stock", stock: STOCK },
  { consumer: ROOT, expected: ROOT, name: "this repo", stock: ROOT },
];

describe.each(cases)("hooks of $name", ({ stock, consumer, expected }) => {
  const render = (hosts: readonly Host[] = HOSTS) =>
    renderHooks(
      loadSources({ consumerRoot: consumer, packages: [], stockRoot: stock }).sources,
      hosts,
      fs.readFileSync(path.join(stock, BASE_REL), "utf8"),
    );

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

const sources = (value: Record<string, unknown>): Sources => ({
  hooks: { rel: ".repo/hooks.jsonc", value },
  rules: [],
  subagents: [],
});
const json = (files: Map<string, string>, rel: string) => JSON.parse(files.get(rel)!) as Record<string, any>;

describe("renderHooks", () => {
  it("prefixes only a leading ./ in claude commands with the project dir", () => {
    const files = renderHooks(
      sources({
        hooks: {
          preToolUse: [
            { command: "./a.sh x", matcher: "Bash" },
            { command: "'./q r.sh'", matcher: "Bash" },
            { command: "bun ./a.ts", matcher: "Bash" },
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
        hooks: [
          { command: '"$CLAUDE_PROJECT_DIR"/a.sh x', type: "command" },
          { command: `"$CLAUDE_PROJECT_DIR"/'q r.sh'`, type: "command" },
          { command: "bun ./a.ts", type: "command" },
        ],
        matcher: "Bash",
      },
    ]);
    expect(json(files, ".codex/hooks.json").hooks.PreToolUse[0].hooks[0].command).toBe("./a.sh x");
  });

  it("replaces a shared event in place with the target override and appends new override events", () => {
    const files = renderHooks(
      sources({
        claudecode: { hooks: { notification: [{ command: "n" }], stop: [{ command: "override-stop" }] } },
        hooks: { preToolUse: [{ command: "r", matcher: "Read" }], stop: [{ command: "shared-stop" }] },
      }),
      ["claude", "antigravity"],
      '{"hooks":{"Old":[]},"z":1}',
    );
    const claude = json(files, ".claude/settings.json");
    expect(Object.keys(claude)).toEqual(["$schema", "hooks", "z"]);
    expect(Object.keys(claude.hooks)).toEqual(["PreToolUse", "Stop", "Notification"]);
    expect(claude.hooks.Stop).toEqual([{ hooks: [{ command: "override-stop", type: "command" }] }]);
    expect(json(files, ".agents/hooks.json")).toEqual({
      rulesync: {
        PreToolUse: [{ hooks: [{ command: "r", type: "command" }], matcher: "(?:read_file|view_file)" }],
        Stop: [{ command: "shared-stop", type: "command" }],
      },
    });
  });

  it("translates every event of each host's map and skips the events a host lacks", () => {
    const claude = {
      beforeSubmitPrompt: "UserPromptSubmit",
      configChange: "ConfigChange",
      cwdChanged: "CwdChanged",
      directoryAdded: "DirectoryAdded",
      elicitation: "Elicitation",
      elicitationResult: "ElicitationResult",
      fileChanged: "FileChanged",
      instructionsLoaded: "InstructionsLoaded",
      messageDisplay: "MessageDisplay",
      notification: "Notification",
      permissionDenied: "PermissionDenied",
      permissionRequest: "PermissionRequest",
      postCompact: "PostCompact",
      postModelSwitch: "PostModelSwitch",
      postToolBatch: "PostToolBatch",
      postToolUse: "PostToolUse",
      postToolUseFailure: "PostToolUseFailure",
      preCompact: "PreCompact",
      preModelSwitch: "PreModelSwitch",
      preToolUse: "PreToolUse",
      sessionEnd: "SessionEnd",
      sessionStart: "SessionStart",
      setup: "Setup",
      stop: "Stop",
      stopFailure: "StopFailure",
      subagentStart: "SubagentStart",
      subagentStop: "SubagentStop",
      taskCompleted: "TaskCompleted",
      taskCreated: "TaskCreated",
      teammateIdle: "TeammateIdle",
      userPromptExpansion: "UserPromptExpansion",
      worktreeCreate: "WorktreeCreate",
      worktreeRemove: "WorktreeRemove",
    };
    const codex = {
      beforeSubmitPrompt: "UserPromptSubmit",
      permissionRequest: "PermissionRequest",
      postCompact: "PostCompact",
      postModelInvocation: "PostModelRequest",
      postToolUse: "PostToolUse",
      preCompact: "PreCompact",
      preModelInvocation: "PreModelRequest",
      preToolUse: "PreToolUse",
      sessionEnd: "SessionEnd",
      sessionStart: "SessionStart",
      stop: "Stop",
      stopCancelled: "Interrupt",
      subagentStart: "SubagentStart",
      subagentStop: "SubagentStop",
    };
    const antigravity = {
      postModelInvocation: "PostInvocation",
      postToolUse: "PostToolUse",
      preModelInvocation: "PreInvocation",
      preToolUse: "PreToolUse",
      sessionStart: "SessionStart",
      stop: "Stop",
    };
    const cursorEvents = [
      "sessionStart",
      "sessionEnd",
      "preToolUse",
      "postToolUse",
      "beforeSubmitPrompt",
      "stop",
      "subagentStop",
      "preCompact",
      "postToolUseFailure",
      "subagentStart",
      "beforeShellExecution",
      "afterShellExecution",
      "beforeMCPExecution",
      "afterMCPExecution",
      "beforeReadFile",
      "afterFileEdit",
      "afterAgentResponse",
      "afterAgentThought",
      "beforeTabFileRead",
      "afterTabFileEdit",
      "workspaceOpen",
    ];
    const events = [...new Set([...Object.keys(claude), ...Object.keys(codex), ...cursorEvents, "unknownEvent"])];
    const files = renderHooks(
      sources({ hooks: Object.fromEntries(events.map((event) => [event, [{ command: "c" }]])) }),
      HOSTS,
      "{}",
    );
    const toolNames = (map: Record<string, string>) =>
      events.filter((event) => event in map).map((event) => map[event]);
    expect(Object.keys(json(files, ".claude/settings.json").hooks)).toEqual(toolNames(claude));
    expect(Object.keys(json(files, ".codex/hooks.json").hooks)).toEqual(toolNames(codex));
    expect(Object.keys(json(files, ".agents/hooks.json").rulesync)).toEqual(toolNames(antigravity));
    expect(Object.keys(json(files, ".cursor/hooks.json").hooks)).toEqual(
      events.filter((event) => cursorEvents.includes(event)),
    );
  });

  it("drops the matcher on claude's matcher-less events but keeps each matcher's group apart", () => {
    const noMatcher = [
      "worktreeCreate",
      "worktreeRemove",
      "messageDisplay",
      "postToolBatch",
      "taskCreated",
      "taskCompleted",
      "teammateIdle",
      "cwdChanged",
      "beforeSubmitPrompt",
      "stop",
    ];
    const files = renderHooks(
      sources({
        hooks: Object.fromEntries(
          [...noMatcher, "subagentStop"].map((event) => [event, [{ command: "a", matcher: "x" }, { command: "b" }]]),
        ),
      }),
      ["claude"],
      "{}",
    );
    const hooks = json(files, ".claude/settings.json").hooks;
    const split = [{ hooks: [{ command: "a", type: "command" }] }, { hooks: [{ command: "b", type: "command" }] }];
    for (const event of Object.keys(hooks).filter((event) => event !== "SubagentStop"))
      expect(hooks[event], event).toEqual(split);
    expect(Object.keys(hooks)).toHaveLength(noMatcher.length + 1);
    expect(hooks.SubagentStop).toEqual([{ hooks: [{ command: "a", type: "command" }], matcher: "x" }, split[1]]);
  });

  it("writes each claude hook type with its payload, drops other types and keeps an existing $schema", () => {
    const files = renderHooks(
      sources({
        hooks: {
          preToolUse: [
            { allowedEnvVars: ["E"], headers: { a: "b" }, timeout: null, type: "http", url: "u" },
            { input: { k: 1 }, server: "s", tool: "t", type: "mcp_tool" },
            { model: "m", prompt: "p", timeout: 9, type: "prompt" },
            { model: null, prompt: "q", type: "agent" },
            { command: "dropped", type: "other" },
          ],
          stop: [{ command: "dropped", type: "other" }],
        },
      }),
      ["claude"],
      '{"a":1,"$schema":"own"}',
    );
    // An existing $schema keeps its place.
    expect(Object.keys(json(files, ".claude/settings.json"))).toStrictEqual(["a", "$schema", "hooks"]);
    expect(json(files, ".claude/settings.json")).toStrictEqual({
      $schema: "own",
      a: 1,
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { allowedEnvVars: ["E"], headers: { a: "b" }, type: "http", url: "u" },
              { input: { k: 1 }, server: "s", tool: "t", type: "mcp_tool" },
              { model: "m", prompt: "p", timeout: 9, type: "prompt" },
              { prompt: "q", type: "agent" },
            ],
          },
        ],
      },
    });
  });

  it("writes codex name and description last and drops handlers codex refuses", () => {
    const files = renderHooks(
      sources({
        codexcli: { hooks: { worktreeCreate: [{ command: "w" }] } },
        hooks: {
          preToolUse: [
            { command: "c", description: "d", name: "n", timeout: 1 },
            { input: { k: [1] }, server: "s", tool: "t", type: "mcp_tool" },
            { prompt: "unsupported", type: "prompt" },
            { command: "negative", timeout: -1 },
            { command: "fraction", timeout: 1.5 },
            { command: "text", timeout: "5" },
            { tool: "t", type: "mcp_tool" },
            { server: "s", tool: "", type: "mcp_tool" },
            { input: { k: [null] }, server: "s", tool: "t", type: "mcp_tool" },
          ],
          stop: [{ command: "gone", timeout: -1 }],
        },
      }),
      ["codex"],
      "{}",
    );
    expect(json(files, ".codex/hooks.json")).toEqual({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { command: "c", description: "d", name: "n", timeout: 1, type: "command" },
              { input: { k: [1] }, server: "s", tool: "t", type: "mcp_tool" },
            ],
          },
        ],
        worktreeCreate: [{ hooks: [{ command: "w", type: "command" }] }],
      },
    });
    expect(Object.keys(json(files, ".codex/hooks.json").hooks.PreToolUse[0].hooks[0])).toEqual([
      "command",
      "timeout",
      "type",
      "name",
      "description",
    ]);
  });

  it("flattens antigravity's matcher-less events untranslated and translates only whole tool names elsewhere", () => {
    const files = renderHooks(
      sources({
        hooks: {
          postToolUse: [
            { command: "p", matcher: "Bash|\\bRead|[Edit]|MyBash|Grep" },
            { prompt: "dropped", type: "prompt" },
          ],
          preModelInvocation: [{ command: "m" }],
          sessionStart: [{ command: "s", matcher: "Bash" }],
        },
      }),
      ["antigravity"],
      "{}",
    );
    expect(json(files, ".agents/hooks.json")).toEqual({
      rulesync: {
        PostToolUse: [
          {
            hooks: [{ command: "p", type: "command" }],
            matcher: "run_command|\\b(?:read_file|view_file)|[Edit]|MyBash|Grep",
          },
        ],
        PreInvocation: [{ command: "m", type: "command" }],
        SessionStart: [{ command: "s", type: "command" }],
      },
    });
  });

  it("writes an empty antigravity object and cursor version 1 when there are no hooks", () => {
    const files = renderHooks(sources({}), ["antigravity", "cursor"], "{}");
    expect(files.get(".agents/hooks.json")).toBe("{}\n");
    expect(json(files, ".cursor/hooks.json")).toEqual({ hooks: {}, version: 1 });
  });

  it("maps cursor entries flat, keeping command and prompt handlers only", () => {
    const files = renderHooks(
      sources({
        cursor: { hooks: { customEvent: [{ command: "c" }] } },
        hooks: {
          sessionEnd: [{ command: "dropped", type: "agent" }],
          stop: [
            { command: "a", failClosed: true, loop_limit: 3, matcher: "", timeout: null },
            { loop_limit: null, model: "x", prompt: "p", timeout: 3, type: "prompt" },
            { command: "b", model: "ignored", type: "command" },
            { command: "dropped", type: "agent" },
          ],
        },
        version: 2,
      }),
      ["cursor"],
      "{}",
    );
    // A target override's new event follows the shared ones.
    expect(files.get(".cursor/hooks.json")).toMatch(/"stop"[\s\S]*"customEvent"/);
    expect(json(files, ".cursor/hooks.json")).toStrictEqual({
      hooks: {
        customEvent: [{ command: "c" }],
        stop: [
          { command: "a", failClosed: true, loop_limit: 3, matcher: "" },
          { loop_limit: null, model: "x", prompt: "p", timeout: 3, type: "prompt" },
          { command: "b", type: "command" },
        ],
      },
      version: 2,
    });
  });

  describe("passthrough fields", () => {
    const every = {
      additionalContextLimit: 100,
      args: ["x"],
      async: false,
      asyncRewake: false,
      commandWindows: "c.cmd",
      continueOnBlock: true,
      failClosed: true,
      if: "Bash(git *)",
      loop_limit: 2,
      once: true,
      shell: "bash",
      statusMessage: "m",
      unknown: "u",
    };
    const render = (host: Host, event: string, def: Record<string, unknown>) => {
      const files = renderHooks(sources({ hooks: { [event]: [def] } }), [host], "{}");
      const file = json(files, [...files.keys()][0]!);
      return (host === "antigravity" ? file.rulesync : file.hooks) as Record<string, any>;
    };

    it.each([
      [
        "claude",
        [
          "once",
          "async",
          "asyncRewake",
          "continueOnBlock",
          "onFailure",
          "if",
          "statusMessage",
          "shell",
          "args",
          "command",
          "timeout",
          "type",
        ],
      ],
      ["codex", ["async", "additionalContextLimit", "commandWindows", "statusMessage", "command", "timeout", "type"]],
      ["antigravity", ["command", "timeout", "type"]],
      ["cursor", ["command", "failClosed", "loop_limit", "matcher", "timeout"]],
    ] as const)(
      "%s writes its passthrough fields in rulesync's order, then the handler's own fields sorted",
      (host, keys) => {
        const hooks = render(host, "preToolUse", { ...every, command: "c", matcher: "Bash", timeout: 5 });
        const hook = host === "cursor" ? hooks.preToolUse[0] : Object.values(hooks)[0][0].hooks[0];
        expect(Object.keys(hook)).toEqual(keys);
        if (host === "claude") expect(hook.onFailure).toBe("block");
      },
    );

    it("drops command-only fields from other hook types and values of the wrong kind", () => {
      const claude = render("claude", "preToolUse", {
        type: "http",
        url: "u",
        ...every,
        once: "yes",
        statusMessage: "",
      });
      expect(claude.PreToolUse[0].hooks[0]).toEqual({
        continueOnBlock: true,
        if: "Bash(git *)",
        onFailure: "block",
        type: "http",
        url: "u",
      });
      const codex = render("codex", "preToolUse", { server: "s", tool: "t", type: "mcp_tool", ...every });
      expect(codex.PreToolUse[0].hooks[0]).toEqual({ server: "s", statusMessage: "m", tool: "t", type: "mcp_tool" });
      const invalid = render("codex", "preToolUse", {
        additionalContextLimit: Infinity,
        args: [1],
        async: "yes",
        command: "c",
      });
      expect(invalid.PreToolUse[0].hooks[0]).toEqual({ command: "c", type: "command" });
      expect(render("claude", "preToolUse", { args: ["a", 1], command: "c" }).PreToolUse[0].hooks[0]).toEqual({
        command: "c",
        type: "command",
      });
    });

    it.each([
      ["a command hook", "preToolUse", { command: "c" }, true],
      ["an http hook", "preToolUse", { type: "http", url: "u" }, true],
      ["a prompt hook", "preToolUse", { prompt: "p", type: "prompt" }, false],
      ["a false value", "preToolUse", { command: "c", failClosed: false }, false],
      ...["stop", "subagentStop", "taskCompleted", "teammateIdle"].map(
        (event) => [`the ${event} event`, event, { command: "c" }, false] as const,
      ),
      ["an async command hook", "preToolUse", { async: true, command: "c" }, false],
      ["an asyncRewake command hook", "preToolUse", { asyncRewake: true, command: "c" }, false],
      ["an http hook with async set", "preToolUse", { async: true, type: "http", url: "u" }, true],
    ] as const)("writes claude's onFailure from failClosed on %s: %s", (_, event, def, written) => {
      const hooks = render("claude", event, { failClosed: true, ...def });
      expect(Object.values(hooks)[0][0].hooks[0].onFailure).toBe(written ? "block" : undefined);
    });

    it("prefixes a leading ./ of an exec-form claude command with the braced project dir, quotes stripped", () => {
      const command = (value: string) =>
        render("claude", "preToolUse", { args: [], command: value }).PreToolUse[0].hooks[0].command;
      expect(command("./a.sh")).toBe("${CLAUDE_PROJECT_DIR}/a.sh");
      expect(command("'./q r.sh'")).toBe("${CLAUDE_PROJECT_DIR}/q r.sh");
      expect(command(`"./half`)).toBe("${CLAUDE_PROJECT_DIR}/half");
      expect(command("bin/x")).toBe("bin/x");
    });
  });
});
