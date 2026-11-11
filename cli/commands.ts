import { DOCS_SUMMARY } from "./docs.constants.ts";
import { GITHUB_SUMMARY } from "./github.constants.ts";
/** Every script an agent, a hook or a person runs, behind `repo <cmd>` and `repo hook <name>`. */
import { HOOK_COMMAND } from "./hook-command.constants.ts";
import { LINK_SUMMARY, UNLINK_SUMMARY } from "./link.constants.ts";
import { REMOVE_SUMMARY } from "./remove.constants.ts";
import { HOOK_USAGE, isHookName, type HookName } from "./scripts/hook-command.ts";
import { UPDATE_SUMMARY } from "./update.constants.ts";

export type Main = (argv: string[]) => number | Promise<number>;

export type Entry = { readonly summary: string; readonly load: () => Promise<{ readonly main: Main }> };

export type HookEntry = {
  /** Arguments the hook's `main` gets in front of any the command line adds. */
  readonly argv: readonly string[];
} & Entry;

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
  | "commit-msg"
  | "github"
  | "link"
  | "unlink"
  | "update"
  | "remove"
  | "docs";

export const COMMANDS: Readonly<Record<CommandName, Entry>> = {
  // Key order is the `repo --help` row order: one blank-line group per section, sorted within, so a reader scans
  // help by what a command is for.
  // Set up and maintain the machine and the checkout.
  clean: {
    load: () => import("./scripts/clean.ts"),
    summary:
      "Remove scratch and stale generated files (--build: ignored build dirs; --deps: and node_modules; --dry-run lists only)",
  },
  doctor: {
    load: () => import("./scripts/doctor.ts"),
    summary: "Check the tools and versions this repo needs",
  },
  "purge-mcps": {
    load: () => import("./scripts/purge-global-mcps.ts"),
    summary: "Purge global MCP servers (dry-run; --apply to write)",
  },
  setup: {
    load: () => import("./scripts/setup.ts"),
    summary: "Handheld keys and OAuth (speak, listen, google-workspace, browser, jev)",
  },
  tasks: {
    load: () => import("./scripts/vscode-tasks.ts"),
    summary: "Write .vscode/tasks.json from package scripts (VS Code and Cursor)",
  },
  yolo: {
    load: () => import("./scripts/sync-global-settings.ts"),
    summary: "Turn on full-permission mode on every host (--check, --dry-run, --host <id>)",
  },

  // Tools an agent runs.
  browser: { load: () => import("./scripts/browser.ts"), summary: "Browse with Lightpanda, Chromium when blocked" },
  "google-workspace": {
    load: () => import("./scripts/google-workspace.ts"),
    summary: "Google Sheets, Docs, Slides, Calendar and Gmail",
  },
  jev: { load: () => import("./scripts/jev.ts"), summary: "Yes/no or named-option decision on saved text" },
  job: {
    load: () => import("./scripts/job.ts"),
    summary: "Compressed search, exec, slice, fetch and test dumps (--job search|exec|slice|fetch|test)",
  },
  lessons: { load: () => import("./scripts/lessons.ts"), summary: "Match, hit and list lessons" },
  listen: { load: () => import("./scripts/listen.ts"), summary: "Speech-to-text from the mic" },
  persist: {
    load: () => import("./scripts/persist.ts"),
    summary: "Save a plan, roadmap, handoff, implementation or tmp body from stdin (persist <kind> [--workspace dir])",
  },
  "phase-files": {
    load: () => import("./scripts/phase-files.ts"),
    summary: "Map a parallel group's unstaged changes to its phases",
  },
  speak: { load: () => import("./scripts/speak.ts"), summary: "Text-to-speech" },
  worktree: {
    load: () => import("./scripts/worktree.ts"),
    summary: "Managed worktrees: add, list, finish, remove",
  },

  // Gates on the code.
  ci: {
    load: () => import("./scripts/ci.ts"),
    summary: "Run every gate (--report: skipped tests); skips <dir>: tests skipped on every OS; wait: the run for HEAD",
  },
  "commit-msg": {
    load: () => import("./commit-msg.ts"),
    summary:
      "Check a commit message file against the staged change (the commit-msg git hook), or each commit of --range <base>..<head>",
  },
  coverage: {
    load: () => import("./coverage.ts"),
    summary: "run the suite with coverage and raise coverage-floors.json; a drop fails",
  },
  docs: { load: () => import("./docs.ts"), summary: DOCS_SUMMARY },
  fmt: {
    load: () => import("./scripts/lint.ts").then(({ fmt }) => ({ main: fmt })),
    summary: "Format with the standards pack's oxfmt config (--check: report only; args go to oxfmt)",
  },
  lint: {
    load: () => import("./scripts/lint-main.ts").then(({ lintMain }) => ({ main: lintMain })),
    summary:
      "Lint with the standards pack's oxlint config (args go to oxlint; --baseline: lower .repo/lint-baseline.json)",
  },
  mutate: {
    load: () => import("./mutate.ts"),
    summary:
      "mutation-test the tracked files in a clone of HEAD (--shard i/n, --report <file>); check <dir> [--write]: score reports against mutation-floors.json",
  },
  turn: {
    load: () => import("./scripts/turn.ts"),
    summary: "Gate the changed files: fmt, lint, typecheck, related tests, sync, check (--staged: the index)",
  },

  // Dependencies, the GitHub repository and releases.
  github: { load: () => import("./github-apply.ts"), summary: GITHUB_SUMMARY },
  link: { load: () => import("./link.ts"), summary: LINK_SUMMARY },
  release: {
    load: () => import("./release/main.ts"),
    summary:
      "Release the root package: bump from commits, stamp CHANGELOG.md, commit, push, wait on CI, tag ([--stable | --pre <id>]); wait <name>@<version>: poll npm",
  },
  remove: { load: () => import("./remove.ts"), summary: REMOVE_SUMMARY },
  unlink: { load: () => import("./link.ts").then(({ unlinkMain }) => ({ main: unlinkMain })), summary: UNLINK_SUMMARY },
  update: { load: () => import("./update.ts"), summary: UPDATE_SUMMARY },
};

export const HOOKS: Readonly<Record<HookName, HookEntry>> = {
  "gate-fat-tools": {
    argv: [],
    load: () => import("./scripts/gate-fat-tools.ts"),
    summary: "Fat-tool gate",
  },
  "orchestrate-parent": {
    argv: [],
    load: () => import("./scripts/orchestrate-parent.ts"),
    summary: "Persist, approval and session gate",
  },
  "rtk-grok": {
    argv: [],
    load: () => import("./scripts/rtk-grok.ts"),
    summary: "rtk rewrite for Grok",
  },
  "scrub-spawn-prompt": {
    argv: [],
    load: () => import("./scripts/scrub-spawn-prompt.ts"),
    summary: "Spawn prompt scrub",
  },
  "session-map": {
    argv: [],
    load: () => import("./scripts/session-map.ts"),
    summary: "Session-start folder map",
  },
  worktree: {
    argv: ["hook"],
    load: () => import("./scripts/worktree.ts"),
    summary: "Claude Code worktree create and remove",
  },
};

export function isCommandName(name: string | undefined): name is CommandName {
  return name !== undefined && Object.hasOwn(COMMANDS, name);
}

/** The tables `dispatch` runs from; tests pass stubs. */
export type Registry = {
  readonly commands: Readonly<Record<CommandName, Entry>>;
  readonly hooks: Readonly<Record<HookName, HookEntry>>;
};

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
  if (head === HOOK_COMMAND) {
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
