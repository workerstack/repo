import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  WORKSPACE_SKILLS_REL,
  findSkillContentConflicts,
  formatSkillConflictWarn,
  listSkillDirNames,
} from "../scripts/skill-conflicts.mjs"
import {
  SENTINEL_BEGIN,
  extractGruntBody,
  writeMergedGuardedFile,
  snapshotGuardedRoots,
  remergeGuardedRoots,
  withGuardedCheckInteriors,
} from "../scripts/guarded-md.mjs"
import {
  PACKAGE_MANAGERS,
  UNKNOWN_PACKAGE_MANAGER,
  detectPackageManager,
  installArgs,
  isPackageManager,
  runScriptArgs,
} from "../scripts/package-manager.mjs"
import { LAW_REL, emitMaps } from "../scripts/emit-maps.mjs"

export {
  GUARDED_ROOT_FILES,
  SENTINEL_BEGIN,
  SENTINEL_END,
  MAX_GUARDED_MARKDOWN_BYTES,
  extractUserMarkdown,
  extractGruntBody,
  composeGuardedMarkdown,
  mergeGuardedContent,
  writeMergedGuardedFile,
  guardedMarkdownDrift,
  snapshotGuardedRoots,
  remergeGuardedRoots,
  healGuardedRootFile,
  withGuardedCheckInteriors,
} from "../scripts/guarded-md.mjs"

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

export const PRODUCT_SCRIPTS = [
  "check-globals.mjs",
  "emit-agent-shell-tools.mjs",
  "emit-gemini.mjs",
  "emit-maps.mjs",
  "guarded-md.mjs",
  "guarded-roots.mjs",
  "emit-mcp-policy.mjs",
  "jsonc.mjs",
  "folder-map.mjs",
  "gate-fat-tools.mjs",
  "hooks-union.mjs",
  "pipeline.mjs",
  "grunt-job.mjs",
  "parse-need.mjs",
  "package-manager.mjs",
  "persist-handoff.mjs",
  "persist-implementation.mjs",
  "persist-tmp.mjs",
  "persist-plan.mjs",
  "purge-global-mcps.mjs",
  "scrub-spawn-prompt.mjs",
  "scrub-text-lib.mjs",
  "session-map.mjs",
  "sync-global-settings.mjs",
  "browser.mjs",
  "speak.mjs",
  "listen.mjs",
  "google-workspace.mjs",
  "interactive.mjs",
  "prompt.mjs",
  "setup.mjs",
  "doctor.mjs",
  "skill-conflicts.mjs",
  "scrub-text",
]

const COPY_DIRS = [".rulesync", ".grok", ".codex", ".claude", ".agents"]
/** Generated on dest from the dest tree (grunt refs + consumer extras). Never stamp the package copies. */
export const GENERATED_MAP_FILES = new Set(["INDEX.md", "skills-map.md", "refs-map.md"])
const COPY_ROOT_IF_MISSING = [".mcp.json"]
export const RETIRED_SKILLS = ["parent", "solo", "cascade"]
export const RETIRED_AGENTS = ["implementer", "thinker"]
/** Cumulative. Dest `scripts/<name>` deleted on init/upgrade even if no longer shipped. */
export const RETIRED_SCRIPTS = ["telemetry.mjs", "grunt-config.mjs"]
/** Repo-relative paths grunt used to ship. Deleted on init/upgrade. Consumer extras elsewhere kept. */
export const RETIRED_PATHS = [
  ".grok/parent.md",
  ".grok/skills/shared",
  ".rulesync/grunt.config.jsonc",
  ".rulesync/grunt.config.local.jsonc",
  ".rulesync/grunt.config.local.jsonc.example",
]
export const RESERVED_SKILLS = [
  "ask",
  "auto",
  "browser",
  "clasp",
  "commit",
  "commit-and-push",
  "commit-push",
  "commit-push-deploy",
  "commit-push-release",
  "explain",
  "google-workspace",
  "handoff",
  "implement-plan",
  "listen",
  "pickup",
  "speak",
  "su",
  "tmp",
  "write-plan",
]
const SKILL_MIRROR_DIRS = [
  [".rulesync", "skills"],
  [".grok", "skills"],
  [".claude", "skills"],
  [".agents", "skills"],
]
const AGENT_MIRROR_DIRS = [
  [".rulesync", "subagents"],
  [".claude", "agents"],
  [".grok", "agents"],
  [".agents", "agents"],
  [".codex", "agents"],
]
const GUARDED_MD_FILES = ["AGENTS.md", "CLAUDE.md"]
// .mcp.json: copy when dest is missing so first init has a root file. emit-mcp-policy
// (generate) still owns the merge from .rulesync/mcp-policy.jsonc.
export const GRUNT_PACKAGE = "@lovrozagar/grunt"
export const GRUNT_NPM_PREFIX = "grunt:"
export function toGruntScriptName(k) {
  return k.startsWith(GRUNT_NPM_PREFIX) ? k : `${GRUNT_NPM_PREFIX}${k}`
}
export const LAUNCH_SCRIPTS = {
  antigravity: "antigravity --dangerously-skip-permissions",
  claude: "claude --dangerously-skip-permissions",
  codex: "codex --dangerously-bypass-approvals-and-sandbox",
  gemini: "gemini --yolo",
  grok: "grok --yolo",
}
const OWNED_HOOK_FILES = [
  "scrub-spawn-prompt.mjs",
  "gate-fat-tools.mjs",
  "orchestrate-parent.js",
  "session-map.mjs",
]

