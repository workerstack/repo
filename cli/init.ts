import { execFileSync } from "./spawn.ts"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { CLAUDE_SKILLS_REL } from "../.rulesync/scripts/emit-skill-links.ts"
import { hookNameOf } from "../.rulesync/scripts/hook-command.ts"
import {
  SKILLS_SOURCE_REL,
  findSkillContentConflicts,
  formatSkillConflictWarn,
  listSkillDirNames,
} from "../.rulesync/scripts/skill-conflicts.ts"
import {
  extractManagedBody,
  writeMergedGuardedFile,
  snapshotGuardedRoots,
  remergeGuardedRoots,
  withGuardedCheckInteriors,
  mergeReferenceMarkdown,
} from "../.rulesync/scripts/guarded-md.ts"
import { LAW_REL, emitMaps } from "../.rulesync/scripts/emit-maps.ts"
import {
  isUnselectedPackPath,
  resolvePackSelection,
  unselectedPackRels,
  unselectedRefNames,
  unselectedScriptNames,
  writePacks,
} from "../.rulesync/scripts/feature-packs.ts"
import { CONFIG_FILE, defaultPacks } from "./config.ts"

export {
  GUARDED_ROOT_FILES,
  SENTINEL_BEGIN,
  SENTINEL_END,
  MAX_GUARDED_MARKDOWN_BYTES,
  extractUserMarkdown,
  extractManagedBody,
  composeGuardedMarkdown,
  mergeGuardedContent,
  writeMergedGuardedFile,
  guardedMarkdownDrift,
  snapshotGuardedRoots,
  remergeGuardedRoots,
  healGuardedRootFile,
  withGuardedCheckInteriors,
  extraH2Sections,
  mergeReferenceMarkdown,
} from "../.rulesync/scripts/guarded-md.ts"

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

export const PRODUCT_SCRIPTS = [
  "check-globals.ts",
  "emit-agent-shell-tools.ts",
  "emit-maps.ts",
  "emit-skill-links.ts",
  "guarded-md.ts",
  "guarded-roots.ts",
  "emit-mcp-policy.ts",
  "jsonc.ts",
  "lessons.ts",
  "folder-map.ts",
  "gate-fat-tools.ts",
  "hook-command.ts",
  "hook-input.ts",
  "hooks-union.ts",
  "pipeline.ts",
  "job.ts",
  "parse-need.ts",
  "persist-handoff.ts",
  "persist-implementation.ts",
  "persist-tmp.ts",
  "persist-plan.ts",
  "persist-roadmap.ts",
  "purge-global-mcps.ts",
  "scrub-spawn-prompt.ts",
  "scrub-text-lib.ts",
  "session-map.ts",
  "strategy.ts",
  "sync-global-settings.ts",
  "board.ts",
  "browser.ts",
  "feature-packs.ts",
  "speak.ts",
  "listen.ts",
  "jev.ts",
  "google-workspace.ts",
  "interactive.ts",
  "prompt.ts",
  "setup.ts",
  "doctor.ts",
  "clean.ts",
  "vscode-tasks.ts",
  "workspace-root.ts",
  "gitignore-guard.ts",
  "worktree.ts",
  "skill-conflicts.ts",
  "scrub-text",
]

