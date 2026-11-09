/** Every script an agent, a hook or a person runs, behind `repo <cmd>` and `repo hook <name>`. */
import { HOOK_USAGE, isHookName, type HookName } from "./scripts/hook-command.ts";

export type Main = (argv: string[]) => number | Promise<number>;

export interface Entry {
  readonly summary: string;
  readonly load: () => Promise<{ readonly main: Main }>;
}

export interface HookEntry extends Entry {
  /** Arguments the hook's `main` gets in front of any the command line adds. */
  readonly argv: readonly string[];
}

export type CommandName =
  | "job"
  | "worktree"
  | "persist"
  | "phase-files"
  | "lessons"
  | "browser"
  | "google-workspace"
  | "jev"
  | "listen"
  | "speak"
  | "setup"
  | "doctor"
  | "clean"
  | "yolo"
  | "purge-mcps"
  | "tasks"
  | "lint"
  | "fmt"
  | "turn"
  | "ci"
  | "coverage"
  | "mutate"
  | "release"
  | "commit-msg";

export const COMMANDS: Readonly<Record<CommandName, Entry>> = {
  job: {
    summary: "Compressed search, exec, slice, fetch and test dumps (--job search|exec|slice|fetch|test)",
    load: () => import("./scripts/job.ts"),
  },
  worktree: {
    summary: "Managed worktrees: add, list, finish, remove",
    load: () => import("./scripts/worktree.ts"),
  },
  persist: {
    summary: "Save a plan, roadmap, handoff, implementation or tmp body from stdin (persist <kind> [--workspace dir])",
    load: () => import("./scripts/persist.ts"),
  },
  "phase-files": {
    summary: "Map a parallel group's unstaged changes to its phases",
    load: () => import("./scripts/phase-files.ts"),
  },
  lessons: {
    summary: "Match, hit and list lessons",
    load: () => import("./scripts/lessons.ts"),
  },
  browser: {
    summary: "Browse with Lightpanda, Chromium when blocked",
    load: () => import("./scripts/browser.ts"),
  },
  "google-workspace": {
    summary: "Google Sheets, Docs, Slides, Calendar and Gmail",
    load: () => import("./scripts/google-workspace.ts"),
  },
  jev: {
    summary: "Yes/no or named-option decision on saved text",
    load: () => import("./scripts/jev.ts"),
  },
  listen: {
    summary: "Speech-to-text from the mic",
    load: () => import("./scripts/listen.ts"),
  },
  speak: {
    summary: "Text-to-speech",
    load: () => import("./scripts/speak.ts"),
  },
  setup: {
    summary: "Handheld keys and OAuth (speak, listen, google-workspace, browser, jev)",
    load: () => import("./scripts/setup.ts"),
  },
  doctor: {
    summary: "Check the tools and versions this repo needs",
    load: () => import("./scripts/doctor.ts"),
  },
  clean: {
    summary: "Remove scratch and stale generated files (--dry-run lists only)",
    load: () => import("./scripts/clean.ts"),
  },
  yolo: {
    summary: "Turn on full-permission mode on every host (--check, --dry-run, --host <id>)",
    load: () => import("./scripts/sync-global-settings.ts"),
  },
  "purge-mcps": {
    summary: "Purge global MCP servers (dry-run; --apply to write)",
    load: () => import("./scripts/purge-global-mcps.ts"),
  },
  tasks: {
    summary: "Write .vscode/tasks.json from package scripts (VS Code and Cursor)",
    load: () => import("./scripts/vscode-tasks.ts"),
  },
  lint: {
    summary:
      "Lint with the standards pack's oxlint config (args go to oxlint; --baseline: lower .repo/lint-baseline.json)",
    load: () => import("./scripts/lint-main.ts").then(({ lintMain }) => ({ main: lintMain })),
  },
  fmt: {
    summary: "Format with the standards pack's oxfmt config (--check: report only; args go to oxfmt)",
    load: () => import("./scripts/lint.ts").then(({ fmt }) => ({ main: fmt })),
  },
  turn: {
    summary: "Gate the changed files: fmt, lint, typecheck, related tests, sync, check (--staged: the index)",
    load: () => import("./scripts/turn.ts"),
  },
  ci: {
    summary: "Run every gate (--report: skipped tests); skips <dir>: tests skipped on every OS; wait: the run for HEAD",
    load: () => import("./scripts/ci.ts"),
  },
  coverage: {
    summary: "run the suite with coverage and raise coverage-floors.json; a drop fails",
    load: () => import("./coverage.ts"),
  },
  mutate: {
    summary:
      "mutation-test the tracked files in a clone of HEAD (--shard i/n, --report <file>); check <dir> [--write]: score reports against mutation-floors.json",
    load: () => import("./mutate.ts"),
  },
  release: {
    summary:
      "Release the root package: bump from commits, stamp CHANGELOG.md, commit, push, wait on CI, tag ([--stable | --pre <id>]); wait <name>@<version>: poll npm",
    load: () => import("./release/main.ts"),
  },
  "commit-msg": {
    summary:
      "Check a commit message file against the staged change (the commit-msg git hook), or each commit of --range <base>..<head>",
    load: () => import("./commit-msg.ts"),
  },
};

