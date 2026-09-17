import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { destAlreadyInited, init, RESERVED_SKILLS, shouldAutoSkipGlobals, toGruntScriptName } from "./init.mjs"
import { confirm, isInteractive, select, spinner } from "./prompt.mjs"

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

const USAGE = `Usage: grunt [command]

Default (no command): TTY menu; else init — full setup

Commands:
  init          Full setup: merge SoT, npm install, grunt:rulesync:generate, grunt:sync:globals:apply, grunt:rulesync:check
  generate      npm run grunt:rulesync:generate
  check         npm run grunt:rulesync:check
  sync-globals  npm run grunt:sync:globals (dry-run; --apply to write)
  purge-mcps    npm run grunt:purge:global-mcps (dry-run; --apply to write)
  doctor        npm run grunt:doctor
  setup         npm run grunt:setup — handheld keys/OAuth (speak, listen, google-workspace, browser)
  upgrade       Re-init: copy owned files, prune retired grunt-owned names, print reserved skills
  help          Show this help
  version       Print package version

Flags:
  --skip-globals     Skip sync:globals:apply (auto-skipped when already initialized)
  --yes, -y          Non-interactive (not --apply)
  --non-interactive  Same as --yes
  --apply            Write for sync-globals / purge-mcps
  --host <id>        sync-globals host
`

const MENU_OPTIONS = [
  { value: "init", label: "init" },
  { value: "generate", label: "generate" },
  { value: "check", label: "check" },
  { value: "sync-globals", label: "sync-globals" },
  { value: "purge-mcps", label: "purge-mcps" },
  { value: "doctor", label: "doctor" },
  { value: "setup", label: "setup" },
  { value: "upgrade", label: "upgrade" },
  { value: "help", label: "help" },
  { value: "quit", label: "quit" },
]

const YES_FLAGS = new Set(["--yes", "-y", "--non-interactive"])

function pkgVersion() {
  const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"))
  return pkg.version
}

function npmRun(script, extra = []) {
  const args = extra.length ? ["run", script, "--", ...extra] : ["run", script]
  execFileSync("npm", args, { cwd: process.cwd(), stdio: "inherit" })
}

function hostValueOk(v) {
  return v != null && v !== "" && !String(v).startsWith("-")
}

export function parseArgv(argv) {
  let skipGlobals = false
  let apply = false
  let host
  let hostError = false
  const positionals = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--skip-globals") {
      skipGlobals = true
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
    positionals.push(a)
  }
  return { cmd: positionals[0], args: positionals.slice(1), skipGlobals, apply, host, hostError }
}

function hostExtra(host) {
  return host ? ["--host", host] : []
}

function bindSpinner() {
  const spin = spinner()
  return (name, action) => {
    if (action === "start") spin.start(name)
    else if (action === "stop") spin.stop()
  }
}

export const APPLY_GLOBALS_CONFIRM = "Apply global prompt optimizations? (recommended)"

async function runInit(cwd, { skipGlobals, interactive }) {
  if (!interactive) {
    init(cwd, { skipGlobals })
    return
  }
  if (destAlreadyInited(cwd)) {
    const again = await confirm({
      message: "Re-init?",
      initialValue: true,
    })
    if (!again) return
  }
  const autoSkip = skipGlobals || shouldAutoSkipGlobals(cwd)
  const applyGlobals = await confirm({
    message: APPLY_GLOBALS_CONFIRM,
    initialValue: !autoSkip,
  })
  init(cwd, {
    skipGlobals: !applyGlobals,
    applyGlobals,
    onPhase: bindSpinner(),
  })
}

async function dispatch(cmd, flags, interactive) {
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
    })
    return
  }
  if (cmd === "generate") {
    npmRun(toGruntScriptName("rulesync:generate"))
    return
  }
  if (cmd === "check") {
    npmRun(toGruntScriptName("rulesync:check"))
    return
  }
  if (cmd === "sync-globals") {
    const script = flags.apply ? toGruntScriptName("sync:globals:apply") : toGruntScriptName("sync:globals")
    npmRun(script, hostExtra(flags.host))
    return
  }
  if (cmd === "purge-mcps") {
    npmRun(flags.apply ? toGruntScriptName("purge:global-mcps:apply") : toGruntScriptName("purge:global-mcps"))
    return
  }
  if (cmd === "doctor") {
    npmRun(toGruntScriptName("doctor"))
    return
  }
  if (cmd === "setup") {
    npmRun(toGruntScriptName("setup"), flags.args)
    return
  }
  if (cmd === "upgrade") {
    await runInit(process.cwd(), {
      skipGlobals: flags.skipGlobals,
      interactive: false,
    })
    process.stdout.write(`reserved: ${RESERVED_SKILLS.join(" ")}\n`)
    return
  }
  process.stdout.write(USAGE)
  process.exitCode = 1
}

export async function start() {
  const flags = parseArgv(process.argv.slice(2))
  if (flags.hostError) {
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