const COPY_DIRS = [".rulesync", ".grok", ".codex", ".claude", ".agents"]
/** Product scripts home in the package and in consumers. */
export const SCRIPTS_REL = ".rulesync/scripts"
/** Repo-owned lessons: the package never ships its own, and init never touches the consumer's. */
export const LESSONS_REL = ".rulesync/lessons"
/** Generated on dest from the dest tree (repo refs + consumer extras). Never stamp the package copies. */
export const GENERATED_MAP_FILES = new Set(["INDEX.md", "skills-map.md", "refs-map.md"])
const COPY_ROOT_IF_MISSING = [".mcp.json"]
export const RESERVED_SKILLS = [
  "ask",
  "auto",
  "blast-radius",
  "bro",
  "browser",
  "clasp",
  "commit",
  "commit-and-push",
  "commit-push",
  "commit-push-deploy",
  "commit-push-release",
  "correct",
  "explain",
  "google-workspace",
  "handoff",
  "implement-plan",
  "implement-roadmap",
  "jev",
  "listen",
  "pickup",
  "principle-attack-the-premise",
  "principle-boundary-discipline",
  "principle-build-the-lever",
  "principle-encode-lessons-in-structure",
  "principle-exhaust-the-design-space",
  "principle-experience-first",
  "principle-explain-the-number",
  "principle-fix-root-causes",
  "principle-foundational-thinking",
  "principle-guard-the-context-window",
  "principle-laziness-protocol",
  "principle-make-operations-idempotent",
  "principle-migrate-callers-then-delete-legacy-apis",
  "principle-minimize-reader-load",
  "principle-model-the-domain",
  "principle-never-block-on-the-human",
  "principle-outcome-oriented-execution",
  "principle-prove-it-works",
  "principle-redesign-from-first-principles",
  "principle-separate-before-serializing-shared-state",
  "principle-sequence-verifiable-units",
  "principle-subtract-before-you-add",
  "principle-test-behavior-not-implementation",
  "principle-type-system-discipline",
  "review-plan",
  "review-roadmap",
  "speak",
  "su",
  "teach",
  "tmp",
  "typescript-best-practices",
  "unslop",
  "write-plan",
  "write-roadmap",
]
const GUARDED_MD_FILES = ["AGENTS.md"]
// .mcp.json: copy when dest is missing so first init has a root file. emit-mcp-policy
// (generate) still owns the merge from .rulesync/mcp-policy.jsonc.
export const PACKAGE_NAME = "@workerstack/repo"
export const SCRIPT_PREFIX = "repo:"
export function toScriptName(k: string) {
  return k.startsWith(SCRIPT_PREFIX) ? k : `${SCRIPT_PREFIX}${k}`
}
export const E2E_VITEST_CONFIGS = [
  "vitest.e2e.config.ts",
  "vitest.e2e.config.mts",
  "vitest.e2e.config.js",
  "vitest.e2e.config.mjs",
  "vitest.e2e.config.cjs",
]
export const REFERENCE_REL = ".rulesync/reference"

function sortKeys<T>(obj: Record<string, T>): Record<string, T> {
  // k comes from Object.keys(obj), so it is always present
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]!]))
}

export function samePath(a: string, b: string) {
  try {
    return fs.realpathSync.native(a) === fs.realpathSync.native(b)
  } catch {
    return path.resolve(a) === path.resolve(b)
  }
}

function rmQuiet(abs: string) {
  fs.rmSync(abs, { recursive: true, force: true })
}

/** Remove reserved skill names the package no longer ships: the source dir and its `.claude/skills` link. */
export function pruneRetired(dest: string, { pkgRoot }: { pkgRoot: string }) {
  const root = path.resolve(dest)
  const packaged = new Set(listSkillDirNames(path.join(path.resolve(pkgRoot), SKILLS_SOURCE_REL)))
  for (const name of RESERVED_SKILLS) {
    if (packaged.has(name)) continue
    rmQuiet(path.join(root, SKILLS_SOURCE_REL, name))
    rmQuiet(path.join(root, CLAUDE_SKILLS_REL, name))
  }
}

export function destAlreadyInited(dest: string) {
  return (
    fs.existsSync(path.join(dest, ".grok", "hooks", "orchestrate-parent.ts")) ||
    fs.existsSync(path.join(dest, ".rulesync"))
  )
}

export function mergeGuardedMarkdown(dest: string, pkgRoot: string, file: string, { alreadyInited = false }: { alreadyInited?: boolean } = {}) {
  void alreadyInited
  const src = path.join(pkgRoot, file)
  const d = path.join(dest, file)
  if (samePath(src, d)) return
  const srcText = fs.readFileSync(src, "utf8")
  return writeMergedGuardedFile(d, extractManagedBody(srcText) ?? srcText)
}

