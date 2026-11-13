import { HOOKS, runHook } from "./commands-hooks.ts";
import {
  CI_USAGE,
  CLEAN_SUMMARY,
  CLEAN_USAGE,
  COMMIT_MSG_SUMMARY,
  COMMIT_MSG_USAGE,
  COVERAGE_USAGE,
  DOCTOR_USAGE,
  FMT_USAGE,
  HELP_FLAGS,
  JOB_USAGE,
  LINT_USAGE,
  MUTATE_SUMMARY,
  MUTATE_USAGE,
  PERSIST_USAGE,
  PURGE_MCPS_USAGE,
  RELEASE_SUMMARY,
  TASKS_USAGE,
  TURN_USAGE,
  YOLO_USAGE,
} from "./commands.constants.ts";
import type { CommandName, Entry, Registry } from "./commands.types.ts";
import { DOCS_SUMMARY, DOCS_USAGE } from "./docs.constants.ts";
import { FIXTURES_SUMMARY, FIXTURES_USAGE } from "./fixtures.constants.ts";
import { GITHUB_SUMMARY, GITHUB_USAGE } from "./github.constants.ts";
/** Every script an agent, a hook or a person runs, behind `repo <cmd>` and `repo hook <name>`. */
import { HOOK_COMMAND } from "./hook-command.constants.ts";
import { LINK_SUMMARY, UNLINK_SUMMARY, UNLINK_USAGE, USAGE as LINK_USAGE } from "./link.constants.ts";
import { USAGE as RELEASE_USAGE } from "./release/release-messages.constants.ts";
import { REMOVE_SUMMARY, REMOVE_USAGE } from "./remove.constants.ts";
import { BENCH_ARGS, BENCH_SUMMARY } from "./scripts/bench.constants.ts";
import { BROWSER_USAGE } from "./scripts/browser.constants.ts";
import { ENV_SUMMARY, USAGE as ENV_USAGE } from "./scripts/env-command.constants.ts";
import { EVAL_ARGS, EVAL_SUMMARY } from "./scripts/eval.constants.ts";
import { GOOGLE_WORKSPACE_ARGS } from "./scripts/google-workspace.constants.ts";
import { JEV_ARGS } from "./scripts/jev.constants.ts";
import { LESSONS_ARGS } from "./scripts/lessons.constants.ts";
import { LISTEN_ARGS } from "./scripts/listen.constants.ts";
import { PHASE_FILES_USAGE } from "./scripts/phase-files.constants.ts";
import { PUSH_SUMMARY, USAGE as PUSH_USAGE } from "./scripts/push.constants.ts";
import { SETUP_TARGETS } from "./scripts/setup.constants.ts";
import { SHIM_SUMMARY, USAGE as SHIM_USAGE } from "./scripts/shim.constants.ts";
import { SPEAK_ARGS } from "./scripts/speak.constants.ts";
import { WORKTREE_ARGS } from "./scripts/worktree.constants.ts";
import { UPDATE_SUMMARY, USAGE as UPDATE_USAGE } from "./update.constants.ts";