export const HOOKS: Readonly<Record<HookName, HookEntry>> = {
  "gate-fat-tools": {
    summary: "Fat-tool gate",
    argv: [],
    load: () => import("./scripts/gate-fat-tools.ts"),
  },
  "orchestrate-parent": {
    summary: "Persist, approval and session gate",
    argv: [],
    load: () => import("./scripts/orchestrate-parent.ts"),
  },
  "rtk-grok": {
    summary: "rtk rewrite for Grok",
    argv: [],
    load: () => import("./scripts/rtk-grok.ts"),
  },
  "scrub-spawn-prompt": {
    summary: "Spawn prompt scrub",
    argv: [],
    load: () => import("./scripts/scrub-spawn-prompt.ts"),
  },
  "session-map": {
    summary: "Session-start folder map",
    argv: [],
    load: () => import("./scripts/session-map.ts"),
  },
  worktree: {
    summary: "Claude Code worktree create and remove",
    argv: ["hook"],
    load: () => import("./scripts/worktree.ts"),
  },
};

export function isCommandName(name: string | undefined): name is CommandName {
  return name !== undefined && Object.hasOwn(COMMANDS, name);
}

/** The tables `dispatch` runs from; tests pass stubs. */
export interface Registry {
  readonly commands: Readonly<Record<CommandName, Entry>>;
  readonly hooks: Readonly<Record<HookName, HookEntry>>;
}

const REGISTRY: Registry = { commands: COMMANDS, hooks: HOOKS };

export async function runCommand(
  name: CommandName,
  args: string[],
  { commands }: Registry = REGISTRY,
): Promise<number> {
  const { main } = await commands[name].load();
  return await main(args);
}

/**
 * Runs `repo hook <name>` or a registry command in-process and returns its exit code, or null when argv names
 * neither and `cli/main.ts` owns it. Registry commands own their flags, so they get the raw argv. The bin calls this
 * before it loads `cli/main.ts`, so a hook pays for its own module only.
 */
export async function dispatch(argv: readonly string[], registry: Registry = REGISTRY): Promise<number | null> {
  const [head, ...rest] = argv;
  if (head === "hook") {
    const [name, ...args] = rest;
    if (!isHookName(name)) {
      const named = name === undefined ? "name a hook" : `unknown hook "${name}"`;
      process.stderr.write(`repo hook: ${named}; ${HOOK_USAGE}\n`);
      return 1;
    }
    const hook = registry.hooks[name];
    const { main } = await hook.load();
    return await main([...hook.argv, ...args]);
  }
  return isCommandName(head) ? await runCommand(head, rest, registry) : null;
}