export function mergeClaudeSettings(destRoot: string, pkgRoot: string) {
  const srcPath = path.join(pkgRoot, ".claude", "settings.json")
  const destPath = path.join(destRoot, ".claude", "settings.json")

  if (!fs.existsSync(destPath)) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.copyFileSync(srcPath, destPath)
    return
  }

  let destValue: unknown
  try {
    destValue = JSON.parse(fs.readFileSync(destPath, "utf8"))
  } catch (err) {
    throw new Error(`malformed JSON in ${destPath}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!isClaudeSettings(destValue)) throw new Error(`${destPath} does not hold the hooks and permissions shape repo needs`)
  const destSettings = destValue

  const srcSettings = readJsonFile(srcPath, isPackagedSettings)
  /** A group of repo hooks only, in the `repo hook <name>` form or the older script form: the package replaces it. */
  const isOwnedGroup = (group: HookGroup) => group.hooks.every((entry) => hookNameOf(entry.command) !== null)

  const destHooks: Record<string, HookGroup[]> = { ...(destSettings.hooks || {}) }
  for (const [event, srcGroups] of Object.entries(srcSettings.hooks)) {
    const destGroups = destHooks[event] || []
    destHooks[event] = [...destGroups.filter((group) => !isOwnedGroup(group)), ...srcGroups]
  }
  destSettings.hooks = destHooks

  const destPerms: Record<string, string[]> = { ...(destSettings.permissions || {}) }
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

/** The slice of .claude/settings.json the merge reads; other keys pass through. */
interface HookGroup {
  hooks: { command: string }[]
}
interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>
  permissions?: Record<string, string[]>
  [key: string]: unknown
}
/** The settings this package ships: they always carry hooks and permissions. */
interface PackagedSettings extends ClaudeSettings {
  hooks: Record<string, HookGroup[]>
  permissions: Record<string, string[]>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return isRecord(v) && Object.values(v).every((x) => typeof x === "string")
}

function isHookGroup(v: unknown): v is HookGroup {
  return isRecord(v) && Array.isArray(v.hooks) && v.hooks.every((e) => isRecord(e) && typeof e.command === "string")
}

/** True when the hooks and permissions, the parts the merge reads, have the shape it needs. */
function isClaudeSettings(v: unknown): v is ClaudeSettings {
  if (!isRecord(v)) return false
  const { hooks, permissions } = v
  const hooksOk =
    hooks === undefined || (isRecord(hooks) && Object.values(hooks).every((g) => Array.isArray(g) && g.every(isHookGroup)))
  const permsOk =
    permissions === undefined ||
    (isRecord(permissions) &&
      Object.values(permissions).every((l) => Array.isArray(l) && l.every((x) => typeof x === "string")))
  return hooksOk && permsOk
}

function isPackagedSettings(v: unknown): v is PackagedSettings {
  return isClaudeSettings(v) && v.hooks !== undefined && v.permissions !== undefined
}

/** The slice of package.json the merge reads; other keys pass through. */
interface PackageJson {
  name?: string
  version?: string
  workspaces?: unknown
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  [key: string]: unknown
}

/** True when name and version are strings and the script and dependency maps hold only strings. */
function isPackageJson(v: unknown): v is PackageJson {
  return (
    isRecord(v) &&
    [v.name, v.version].every((x) => x === undefined || typeof x === "string") &&
    [v.scripts, v.dependencies, v.devDependencies].every((x) => x === undefined || isStringRecord(x))
  )
}

/** The JSON file at `file`, refused with a clear error unless `is` accepts its shape. */
function readJsonFile<T>(file: string, is: (v: unknown) => v is T): T {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"))
  if (!is(value)) throw new Error(`${file} does not hold the shape repo needs`)
  return value
}

// A command repo wrote: one of its scripts, or a run of a repo: script. Not any `bun run`, which a
// repo's own `bun run build && …` would match, and its script would be taken over as repo's.
function looksOwnedPrefix(prefix: string) {
  return /rulesync|sync:globals|^bun run repo:|guarded-roots\.ts|hooks-union\.ts|doctor\.ts|clean\.ts|sync-global-settings\.ts|check-globals\.ts|purge-global-mcps\.ts/.test(
    prefix,
  )
}

function commandCount(script: string) {
  return script.split(/\s*(?:&&|;)\s*/).filter(Boolean).length
}

function extraOwnedSuffix(cur: string, newSrc: string) {
  const nNew = commandCount(newSrc)
  const nCur = commandCount(cur)
  if (nCur <= nNew) return null
  let completed = 1
  const re = / &&| ;|&&/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cur))) {
    if (completed === nNew) {
      const prefix = cur.slice(0, m.index)
      if (!looksOwnedPrefix(prefix)) return null
      return cur.slice(m.index)
    }
    completed++
  }
  return null
}

function mergeScriptValue(newSrc: string, cur: string) {
  if (cur.startsWith(newSrc)) return cur
  const suffix = extraOwnedSuffix(cur, newSrc)
  if (suffix != null) return newSrc + suffix
  if (looksOwnedPrefix(cur)) return newSrc
  return cur
}

function hasE2eConfig(dest: string) {
  return E2E_VITEST_CONFIGS.some((name) => fs.existsSync(path.join(dest, name)))
}

export function snapshotReferenceDocs(dest: string) {
  const dir = path.join(dest, REFERENCE_REL)
  const snap: Record<string, string> = {}
  if (!fs.existsSync(dir)) return snap
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".md") || GENERATED_MAP_FILES.has(name)) continue
    const abs = path.join(dir, name)
    if (!fs.statSync(abs).isFile()) continue
    snap[name] = fs.readFileSync(abs, "utf8")
  }
  return snap
}

export function remergeReferenceDocs(dest: string, snap: Record<string, string>, pkgRoot: string, skip: Set<string> = new Set()) {
  const pkgDir = path.join(pkgRoot, REFERENCE_REL)
  const destDir = path.join(dest, REFERENCE_REL)
  for (const [name, existing] of Object.entries(snap)) {
    if (skip.has(name)) continue
    const pkgFile = path.join(pkgDir, name)
    if (!fs.existsSync(pkgFile)) continue
    const incoming = fs.readFileSync(pkgFile, "utf8")
    fs.mkdirSync(destDir, { recursive: true })
    fs.writeFileSync(path.join(destDir, name), mergeReferenceMarkdown(existing, incoming))
  }
}

export function placeDevDependency(destPkg: PackageJson, srcPkg?: PackageJson) {
  const deps =
    destPkg.dependencies && typeof destPkg.dependencies === "object"
      ? destPkg.dependencies
      : null
  const devDeps: Record<string, string> = { ...(destPkg.devDependencies || {}) }
  destPkg.devDependencies = devDeps
  const fromDep = deps?.[PACKAGE_NAME]
  const fromDev = devDeps[PACKAGE_NAME]
  if (fromDep != null && deps) {
    delete deps[PACKAGE_NAME]
    if (fromDev == null) devDeps[PACKAGE_NAME] = fromDep
    if (Object.keys(deps).length === 0) delete destPkg.dependencies
  }
  if (devDeps[PACKAGE_NAME] == null && srcPkg?.name === PACKAGE_NAME && srcPkg.version) {
    devDeps[PACKAGE_NAME] = srcPkg.version
  }
}

const SYNC_POSTINSTALL = "repo sync --postinstall"

/** Write `workerstack.config.ts` with the default packs, only when the repo has none. */
export function writeConfigIfMissing(dest: string) {
  const configPath = path.join(dest, CONFIG_FILE)
  if (fs.existsSync(configPath)) return
  const pkgPath = path.join(dest, "package.json")
  const pkg = fs.existsSync(pkgPath) ? readJsonFile(pkgPath, isPackageJson) : {}
  const packs = defaultPacks(pkg.workspaces !== undefined).map((p) => JSON.stringify(p)).join(", ")
  fs.writeFileSync(
    configPath,
    `import { defineConfig } from "${PACKAGE_NAME}"\n\nexport default defineConfig({\n  packs: [${packs}],\n})\n`,
  )
}

export function mergePackageJson(dest: string, pkgRoot: string) {
  const destPath = path.join(dest, "package.json")
  let destPkg: PackageJson = {}
  if (fs.existsSync(destPath)) {
    destPkg = readJsonFile(destPath, isPackageJson)
  }
  if (destPkg.name === "@workerstack/repo") return

  const srcPkgPath = path.join(pkgRoot, "package.json")
  const srcPkg = readJsonFile(srcPkgPath, isPackageJson)
  const srcDeps = srcPkg.dependencies
  const srcDevDeps = srcPkg.devDependencies
  if (!srcDeps || !srcDevDeps) throw new Error(`${srcPkgPath} lists no dependencies and devDependencies`)
  const destScripts: Record<string, string> = { ...(destPkg.scripts || {}) }
  destPkg.scripts = destScripts
  for (const [k, v] of Object.entries(srcPkg.scripts || {})) {
    // Lifecycle scripts run this package's own setup; copied as repo:* they would run nowhere useful.
    if (k === "test" || k === "postinstall" || k === "prepare" || k.endsWith(":raw")) continue
    const destKey = toScriptName(k)
    const current = destScripts[destKey]
    if (k === "test:e2e" && current == null) {
      // A repo that runs its own e2e keeps it as the only one: repo's would rerun it without the
      // repo's own steps (a build first, say).
      if (destScripts[k] != null) {
        console.warn(`script \`${k}\` is the repo's own; not writing \`${destKey}\``)
        continue
      }
      if (!hasE2eConfig(dest)) continue
    }
    destScripts[destKey] = current != null ? mergeScriptValue(v, current) : v
  }
  const postinstall = destScripts.postinstall
  if (postinstall == null) destScripts.postinstall = SYNC_POSTINSTALL
  else if (!postinstall.includes("repo sync")) destScripts.postinstall = `${SYNC_POSTINSTALL} && ${postinstall}`
  destPkg.devDependencies = { ...(destPkg.devDependencies || {}) }
  destPkg.devDependencies["smol-toml"] = srcDeps["smol-toml"]!
  destPkg.devDependencies["rulesync"] = srcDevDeps["rulesync"]!
  const clack = srcDeps["@clack/prompts"]
  if (clack) destPkg.devDependencies["@clack/prompts"] = clack
  placeDevDependency(destPkg, srcPkg)
  destPkg.scripts = sortKeys(destScripts)
  destPkg.devDependencies = sortKeys(destPkg.devDependencies)
  fs.writeFileSync(destPath, `${JSON.stringify(destPkg, null, 2)}\n`)
}