function sortKeys(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]))
}

export function samePath(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b)
  } catch {
    return path.resolve(a) === path.resolve(b)
  }
}

const GITIGNORE_ENTRIES = [{ re: /^\.tmp\/?$/, line: ".tmp/" }]

function rmQuiet(abs) {
  fs.rmSync(abs, { recursive: true, force: true })
}

export function pruneRetired(dest, { pkgRoot } = {}) {
  const root = path.resolve(dest)
  for (const segs of SKILL_MIRROR_DIRS) {
    for (const name of RETIRED_SKILLS) {
      rmQuiet(path.join(root, ...segs, name))
    }
  }
  if (pkgRoot) {
    const packaged = new Set(
      listSkillDirNames(path.join(path.resolve(pkgRoot), WORKSPACE_SKILLS_REL)),
    )
    for (const segs of SKILL_MIRROR_DIRS) {
      for (const name of RESERVED_SKILLS) {
        if (packaged.has(name)) continue
        rmQuiet(path.join(root, ...segs, name))
      }
    }
  }
  for (const segs of AGENT_MIRROR_DIRS) {
    for (const name of RETIRED_AGENTS) {
      rmQuiet(path.join(root, ...segs, `${name}.md`))
      rmQuiet(path.join(root, ...segs, `${name}.toml`))
    }
  }
  for (const name of RETIRED_AGENTS) {
    rmQuiet(path.join(root, ".gemini", "agents", name))
    rmQuiet(path.join(root, ".grok", "roles", `${name}.toml`))
  }
  for (const name of RETIRED_SCRIPTS) {
    rmQuiet(path.join(root, "scripts", name))
  }
  for (const rel of RETIRED_PATHS) {
    rmQuiet(path.join(root, ...rel.split("/")))
  }
}

export function mergeGitignore(dest) {
  const gi = path.join(dest, ".gitignore")
  const text = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : ""
  const present = text.split(/\r?\n/)
  const missing = GITIGNORE_ENTRIES.filter(
    ({ re }) => !present.some((line) => re.test(line)),
  ).map(({ line }) => line)
  if (missing.length === 0) return
  const prefix = text.length === 0 || text.endsWith("\n") ? "" : "\n"
  fs.writeFileSync(gi, `${text}${prefix}${missing.join("\n")}\n`)
}

function destHasGruntSentinel(dest) {
  return GUARDED_MD_FILES.some((file) => {
    const p = path.join(dest, file)
    return fs.existsSync(p) && fs.readFileSync(p, "utf8").includes(SENTINEL_BEGIN)
  })
}

export function destAlreadyInited(dest) {
  return (
    fs.existsSync(path.join(dest, ".grok", "hooks", "orchestrate-parent.js")) ||
    fs.existsSync(path.join(dest, ".rulesync"))
  )
}

export function shouldAutoSkipGlobals(dest) {
  return destHasGruntSentinel(dest)
}

