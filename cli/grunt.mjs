import { execFileSync } from "./spawn.mjs"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { destAlreadyInited, init, RESERVED_SKILLS, toGruntScriptName } from "./init.mjs"
import { confirm, isInteractive, multiselect, select, spinner } from "./prompt.mjs"
import { selfUpdate } from "./self-update.mjs"
import {
  PACKAGE_MANAGER_ASK,
  PACKAGE_MANAGER_OPTIONS,
  UNKNOWN_PACKAGE_MANAGER,
  detectPackageManager,
  isPackageManager,
  runScriptArgs,
} from "../scripts/package-manager.mjs"
import { mapCommand } from "../scripts/folder-map.mjs"
import { PACK_OPTIONS, parsePacksFlag, selectedPacks } from "../scripts/feature-packs.mjs"

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

const USAGE = `Usage: grunt [command]

Default (no command): TTY menu; else init — full setup

Commands:
  init          Full setup: merge SoT, install, grunt:rulesync:generate, grunt:sync:globals:apply, grunt:rulesync:check
  generate      run grunt:rulesync:generate
  check         run grunt:rulesync:check
  sync-globals  run grunt:sync:globals (dry-run; --apply to write)
  purge-mcps    run grunt:purge:global-mcps (dry-run; --apply to write)
  doctor        run grunt:doctor
  setup         run grunt:setup — handheld keys/OAuth (speak, listen, google-workspace, browser, jev)
  upgrade       Self-update to the latest grunt, then re-init: copy owned files, prune retired names, print reserved skills
  map [dir]     Code-only folder map (git-tracked, no files); dir for depth
  help          Show this help
  version       Print package version

Flags:
  --skip-globals     Skip sync:globals:apply (auto-skipped when already initialized)
  --no-self-update   upgrade: keep the installed grunt version
  --yes, -y          Non-interactive (not --apply)
  --non-interactive  Same as --yes
  --apply            Write for sync-globals / purge-mcps
  --host <id>        sync-globals host
  --pm <name>        npm | yarn | pnpm | bun (else lockfile, then how grunt was launched, then ask)
  --packs <list>     Optional packs: google-workspace,listen,speak,clasp or none
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
const NEEDS_PM = new Set([
  "init",
  "generate",
  "check",
  "sync-globals",
  "purge-mcps",
  "doctor",
  "setup",
  "upgrade",
])

function pkgVersion() {
  const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"))
  return pkg.version
}

function runScript(pm, script, extra = []) {
  execFileSync(pm, runScriptArgs(pm, script, extra), { cwd: process.cwd(), stdio: "inherit" })
}

function hostValueOk(v) {
  return v != null && v !== "" && !String(v).startsWith("-")
}

function pmValueOk(v) {
  return v != null && v !== "" && isPackageManager(v)
}

export function parseArgv(argv) {
  let skipGlobals = false
  let noSelfUpdate = false
  let apply = false
  let host
  let hostError = false
  let pm
  let pmError = false
  let packs
  let packsError = false
  const positionals = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
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
    if (a === "--pm") {
      const v = argv[i + 1]
      if (!pmValueOk(v)) {
        pmError = true
        continue
      }
      pm = String(v).toLowerCase()
      i += 1
      continue
    }
    if (typeof a === "string" && a.startsWith("--pm=")) {
      pm = a.slice("--pm=".length)
      if (!pmValueOk(pm)) pmError = true
      else pm = pm.toLowerCase()
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
    pm,
    pmError,
    packs,
    packsError,
  }
}

function hostExtra(host) {
  return host ? ["--host", host] : []
}

function bindSpinner() {
  const spin = spinner()
  return (name, action) => {
    if (action === "start") spin.start(name)
    else if (action === "stop") spin.stop(name)
  }
}

export const APPLY_GLOBALS_CONFIRM = "Apply global prompt optimizations? (recommended)"

export async function resolveCliPackageManager({ cwd, env, override, interactive }) {
  const detected = detectPackageManager({ cwd, env, override })
  if (detected.manager) return detected.manager
  if (interactive) {
    return await select({
      message: PACKAGE_MANAGER_ASK,
      options: PACKAGE_MANAGER_OPTIONS,
    })
  }
  process.stdout.write(`${UNKNOWN_PACKAGE_MANAGER}\n`)
  process.exitCode = 1
  return null
}

async function askPacks(cwd) {
  return await multiselect({
    message: "Optional packs",
    options: PACK_OPTIONS,
    initialValues: selectedPacks(cwd),
    required: false,
  })
}

function initOpts(base, packs) {
  if (packs === undefined) return base
  return { ...base, packs }
}

async function runInit(cwd, { skipGlobals, interactive, packageManager, packs, packsOnly = false }) {
  let selected = packs
  if (packsOnly) {
    if (selected === undefined && interactive) selected = await askPacks(cwd)
    init(cwd, initOpts({ skipGlobals, packageManager }, selected))
    return
  }
  if (!interactive) {
    init(cwd, initOpts({ skipGlobals, packageManager }, selected))
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
    applyGlobals,
    onPhase: bindSpinner(),
    packageManager,
  }, selected))
}

async function dispatch(cmd, flags, interactive, pm) {
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
      packageManager: pm,
      packs: flags.packs,
    })
    return
  }
  if (cmd === "generate") {
    runScript(pm, toGruntScriptName("rulesync:generate"))
    return
  }
  if (cmd === "check") {
    runScript(pm, toGruntScriptName("rulesync:check"))
    return
  }
  if (cmd === "sync-globals") {
    const script = flags.apply ? toGruntScriptName("sync:globals:apply") : toGruntScriptName("sync:globals")
    runScript(pm, script, hostExtra(flags.host))
    return
  }
  if (cmd === "purge-mcps") {
    runScript(pm, flags.apply ? toGruntScriptName("purge:global-mcps:apply") : toGruntScriptName("purge:global-mcps"))
    return
  }
  if (cmd === "doctor") {
    runScript(pm, toGruntScriptName("doctor"))
    return
  }
  if (cmd === "setup") {
    runScript(pm, toGruntScriptName("setup"), flags.args)
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
        pm,
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
      packageManager: pm,
      packs: flags.packs,
    })
    process.stdout.write(`reserved: ${RESERVED_SKILLS.join(" ")}\n`)
    return
  }
  process.stdout.write(USAGE)
  process.exitCode = 1
}

function commandNeedsPackageManager(cmd) {
  return !cmd || NEEDS_PM.has(cmd)
}

export async function start() {
  const flags = parseArgv(process.argv.slice(2))
  if (flags.hostError || flags.pmError || flags.packsError) {
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
  let pm
  if (commandNeedsPackageManager(cmd)) {
    pm = await resolveCliPackageManager({
      cwd: process.cwd(),
      env: process.env,
      override: flags.pm,
      interactive,
    })
    if (!pm) return
  }
  await dispatch(cmd, flags, interactive, pm)
}