/**
 * Recursive overwrite copy, filtered per path.
 * @param src
 * @param dest
 * @param [filter] Return false to skip a path (and its subtree).
 * @returns
 */
export function copyTree(src: string, dest: string, filter: (path: string) => boolean = () => true): void {
  if (!filter(src)) return
  const st = fs.statSync(src)
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const name of fs.readdirSync(src)) copyTree(path.join(src, name), path.join(dest, name), filter)
    return
  }
  fs.writeFileSync(dest, fs.readFileSync(src), { mode: st.mode })
}

function copyRootIfMissing(dest: string, pkgRoot: string) {
  for (const file of COPY_ROOT_IF_MISSING) {
    const src = path.join(pkgRoot, file)
    const d = path.join(dest, file)
    if (!fs.existsSync(src) || fs.existsSync(d)) continue
    fs.copyFileSync(src, d)
  }
}

function emitDestMaps(dest: string) {
  if (!fs.existsSync(path.join(dest, LAW_REL))) return
  const maps = emitMaps({ workspaceRoot: dest })
  if (!maps.ok) throw new Error(maps.error || "emit-maps failed")
}

export interface InitOptions {
  pkgRoot?: string
  execFileSync?: (cmd: string, args: string[], opts: import("node:child_process").ExecFileSyncOptions) => unknown
  skipGlobals?: boolean
  onPhase?: (name: string, state: "start" | "stop") => void
  packs?: string[]
}

