import { execFileSync } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import { HOOKS } from "./commands-hooks.ts";
import { COMMANDS, dispatch, isCommandName, runCommand } from "./commands.ts";
import type { Main, Registry } from "./commands.types.ts";
import { HOOK_NAMES } from "./scripts/hook-command.ts";

describe("registry", () => {
  it.each(Object.entries(COMMANDS))("command %s loads a main", async (_name, entry) => {
    const loaded = await entry.load();
    expect(loaded.main).toBeTypeOf("function");
  });

  it.each(HOOK_NAMES)("hook %s loads a main", async (name) => {
    const loaded = await HOOKS[name].load();
    expect(loaded.main).toBeTypeOf("function");
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
      "mutation-test the tracked files in a clone of HEAD (--shard i/n, --report <file>); " +
        "check <dir> [--write]: score reports against mutation-floors.json",
    );
  });
});

describe("bun repo", () => {
  it("has no tracked file but the bin that bun would run in its place", () => {
    const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n");
    expect(files.filter((f) => /(?:^|\/)repo\.(?:[cm]?js|jsx|tsx?)$/.test(f))).toStrictEqual(["bin/repo.ts"]);
  });
});

/** The registry with every command's and hook's `load` replaced by `load`. */
function stubbed(load: () => Promise<{ main: Main }>): Registry {
  function stub<T extends Record<string, object>>(table: T) {
    return Object.fromEntries(
      Object.entries(table).map(([k, v]) => [k, { ...v, load }]),
    ) /* the same keys, each entry with only its load replaced */ as T;
  }

  return { commands: stub(COMMANDS), hooks: stub(HOOKS) };
}

/** The registry with every command's and hook's `main` replaced by `main`. */
function registry(main: Main): Registry {
  return stubbed(() => Promise.resolve({ main }));
}

/** The registry with every command's and hook's `load` throwing, so a test sees what loads nothing. */
function unloadable(): Registry {
  return stubbed(() => {
    throw new Error("help loaded a command");
  });
}

/** What `dispatch` returns for `argv`, and what it wrote to stdout. */
async function dispatched(argv: string[], table: Registry): Promise<{ code: number | null; out: string }> {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  try {
    const code = await dispatch(argv, table);

    return { code, out: out.mock.calls.map((c) => String(c[0])).join("") };
  } finally {
    out.mockRestore();
  }
}

/** The usage line each command's help starts with; env keeps its `bun repo env` spelling. */
function usagePrefix(name: string): string {
  return name === "env" ? "usage: bun repo env" : `usage: repo ${name}`;
}

describe("dispatch help", () => {
  /** Each command name with each help flag, and the summary its help shows. */
  const asks = Object.entries(COMMANDS).flatMap(([name, { summary }]) =>
    ["--help", "-h"].map((flag): [string, string, string] => [name, flag, summary]),
  );

  it.each(asks)("%s %s prints the usage line and summary, exits 0 and loads nothing", async (name, flag, summary) => {
    const { code, out } = await dispatched([name, flag], unloadable());
    const [usageLine = "", summaryLine, ...rest] = out.split("\n");

    expect(code).toBe(0);
    expect(usageLine).toMatch(new RegExp(`^${usagePrefix(name)}(?: |$)`));
    expect(summaryLine).toBe(summary);
    expect(rest).toStrictEqual([""]);
  });

  it.each([
    ["lint", ["x", "--help"]],
    ["job", ["--job", "search", "--pattern", "-h"]],
  ])("%s with help past the first argument runs the command with it", async (cmd, args) => {
    const main = vi.fn<Main>(() => 0);
    expect(await dispatch([cmd, ...args], registry(main))).toBe(0);
    expect(main).toHaveBeenCalledWith(args);
  });
});

describe("dispatch", () => {
  it.each([
    ["yolo", ["--dry-run", "--host", "grok"]],
    ["shim", ["--check", "--dir", "x"]],
    ["purge-mcps", ["--apply"]],
    ["doctor", []],
    ["setup", ["speak", "--skip-verify"]],
    ["job", ["--job", "exec", "--query", "echo hi", "-y"]],
    ["worktree", ["add", "x"]],
  ])("%s runs in-process with its argv untouched", async (cmd, args) => {
    const main = vi.fn<Main>(() => 3);
    expect(await dispatch([cmd, ...args], registry(main))).toBe(3);
    expect(main).toHaveBeenCalledWith(args);
  });

  it("hook <name> runs the hook with its fixed argv first", async () => {
    const main = vi.fn<Main>(() => 0);
    expect(await dispatch(["hook", "worktree"], registry(main))).toBe(0);
    expect(main).toHaveBeenCalledWith(["hook"]);
    expect(await dispatch(["hook", "gate-fat-tools", "x"], registry(main))).toBe(0);
    expect(main).toHaveBeenLastCalledWith(["x"]);
  });
});

describe("dispatch", () => {
  it.each([
    [
      [],
      "repo hook: name a hook; " +
        "use gate-fat-tools, orchestrate-parent, rtk-grok, scrub-spawn-prompt, session-map or worktree\n",
    ],
    [
      ["nope"],
      'repo hook: unknown hook "nope"; ' +
        "use gate-fat-tools, orchestrate-parent, rtk-grok, scrub-spawn-prompt, session-map or worktree\n",
    ],
  ])("hook %j prints the hook list and exits 1", async (args, message) => {
    const main = vi.fn<Main>(() => 0);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      expect(await dispatch(["hook", ...args], registry(main))).toBe(1);
      expect(err.mock.calls.map((c) => String(c[0])).join("")).toBe(message);
    } finally {
      err.mockRestore();
    }

    expect(main).not.toHaveBeenCalled();
  });
});

describe("dispatch", () => {
  it.each([[[]], [["init"]], [["map", "cli"]], [["help"]], [["toString"]]])(
    "leaves %j to cli/main.ts",
    async (argv) => {
      const main = vi.fn<Main>(() => 0);
      expect(await dispatch(argv, registry(main))).toBeNull();
      expect(main).not.toHaveBeenCalled();
    },
  );

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
