/** Every script an agent, a hook or a person runs, behind `repo <cmd>` and `repo hook <name>`. */
import { HOOK_USAGE, isHookName, type HookName } from "../.rulesync/scripts/hook-command.ts"

export type Main = (argv: string[]) => number | Promise<number>

export interface Entry {
  readonly summary: string
  readonly load: () => Promise<{ readonly main: Main }>
}

export interface HookEntry extends Entry {
  /** Arguments the hook's `main` gets in front of any the command line adds. */
  readonly argv: readonly string[]
}

export const COMMANDS = {
  job: {
    summary: "Compressed search, exec, slice, fetch and test dumps (--job search|exec|slice|fetch|test)",
    load: () => import("../.rulesync/scripts/job.ts"),
  },
  worktree: {
    summary: "Managed worktrees: add, list, finish, remove",
    load: () => import("../.rulesync/scripts/worktree.ts"),
  },
  "phase-files": {
    summary: "Map a parallel group's unstaged changes to its phases",
    load: () => import("../.rulesync/scripts/phase-files.ts"),
  },
  lessons: {
    summary: "Match, hit and list lessons",
    load: () => import("../.rulesync/scripts/lessons.ts"),
  },
  browser: {
    summary: "Browse with Lightpanda, Chromium when blocked",
    load: () => import("../.rulesync/scripts/browser.ts"),
  },
  "google-workspace": {
    summary: "Google Sheets, Docs, Slides, Calendar and Gmail",
    load: () => import("../.rulesync/scripts/google-workspace.ts"),
  },
  jev: {
    summary: "Yes/no or named-option decision on saved text",
    load: () => import("../.rulesync/scripts/jev.ts"),
  },
  listen: {
    summary: "Speech-to-text from the mic",
    load: () => import("../.rulesync/scripts/listen.ts"),
  },
  speak: {
    summary: "Text-to-speech",
    load: () => import("../.rulesync/scripts/speak.ts"),
  },
  setup: {
    summary: "Handheld keys and OAuth (speak, listen, google-workspace, browser, jev)",
    load: () => import("../.rulesync/scripts/setup.ts"),
  },
  doctor: {
    summary: "Check the tools and versions this repo needs",
    load: () => import("../.rulesync/scripts/doctor.ts"),
  },
  clean: {
    summary: "Remove scratch and stale generated files (--dry-run lists only)",
    load: () => import("../.rulesync/scripts/clean.ts"),
  },
  yolo: {
    summary: "Turn on full-permission mode on every host (--check, --dry-run, --host <id>)",
    load: () => import("../.rulesync/scripts/sync-global-settings.ts"),
  },
  "purge-mcps": {
    summary: "Purge global MCP servers (dry-run; --apply to write)",
    load: () => import("../.rulesync/scripts/purge-global-mcps.ts"),
  },
  tasks: {
    summary: "Write .vscode/tasks.json from package scripts (VS Code and Cursor)",
    load: () => import("../.rulesync/scripts/vscode-tasks.ts"),
  },
} as const satisfies Record<string, Entry>

export const HOOKS = {
  "gate-fat-tools": {
    summary: "Fat-tool gate",
    argv: [],
    load: () => import("../.rulesync/scripts/gate-fat-tools.ts"),
  },
  "orchestrate-parent": {
    summary: "Persist, approval and session gate",
    argv: [],
    load: () => import("../.grok/hooks/orchestrate-parent.ts"),
  },
  "rtk-grok": {
    summary: "rtk rewrite for Grok",
    argv: [],
    load: () => import("../.grok/hooks/rtk-grok.ts"),
  },
  "scrub-spawn-prompt": {
    summary: "Spawn prompt scrub",
    argv: [],
    load: () => import("../.rulesync/scripts/scrub-spawn-prompt.ts"),
  },
  "session-map": {
    summary: "Session-start folder map",
    argv: [],
    load: () => import("../.rulesync/scripts/session-map.ts"),
  },
  worktree: {
    summary: "Claude Code worktree create and remove",
    argv: ["hook"],
    load: () => import("../.rulesync/scripts/worktree.ts"),
  },
} as const satisfies Record<HookName, HookEntry>

export type CommandName = keyof typeof COMMANDS

export function isCommandName(name: string | undefined): name is CommandName {
  return name !== undefined && Object.hasOwn(COMMANDS, name)
}

/** The tables `dispatch` runs from; tests pass stubs. */
export interface Registry {
  readonly commands: Readonly<Record<CommandName, Entry>>
  readonly hooks: Readonly<Record<HookName, HookEntry>>
}

const REGISTRY: Registry = { commands: COMMANDS, hooks: HOOKS }

export async function runCommand(name: CommandName, args: string[], { commands }: Registry = REGISTRY): Promise<number> {
  const { main } = await commands[name].load()
  return await main(args)
}

/**
 * Runs `repo hook <name>` or a registry command in-process and returns its exit code, or null when argv names
 * neither and `cli/main.ts` owns it. Registry commands own their flags, so they get the raw argv. The bin calls this
 * before it loads `cli/main.ts`, so a hook pays for its own module only.
 */
export async function dispatch(argv: readonly string[], registry: Registry = REGISTRY): Promise<number | null> {
  const [head, ...rest] = argv
  if (head === "hook") {
    const [name, ...args] = rest
    if (!isHookName(name)) {
      const named = name === undefined ? "name a hook" : `unknown hook "${name}"`
      process.stderr.write(`repo hook: ${named}; ${HOOK_USAGE}\n`)
      return 1
    }
    const hook = registry.hooks[name]
    const { main } = await hook.load()
    return await main([...hook.argv, ...args])
  }
  return isCommandName(head) ? await runCommand(head, rest, registry) : null
}