export const COMMANDS: Readonly<Record<CommandName, Entry>> = {
  // Key order is the `repo --help` row order: one blank-line group per section, sorted within, so a reader scans
  // help by what a command is for.
  // Set up and maintain the machine and the checkout.
  clean: { load: () => import("./scripts/clean.ts"), summary: CLEAN_SUMMARY, usage: CLEAN_USAGE },
  doctor: {
    load: () => import("./scripts/doctor.ts"),
    summary: "Check the tools and versions this repo needs",
    usage: DOCTOR_USAGE,
  },
  "purge-mcps": {
    load: () => import("./scripts/purge-global-mcps.ts"),
    summary: "Purge global MCP servers (dry-run; --apply to write)",
    usage: PURGE_MCPS_USAGE,
  },
  setup: {
    load: () => import("./scripts/setup.ts"),
    summary: "Handheld keys and OAuth (speak, listen, google-workspace, browser, jev)",
    usage: `usage: repo setup ${SETUP_TARGETS} [--redo]`,
  },
  shim: { load: () => import("./scripts/shim.ts"), summary: SHIM_SUMMARY, usage: SHIM_USAGE },
  tasks: {
    load: () => import("./scripts/vscode-tasks.ts"),
    summary: "Write .vscode/tasks.json from package scripts (VS Code and Cursor)",
    usage: TASKS_USAGE,
  },
  yolo: {
    load: () => import("./scripts/sync-global-settings.ts"),
    summary: "Turn on full-permission mode on every host (--check, --dry-run, --host <id>)",
    usage: YOLO_USAGE,
  },

  // Tools an agent runs.
  bench: { load: () => import("./scripts/bench.ts"), summary: BENCH_SUMMARY, usage: `usage: repo bench ${BENCH_ARGS}` },
  browser: {
    load: () => import("./scripts/browser.ts"),
    summary: "Browse with Lightpanda, Chromium when blocked",
    usage: BROWSER_USAGE,
  },
  env: { load: () => import("./scripts/env-command.ts"), summary: ENV_SUMMARY, usage: ENV_USAGE },
  eval: { load: () => import("./scripts/eval.ts"), summary: EVAL_SUMMARY, usage: `usage: repo eval ${EVAL_ARGS}` },
  "google-workspace": {
    load: () => import("./scripts/google-workspace.ts"),
    summary: "Google Sheets, Docs, Slides, Calendar and Gmail",
    usage: `usage: repo google-workspace ${GOOGLE_WORKSPACE_ARGS}`,
  },
  jev: {
    load: () => import("./scripts/jev.ts"),
    summary: "Yes/no or named-option decision on saved text",
    usage: `usage: repo jev ${JEV_ARGS}`,
  },
  job: {
    load: () => import("./scripts/job.ts"),
    summary: "Compressed search, exec, slice, fetch and test dumps (--job search|exec|slice|fetch|test)",
    usage: JOB_USAGE,
  },
  lessons: {
    load: () => import("./scripts/lessons.ts"),
    summary: "Match, hit and list lessons",
    usage: `usage: repo lessons ${LESSONS_ARGS}`,
  },
  listen: {
    load: () => import("./scripts/listen.ts"),
    summary: "Speech-to-text from the mic",
    usage: `usage: repo listen ${LISTEN_ARGS}`,
  },
  persist: {
    load: () => import("./scripts/persist.ts"),
    summary: "Save a plan, roadmap, handoff, implementation or tmp body from stdin (persist <kind> [--workspace dir])",
    usage: PERSIST_USAGE,
  },
  "phase-files": {
    load: () => import("./scripts/phase-files.ts"),
    summary: "Map a parallel group's unstaged changes to its phases",
    usage: PHASE_FILES_USAGE,
  },
  speak: {
    load: () => import("./scripts/speak.ts"),
    summary: "Text-to-speech",
    usage: `usage: repo speak ${SPEAK_ARGS}`,
  },
  worktree: {
    load: () => import("./scripts/worktree.ts"),
    summary: "Managed worktrees: add, list, finish, remove",
    usage: `usage: repo worktree ${WORKTREE_ARGS}`,
  },

  // Gates on the code.
  ci: {
    load: () => import("./scripts/ci.ts"),
    summary: "Run every gate (--report: skipped tests); skips <dir>: tests skipped on every OS; wait: the run for HEAD",
    usage: CI_USAGE,
  },
  "commit-msg": { load: () => import("./commit-msg.ts"), summary: COMMIT_MSG_SUMMARY, usage: COMMIT_MSG_USAGE },
  coverage: {
    load: () => import("./coverage.ts"),
    summary: "run the suite with coverage and raise coverage-floors.json; a drop fails",
    usage: COVERAGE_USAGE,
  },
  docs: { load: () => import("./docs.ts"), summary: DOCS_SUMMARY, usage: DOCS_USAGE },
  fixtures: { load: () => import("./fixtures-rename.ts"), summary: FIXTURES_SUMMARY, usage: FIXTURES_USAGE },
  fmt: {
    load: () => import("./scripts/lint.ts").then(({ fmt }) => ({ main: fmt })),
    summary: "Format with the standards pack's oxfmt config (--check: report only; args go to bun fmt)",
    usage: FMT_USAGE,
  },
  lint: {
    load: () => import("./scripts/lint-main.ts").then(({ lintMain }) => ({ main: lintMain })),
    summary:
      "Lint with the standards pack's oxlint config (args go to oxlint; --baseline: lower .repo/lint-baseline.json)",
    usage: LINT_USAGE,
  },
  mutate: { load: () => import("./mutate.ts"), summary: MUTATE_SUMMARY, usage: MUTATE_USAGE },
  turn: {
    load: () => import("./scripts/turn.ts"),
    summary: "Gate the changed files: fmt, lint, typecheck, related tests, sync, check (--staged: the index)",
    usage: TURN_USAGE,
  },

  // Dependencies, the GitHub repository and releases.
  github: { load: () => import("./github-apply.ts"), summary: GITHUB_SUMMARY, usage: GITHUB_USAGE },
  link: { load: () => import("./link.ts"), summary: LINK_SUMMARY, usage: LINK_USAGE },
  push: { load: () => import("./scripts/push.ts"), summary: PUSH_SUMMARY, usage: PUSH_USAGE },
  release: {
    load: () => import("./release/main.ts"),
    summary: RELEASE_SUMMARY,
    usage: RELEASE_USAGE,
  },
  remove: { load: () => import("./remove.ts"), summary: REMOVE_SUMMARY, usage: REMOVE_USAGE },
  unlink: {
    load: () => import("./link.ts").then(({ unlinkMain }) => ({ main: unlinkMain })),
    summary: UNLINK_SUMMARY,
    usage: UNLINK_USAGE,
  },
  update: { load: () => import("./update.ts"), summary: UPDATE_SUMMARY, usage: UPDATE_USAGE },
};

export function isCommandName(name: string | undefined): name is CommandName {
  return name !== undefined && Object.hasOwn(COMMANDS, name);
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

/** Whether `arg` asks for help; only the first argument after the command counts, as later ones may be a tool's. */
function isHelpFlag(arg: string | undefined): boolean {
  return arg !== undefined && HELP_FLAGS.has(arg);
}

/** `repo <cmd> --help`: the command's usage line and summary, without loading it. */
function help({ usage, summary }: Entry): number {
  process.stdout.write(`${usage}\n${summary}\n`);

  return 0;
}

/**
 * Runs `repo hook <name>` or a registry command in-process and returns its exit code, or null when argv names
 * neither and `cli/main.ts` owns it. Registry commands own their flags, so they get the raw argv, but for `--help` or
 * `-h` right after the command, which prints the command's usage instead of running it. The bin calls this
 * before it loads `cli/main.ts`, so a hook pays for its own module only.
 */
export async function dispatch(argv: readonly string[], registry: Registry = REGISTRY): Promise<number | null> {
  const [head, ...rest] = argv;

  if (head === HOOK_COMMAND) return await runHook(rest, registry.hooks);

  if (!isCommandName(head)) return null;

  return isHelpFlag(rest[0]) ? help(registry.commands[head]) : await runCommand(head, rest, registry);
}
