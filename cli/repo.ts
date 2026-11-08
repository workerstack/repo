import { execFileSync } from "./spawn.ts"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { destAlreadyInited, init, RESERVED_SKILLS, toScriptName, type InitOptions } from "./init.ts"
import { confirm, isInteractive, multiselect, select, spinner } from "./prompt.ts"
import { selfUpdate } from "./self-update.ts"
import { runSync } from "./sync.ts"
import { mapCommand } from "../.rulesync/scripts/folder-map.ts"
import { PACK_OPTIONS, parsePacksFlag, selectedPacks } from "../.rulesync/scripts/feature-packs.ts"

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

const USAGE = `Usage: repo [command]

Default (no command): TTY menu; else init — full setup

Commands:
  init          Full setup: merge SoT, install, repo:rulesync:generate, repo:sync:globals:apply, repo:rulesync:check
  generate      run repo:rulesync:generate
  check         repo:rulesync:check, then every tsconfig extends a base and keeps ts-reset
  sync          Write the committed generated files from workerstack.config.ts (--check: report drift; --postinstall: never fail)
  sync-globals  run repo:sync:globals (dry-run; --apply to write)
  purge-mcps    run repo:purge:global-mcps (dry-run; --apply to write)
  doctor        run repo:doctor
  clean         run repo:clean (--dry-run lists only)
  setup         run repo:setup — handheld keys/OAuth (speak, listen, google-workspace, browser, jev)
  tasks         Write .vscode/tasks.json from package scripts (VS Code and Cursor)
  upgrade       Self-update to the latest repo, then re-init: copy owned files, prune dropped skills, print reserved skills
  map [dir]     Code-only folder map (git-tracked, no files); dir for depth
  help          Show this help
  version       Print package version

Flags:
  --skip-globals     Skip sync:globals:apply (otherwise init and upgrade always apply it)
  --no-self-update   upgrade: keep the installed repo version
  --yes, -y          Non-interactive (not --apply)
  --non-interactive  Same as --yes
  --apply            Write for sync-globals / purge-mcps
  --host <id>        sync-globals host
  --packs <list>     Optional packs: google-workspace,listen,speak,clasp or none
`

const MENU_OPTIONS = [
  { value: "init", label: "init" },
  { value: "generate", label: "generate" },
  { value: "check", label: "check" },
  { value: "sync-globals", label: "sync-globals" },
  { value: "purge-mcps", label: "purge-mcps" },
  { value: "doctor", label: "doctor" },
  { value: "clean", label: "clean" },
  { value: "setup", label: "setup" },
  { value: "tasks", label: "tasks" },
  { value: "upgrade", label: "upgrade" },
  { value: "help", label: "help" },
  { value: "quit", label: "quit" },
]

const YES_FLAGS = new Set(["--yes", "-y", "--non-interactive"])

function pkgVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"))
  if (typeof pkg !== "object" || pkg === null || !("version" in pkg) || typeof pkg.version !== "string") {
    throw new Error("package.json has no version")
  }
  return pkg.version
}

function runScript(script: string, extra: string[] = []) {
  execFileSync("bun", ["run", script, ...extra], { cwd: process.cwd(), stdio: "inherit" })
}

function hostValueOk(v: unknown) {
  return v != null && v !== "" && !String(v).startsWith("-")
}

/** The command line, split into the command, its arguments and the flags this CLI knows. */
export interface Flags {
  cmd: string | undefined
  args: string[]
  skipGlobals: boolean
  noSelfUpdate: boolean
  apply: boolean
  host: string | undefined
  hostError: boolean
  packs: string[] | undefined
  packsError: boolean
}

export function parseArgv(argv: string[]): Flags {
  let skipGlobals = false
  let noSelfUpdate = false
  let apply = false
  let host: string | undefined
  let hostError = false
  let packs: string[] | undefined
  let packsError = false
  const positionals: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]! // i < argv.length
    if (a === "--skip-globals") {
      skipGlobals = true
      continue
    }
    if (a === "--no-self-update") {
      noSelfUpdate = true
      continue
    }
    if (YES_FLAGS.has(a)) continue
    if (a === "--apply") {
      apply = true
      continue
    }
    if (a === "--host") {
      const v = argv[i + 1]
      if (!hostValueOk(v)) {
        hostError = true
        continue
      }
      host = v
      i += 1
      continue
    }
    if (typeof a === "string" && a.startsWith("--host=")) {
      host = a.slice("--host=".length)
      if (!hostValueOk(host)) hostError = true
      continue
    }
    if (a === "--packs") {
      const v = argv[i + 1]
      if (v == null || String(v).startsWith("--")) {
        packsError = true
        continue
      }
      try {
        packs = parsePacksFlag(v)
      } catch {
        packsError = true
      }
      i += 1
      continue
    }
    if (typeof a === "string" && a.startsWith("--packs=")) {
      try {
        packs = parsePacksFlag(a.slice("--packs=".length))
      } catch {
        packsError = true
      }
      continue
    }
    positionals.push(a)
  }
  return {
    cmd: positionals[0],
    args: positionals.slice(1),
    skipGlobals,
    noSelfUpdate,
    apply,
    host,
    hostError,
    packs,
    packsError,
  }
}