export function mergeGuardedMarkdown(dest, pkgRoot, file, { alreadyInited = false } = {}) {
  void alreadyInited
  const src = path.join(pkgRoot, file)
  const d = path.join(dest, file)
  if (samePath(src, d)) return
  const srcText = fs.readFileSync(src, "utf8")
  return writeMergedGuardedFile(d, extractGruntBody(srcText) ?? srcText)
}

export function mergeClaudeSettings(destRoot, pkgRoot) {
  const srcPath = path.join(pkgRoot, ".claude", "settings.json")
  const destPath = path.join(destRoot, ".claude", "settings.json")

  if (!fs.existsSync(destPath)) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.copyFileSync(srcPath, destPath)
    return
  }

  let destSettings
  try {
    destSettings = JSON.parse(fs.readFileSync(destPath, "utf8"))
  } catch (err) {
    throw new Error(`malformed JSON in ${destPath}: ${err.message}`)
  }

  const srcSettings = JSON.parse(fs.readFileSync(srcPath, "utf8"))
  const isOwnedGroup = (group) =>
    group.hooks.every((entry) => OWNED_HOOK_FILES.some((f) => entry.command.includes(f)))

  const destHooks = { ...(destSettings.hooks || {}) }
  for (const [event, srcGroups] of Object.entries(srcSettings.hooks)) {
    const destGroups = destHooks[event] || []
    destHooks[event] = [...destGroups.filter((group) => !isOwnedGroup(group)), ...srcGroups]
  }
  destSettings.hooks = destHooks

  const destPerms = { ...(destSettings.permissions || {}) }
  for (const key of ["deny", "allow"]) {
    const destList = destPerms[key] || []
    const srcList = srcSettings.permissions[key] || []
    const seen = new Set(destList)
    const merged = [...destList]
    for (const item of srcList) {
      if (!seen.has(item)) {
        seen.add(item)
        merged.push(item)
      }
    }
    // No empty list the source never had, so a re-init does not rewrite the file.
    if (merged.length || key in destPerms) destPerms[key] = merged
  }
  destSettings.permissions = destPerms

  for (const key of Object.keys(srcSettings)) {
    if (key.toLowerCase().includes("mcp")) {
      destSettings[key] = srcSettings[key]
    }
  }

  fs.writeFileSync(destPath, `${JSON.stringify(destSettings, null, 2)}\n`)
}