/**
 * Merge the package into `dest`, then install, generate, sync globals, and check there.
 * @param dest Workspace to initialise.
 * @param [options]
 * @returns
 */
export function init(dest: string, { pkgRoot: pkgRootOpt, execFileSync: exec = execFileSync, skipGlobals = false, onPhase, packs }: InitOptions = {}): void {
  dest = path.resolve(dest)
  const pkgRoot = path.resolve(pkgRootOpt ?? PKG_ROOT)

  const phase = (name: string, fn: () => void) => {
    onPhase?.(name, "start")
    try {
      fn()
    } finally {
      onPhase?.(name, "stop")
    }
  }

  const self = samePath(dest, pkgRoot)
  const selection = self ? { packs: [], answered: false } : resolvePackSelection(dest, packs)
  const selected = new Set(selection.packs)
  const allowPack = (src: string) => !isUnselectedPackPath(path.relative(pkgRoot, src), selected)

  phase("merge", () => {
    const wsSkills = path.join(dest, SKILLS_SOURCE_REL)
    const pkgSkills = path.join(pkgRoot, SKILLS_SOURCE_REL)
    if (!samePath(wsSkills, pkgSkills)) {
      for (const c of findSkillContentConflicts({
        workspaceSkillsDir: wsSkills,
        packagedSkillsDir: pkgSkills,
      })) {
        console.warn(formatSkillConflictWarn(c.name))
      }
    }

    const refSnap = self ? {} : snapshotReferenceDocs(dest)

    for (const dir of COPY_DIRS) {
      const src = path.join(pkgRoot, dir)
      const d = path.join(dest, dir)
      fs.mkdirSync(d, { recursive: true })
      if (samePath(src, d)) continue
      if (dir === ".claude") {
        // generate links .claude/skills from .agents/skills; npm pack drops the package's links
        const skillsSrc = path.join(src, "skills")
        copyTree(src, d, (s) => path.basename(s) !== "settings.json" && s !== skillsSrc && allowPack(s))
        mergeClaudeSettings(dest, pkgRoot)
      } else if (dir === ".rulesync") {
        const scriptsSrc = path.join(pkgRoot, ...SCRIPTS_REL.split("/"))
        const lessonsSrc = path.join(pkgRoot, ...LESSONS_REL.split("/"))
        copyTree(
          src,
          d,
          (s) =>
            s !== scriptsSrc &&
            s !== lessonsSrc &&
            !GENERATED_MAP_FILES.has(path.basename(s)) &&
            allowPack(s),
        )
      } else {
        copyTree(src, d, allowPack)
      }
    }

    pruneRetired(dest, { pkgRoot })

    for (const file of GUARDED_MD_FILES) {
      mergeGuardedMarkdown(dest, pkgRoot, file)
    }

    const scriptsDest = path.join(dest, ...SCRIPTS_REL.split("/"))
    fs.mkdirSync(scriptsDest, { recursive: true })
    const skipScripts = unselectedScriptNames(selected)
    for (const name of PRODUCT_SCRIPTS) {
      if (skipScripts.has(name)) continue
      const src = path.join(pkgRoot, ...SCRIPTS_REL.split("/"), name)
      const d = path.join(scriptsDest, name)
      if (samePath(src, d)) continue
      copyTree(src, d)
    }

    fs.mkdirSync(path.join(dest, ".tmp"), { recursive: true })

    if (!self) {
      remergeReferenceDocs(dest, refSnap, pkgRoot, unselectedRefNames(selected))
      mergePackageJson(dest, pkgRoot)
      writeConfigIfMissing(dest)
      copyRootIfMissing(dest, pkgRoot)
      for (const rel of unselectedPackRels(selected)) {
        fs.rmSync(path.join(dest, rel), { recursive: true, force: true })
      }
      if (selection.answered) writePacks(dest, selection.packs)
      emitDestMaps(dest)
    }
  })

  // Self-skip: file/dir merge + .tmp only. No package.json merge,
  // install, or generate/sync/check (would mutate this package in-place).
  if (self) return

  const bun = (name: string, args: string[]) => {
    onPhase?.(name, "start")
    onPhase?.(name, "stop")
    exec("bun", args, { cwd: dest, stdio: "inherit" })
  }
  bun("install", ["install"])
  const guardedSnap = snapshotGuardedRoots(dest)
  bun("generate", ["run", toScriptName("rulesync:generate")])
  remergeGuardedRoots(dest, guardedSnap)
  if (!skipGlobals) {
    bun("sync-globals", ["run", toScriptName("sync:globals:apply")])
  }
  withGuardedCheckInteriors(dest, () => {
    bun("check", ["run", toScriptName("rulesync:check")])
  })
}