function hostExtra(host: string | undefined) {
  return host ? ["--host", host] : []
}

function bindSpinner() {
  const spin = spinner()
  return (name: string, action: "start" | "stop") => {
    if (action === "start") spin.start(name)
    else if (action === "stop") spin.stop(name)
  }
}

export const APPLY_GLOBALS_CONFIRM = "Apply global prompt optimizations? (recommended)"

async function askPacks(cwd: string) {
  return await multiselect({
    message: "Optional packs",
    options: PACK_OPTIONS,
    initialValues: selectedPacks(cwd),
    required: false,
  })
}

function initOpts(base: InitOptions, packs: string[] | undefined): InitOptions {
  if (packs === undefined) return base
  return { ...base, packs }
}

interface RunInitOptions {
  skipGlobals: boolean
  interactive: boolean
  packs: string[] | undefined
  packsOnly?: boolean
}

async function runInit(cwd: string, { skipGlobals, interactive, packs, packsOnly = false }: RunInitOptions) {
  let selected = packs
  if (packsOnly) {
    if (selected === undefined && interactive) selected = await askPacks(cwd)
    init(cwd, initOpts({ skipGlobals }, selected))
    return
  }
  if (!interactive) {
    init(cwd, initOpts({ skipGlobals }, selected))
    return
  }
  if (destAlreadyInited(cwd)) {
    const again = await confirm({
      message: "Re-init?",
      initialValue: true,
    })
    if (!again) return
  }
  if (selected === undefined) selected = await askPacks(cwd)
  const applyGlobals = await confirm({
    message: APPLY_GLOBALS_CONFIRM,
    initialValue: !skipGlobals,
  })
  init(cwd, initOpts({
    skipGlobals: !applyGlobals,
    onPhase: bindSpinner(),
  }, selected))
}

async function dispatch(cmd: string | undefined, flags: Flags, interactive: boolean) {
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(USAGE)
    return
  }
  if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    process.stdout.write(`${pkgVersion()}\n`)
    return
  }
  if (!cmd || cmd === "init") {
    await runInit(process.cwd(), {
      skipGlobals: flags.skipGlobals,
      interactive: interactive && (!cmd || cmd === "init"),
      packs: flags.packs,
    })
    return
  }
  if (cmd === "generate") {
    runScript(toScriptName("rulesync:generate"))
    return
  }
  if (cmd === "check") {
    // Loaded here so other commands never load typescript.
    const { checkTsconfigs } = await import("./check-tsconfig.ts")
    const problems = checkTsconfigs(process.cwd(), PKG_ROOT)
    for (const line of problems) process.stderr.write(`${line}\n`)
    runScript(toScriptName("rulesync:check"))
    if (problems.length > 0) process.exitCode = 1
    return
  }
  if (cmd === "sync") {
    process.exitCode = await runSync(flags.args, {
      cwd: process.cwd(),
      stdout: (s: string) => process.stdout.write(s),
      stderr: (s: string) => process.stderr.write(s),
    })
    return
  }
  if (cmd === "sync-globals") {
    const script = flags.apply ? toScriptName("sync:globals:apply") : toScriptName("sync:globals")
    runScript(script, hostExtra(flags.host))
    return
  }
  if (cmd === "purge-mcps") {
    runScript(flags.apply ? toScriptName("purge:global-mcps:apply") : toScriptName("purge:global-mcps"))
    return
  }
  if (cmd === "doctor") {
    runScript(toScriptName("doctor"))
    return
  }
  if (cmd === "clean") {
    runScript(toScriptName("clean"), flags.args)
    return
  }
  if (cmd === "setup") {
    runScript(toScriptName("setup"), flags.args)
    return
  }
  if (cmd === "tasks") {
    runScript(toScriptName("tasks"))
    return
  }
  if (cmd === "map") {
    process.stdout.write(mapCommand(process.cwd(), flags.args[0] || ""))
    return
  }
  if (cmd === "upgrade") {
    if (!flags.noSelfUpdate) {
      const updated = await selfUpdate({
        cwd: process.cwd(),
        pkgRoot: PKG_ROOT,
        currentVersion: pkgVersion(),
        argv: process.argv.slice(2),
      })
      if (updated.reexeced) {
        process.exitCode = updated.status
        return
      }
    }
    await runInit(process.cwd(), {
      skipGlobals: flags.skipGlobals,
      interactive,
      packsOnly: true,
      packs: flags.packs,
    })
    process.stdout.write(`reserved: ${RESERVED_SKILLS.join(" ")}\n`)
    return
  }
  process.stdout.write(USAGE)
  process.exitCode = 1
}

export async function start() {
  const flags = parseArgv(process.argv.slice(2))
  if (flags.hostError || flags.packsError) {
    process.stdout.write(USAGE)
    process.exitCode = 1
    return
  }
  const interactive = isInteractive()
  let cmd = flags.cmd
  if (!cmd && interactive) {
    const choice = await select({
      message: "Command",
      options: MENU_OPTIONS,
      initialValue: "init",
    })
    if (choice === "quit") return
    cmd = choice
  }
  await dispatch(cmd, flags, interactive)
}