function looksGruntOwnedPrefix(prefix) {
  return /rulesync|sync:globals|^(?:npm|yarn|pnpm|bun) run |guarded-roots\.mjs|hooks-union\.mjs|doctor\.mjs|sync-global-settings\.mjs|check-globals\.mjs|purge-global-mcps\.mjs/.test(
    prefix,
  )
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function commandCount(script) {
  return script.split(/\s*(?:&&|;)\s*/).filter(Boolean).length
}

function extraOwnedSuffix(cur, newSrc) {
  const nNew = commandCount(newSrc)
  const nCur = commandCount(cur)
  if (nCur <= nNew) return null
  let completed = 1
  const re = / &&| ;|&&/g
  let m
  while ((m = re.exec(cur))) {
    if (completed === nNew) {
      const prefix = cur.slice(0, m.index)
      if (!looksGruntOwnedPrefix(prefix)) return null
      return cur.slice(m.index)
    }
    completed++
  }
  return null
}

function mergeScriptValue(newSrc, cur) {
  if (cur.startsWith(newSrc)) return cur
  const suffix = extraOwnedSuffix(cur, newSrc)
  if (suffix != null) return newSrc + suffix
  return newSrc
}

function rewritePackageManagerRunRefs(scripts, srcKeys) {
  const keys = srcKeys
    .filter((k) => k !== toGruntScriptName(k))
    .sort((a, b) => b.length - a.length)
  if (!keys.length) return
  const pm = PACKAGE_MANAGERS.join("|")
  for (const name of Object.keys(scripts)) {
    let val = scripts[name]
    if (typeof val !== "string") continue
    for (const k of keys) {
      val = val.replace(
        new RegExp(`(${pm}) run ${escapeRe(k)}(?=$|\\s|;|&)`, "g"),
        `$1 run ${toGruntScriptName(k)}`,
      )
    }
    scripts[name] = val
  }
}

export function placeGruntDevDependency(destPkg, srcPkg) {
  const deps =
    destPkg.dependencies && typeof destPkg.dependencies === "object"
      ? destPkg.dependencies
      : null
  destPkg.devDependencies = { ...(destPkg.devDependencies || {}) }
  const fromDep = deps?.[GRUNT_PACKAGE]
  const fromDev = destPkg.devDependencies[GRUNT_PACKAGE]
  if (fromDep != null && deps) {
    delete destPkg.dependencies[GRUNT_PACKAGE]
    if (fromDev == null) destPkg.devDependencies[GRUNT_PACKAGE] = fromDep
    if (Object.keys(destPkg.dependencies).length === 0) delete destPkg.dependencies
  }
  if (
    destPkg.devDependencies[GRUNT_PACKAGE] == null &&
    srcPkg?.name === GRUNT_PACKAGE &&
    srcPkg.version
  ) {
    destPkg.devDependencies[GRUNT_PACKAGE] = srcPkg.version
  }
}

export function mergePackageJson(dest, pkgRoot) {
  const destPath = path.join(dest, "package.json")
  let destPkg = {}
  if (fs.existsSync(destPath)) {
    destPkg = JSON.parse(fs.readFileSync(destPath, "utf8"))
  }
  if (destPkg.name === "@lovrozagar/grunt") return

  const srcPkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8"))
  destPkg.scripts = { ...(destPkg.scripts || {}) }
  const srcKeys = []
  for (const [k, v] of Object.entries(srcPkg.scripts || {})) {
    if (k === "test" || k.endsWith(":raw") || k in LAUNCH_SCRIPTS) continue
    srcKeys.push(k)
    const destKey = toGruntScriptName(k)
    const current = destPkg.scripts[destKey]
    const legacy = destPkg.scripts[k]
    const ownedLegacy =
      legacy != null &&
      (legacy.startsWith(v) || extraOwnedSuffix(legacy, v) != null || looksGruntOwnedPrefix(legacy))
    if (current != null) {
      destPkg.scripts[destKey] = mergeScriptValue(v, current)
    } else if (ownedLegacy) {
      destPkg.scripts[destKey] = mergeScriptValue(v, legacy)
    } else {
      destPkg.scripts[destKey] = v
    }
    if (k !== destKey && ownedLegacy) {
      delete destPkg.scripts[k]
    } else if (k !== destKey && legacy != null) {
      console.warn(
        `script \`${k}\` left untouched (unrelated customization); writing \`${destKey}\``,
      )
    }
  }
  for (const [k, v] of Object.entries(LAUNCH_SCRIPTS)) {
    const destKey = toGruntScriptName(k)
    const current = destPkg.scripts[destKey]
    destPkg.scripts[destKey] = current != null ? mergeScriptValue(v, current) : v
    const staleKey = `grunt:yolo:${k}`
    if (destPkg.scripts[staleKey] === v) delete destPkg.scripts[staleKey]
  }
  rewritePackageManagerRunRefs(destPkg.scripts, srcKeys)
  destPkg.devDependencies = { ...(destPkg.devDependencies || {}) }
  destPkg.devDependencies["smol-toml"] = srcPkg.devDependencies["smol-toml"]
  destPkg.devDependencies["rulesync"] = srcPkg.devDependencies["rulesync"]
  const clack = srcPkg.dependencies?.["@clack/prompts"]
  if (clack) destPkg.devDependencies["@clack/prompts"] = clack
  placeGruntDevDependency(destPkg, srcPkg)
  destPkg.scripts = sortKeys(destPkg.scripts)
  destPkg.devDependencies = sortKeys(destPkg.devDependencies)
  fs.writeFileSync(destPath, `${JSON.stringify(destPkg, null, 2)}\n`)
}

/**
 * Recursive overwrite copy on readdir/readFile/writeFile. Not fs.cpSync: it runs in
 * native code, so Yarn PnP (`yarn dlx`, package inside a zip) cannot serve it.
 */
export function copyTree(src, dest, filter = () => true) {
  if (!filter(src)) return
  const st = fs.statSync(src)
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const name of fs.readdirSync(src)) copyTree(path.join(src, name), path.join(dest, name), filter)
    return
  }
  fs.writeFileSync(dest, fs.readFileSync(src), { mode: st.mode })
}

function copyRootIfMissing(dest, pkgRoot) {
  for (const file of COPY_ROOT_IF_MISSING) {
    const src = path.join(pkgRoot, file)
    const d = path.join(dest, file)
    if (!fs.existsSync(src) || fs.existsSync(d)) continue
    fs.copyFileSync(src, d)
  }
}

