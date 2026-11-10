import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { HOOK_NAMES } from "./scripts/hook-command.ts";
import { COMMANDS, HOOKS, dispatch, isCommandName, runCommand, type Registry } from "./commands.ts";

describe("registry", () => {
  it.each(Object.keys(COMMANDS))("command %s loads a main", async (name) => {
    const entry = COMMANDS[name as keyof typeof COMMANDS];
    expect(typeof (await entry.load()).main).toBe("function");
  });

  it.each(HOOK_NAMES)("hook %s loads a main", async (name) => {
    expect(typeof (await HOOKS[name].load()).main).toBe("function");
  });

  it("names commands, and nothing else", () => {
    expect(isCommandName("job")).toBe(true);
    expect(isCommandName("toString")).toBe(false);
    expect(isCommandName(undefined)).toBe(false);
  });
});

describe("coverage", () => {
  it("is a command, with the help line Usage shows", () => {
    expect(isCommandName("coverage")).toBe(true);
    expect(COMMANDS.coverage.summary).toBe("run the suite with coverage and raise coverage-floors.json; a drop fails");
  });
});

describe("docs", () => {
  it("is a command, with the help line Usage shows", () => {
    expect(isCommandName("docs")).toBe(true);
    expect(COMMANDS.docs.summary).toBe(
      "Check references: index, links, exports, examples, tarball (--check: only check; else sync first)",
    );
  });
});

describe("github", () => {
  it("is a command, with the help line Usage shows", () => {
    expect(isCommandName("github")).toBe(true);
    expect(COMMANDS.github.summary).toBe(
      "apply the repository's rulesets, security settings and metadata, or report drift with --check",
    );
  });
});

describe("link and unlink", () => {
  it("are commands, with the help lines Usage shows", () => {
    expect(isCommandName("link")).toBe(true);
    expect(isCommandName("unlink")).toBe(true);
    expect(COMMANDS.link.summary).toBe(
      "Swap a dependency for a packed sibling checkout (status: list links; --pre-push: the push check)",
    );
    expect(COMMANDS.unlink.summary).toBe("Put a linked dependency back on npm (--all: every link)");
  });
});

describe("mutate", () => {
  it("is a command, with a help line that names its shards and floors", () => {
    expect(isCommandName("mutate")).toBe(true);
    expect(COMMANDS.mutate.summary).toBe(
      "mutation-test the tracked files in a clone of HEAD (--shard i/n, --report <file>); check <dir> [--write]: score reports against mutation-floors.json",
    );
  });
});

describe("bun repo", () => {
  it("has no tracked file but the bin that bun would run in its place", () => {
    const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n");
    expect(files.filter((f) => /(?:^|\/)repo\.(?:[cm]?js|jsx|tsx?)$/.test(f))).toEqual(["bin/repo.ts"]);
  });
});

describe("dispatch", () => {
  const registry = (main: (argv: string[]) => Promise<number>): Registry => {
    const stub = <T extends Record<string, object>>(table: T) =>
      Object.fromEntries(Object.entries(table).map(([k, v]) => [k, { ...v, load: async () => ({ main }) }])) as T;
    return { commands: stub(COMMANDS), hooks: stub(HOOKS) };
  };

  it.each([
    ["yolo", ["--dry-run", "--host", "grok"]],
    ["purge-mcps", ["--apply"]],
    ["doctor", []],
    ["setup", ["speak", "--skip-verify"]],
    ["job", ["--job", "exec", "--query", "echo hi", "-y"]],
    ["worktree", ["add", "x"]],
  ])("%s runs in-process with its argv untouched", async (cmd, args) => {
    const main = vi.fn(async () => 3);
    expect(await dispatch([cmd, ...args], registry(main))).toBe(3);
    expect(main).toHaveBeenCalledWith(args);
  });

  it("hook <name> runs the hook with its fixed argv first", async () => {
    const main = vi.fn(async () => 0);
    expect(await dispatch(["hook", "worktree"], registry(main))).toBe(0);
    expect(main).toHaveBeenCalledWith(["hook"]);
    expect(await dispatch(["hook", "gate-fat-tools", "x"], registry(main))).toBe(0);
    expect(main).toHaveBeenLastCalledWith(["x"]);
  });

  it.each([
    [
      [],
      "repo hook: name a hook; use gate-fat-tools, orchestrate-parent, rtk-grok, scrub-spawn-prompt, session-map or worktree\n",
    ],
    [
      ["nope"],
      'repo hook: unknown hook "nope"; use gate-fat-tools, orchestrate-parent, rtk-grok, scrub-spawn-prompt, session-map or worktree\n',
    ],
  ])("hook %j prints the hook list and exits 1", async (args, message) => {
    const main = vi.fn(async () => 0);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(await dispatch(["hook", ...args], registry(main))).toBe(1);
      expect(err.mock.calls.map((c) => String(c[0])).join("")).toBe(message);
    } finally {
      err.mockRestore();
    }
    expect(main).not.toHaveBeenCalled();
  });

  it("leaves every other command to cli/main.ts", async () => {
    const main = vi.fn(async () => 0);
    for (const argv of [[], ["init"], ["map", "cli"], ["help"], ["toString"]])
      expect(await dispatch(argv, registry(main)), argv.join(" ")).toBeNull();
    expect(main).not.toHaveBeenCalled();
  });

  it("with no registry given, still leaves a non-command to cli/main.ts", async () => {
    expect(await dispatch(["init"])).toBeNull();
  });

  it("runCommand runs the real registry entry by default", async () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(await runCommand("lessons", [])).toBe(1);
    } finally {
      err.mockRestore();
    }
  });
});