function emitDestMaps(dest) {
  if (!fs.existsSync(path.join(dest, LAW_REL))) return
  const maps = emitMaps({ workspaceRoot: dest })
  if (!maps.ok) throw new Error(maps.error || "emit-maps failed")
}

export function resolveInitPackageManager(dest, { packageManager, env = process.env } = {}) {
  if (packageManager) {
    const name = String(packageManager).toLowerCase()
    if (!isPackageManager(name)) {
      throw new Error(UNKNOWN_PACKAGE_MANAGER)
    }
    return name
  }
  const detected = detectPackageManager({ cwd: dest, env })
  if (!detected.manager) throw new Error(UNKNOWN_PACKAGE_MANAGER)
  return detected.manager
}

export function init(dest, { pkgRoot: pkgRootOpt, execFileSync: exec = execFileSync, skipGlobals = false, applyGlobals, onPhase, packageManager, env = process.env } = {}) {
  dest = path.resolve(dest)
  const pkgRoot = path.resolve(pkgRootOpt ?? PKG_ROOT)
  const skipGlobalsApply =
    applyGlobals === true ? false : skipGlobals || shouldAutoSkipGlobals(dest)

  const phase = (name, fn) => {
    onPhase?.(name, "start")
    try {
      fn()
    } finally {
      onPhase?.(name, "stop")
    }
  }

  const self = samePath(dest, pkgRoot)

  phase("merge", () => {
    const wsSkills = path.join(dest, WORKSPACE_SKILLS_REL)
    const pkgSkills = path.join(pkgRoot, WORKSPACE_SKILLS_REL)
    if (!samePath(wsSkills, pkgSkills)) {
      for (const c of findSkillContentConflicts({
        workspaceSkillsDir: wsSkills,
        packagedSkillsDir: pkgSkills,
      })) {
        console.warn(formatSkillConflictWarn(c.name))
      }
    }

    for (const dir of COPY_DIRS) {
      const src = path.join(pkgRoot, dir)
      const d = path.join(dest, dir)
      fs.mkdirSync(d, { recursive: true })
      if (samePath(src, d)) continue
      if (dir === ".claude") {
        copyTree(src, d, (s) => path.basename(s) !== "settings.json")
        mergeClaudeSettings(dest, pkgRoot)
      } else if (dir === ".rulesync") {
        copyTree(src, d, (s) => !GENERATED_MAP_FILES.has(path.basename(s)))
      } else {
        copyTree(src, d)
      }
    }

    pruneRetired(dest, { pkgRoot })

    for (const file of GUARDED_MD_FILES) {
      mergeGuardedMarkdown(dest, pkgRoot, file)
    }

    fs.mkdirSync(path.join(dest, "scripts"), { recursive: true })
    for (const name of PRODUCT_SCRIPTS) {
      const src = path.join(pkgRoot, "scripts", name)
      const d = path.join(dest, "scripts", name)
      if (samePath(src, d)) continue
      copyTree(src, d)
    }

    fs.mkdirSync(path.join(dest, ".tmp"), { recursive: true })
    mergeGitignore(dest)

    if (!self) {
      mergePackageJson(dest, pkgRoot)
      copyRootIfMissing(dest, pkgRoot)
      emitDestMaps(dest)
    }
  })

  // Self-skip: file/dir merge + .tmp + gitignore only. No package.json merge,
  // install, or generate/sync/check (would mutate this package in-place).
  if (self) return

  const pm = resolveInitPackageManager(dest, { packageManager, env })
  const runPm = (name, args) => {
    onPhase?.(name, "start")
    onPhase?.(name, "stop")
    exec(pm, args, { cwd: dest, stdio: "inherit" })
  }
  runPm("install", installArgs(pm))
  const guardedSnap = snapshotGuardedRoots(dest)
  runPm("generate", runScriptArgs(pm, toGruntScriptName("rulesync:generate")))
  remergeGuardedRoots(dest, guardedSnap)
  if (!skipGlobalsApply) {
    runPm("sync-globals", runScriptArgs(pm, toGruntScriptName("sync:globals:apply")))
  }
  withGuardedCheckInteriors(dest, () => {
    runPm("check", runScriptArgs(pm, toGruntScriptName("rulesync:check")))
  })
}
