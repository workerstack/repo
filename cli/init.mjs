import { execFileSync } from "./spawn.mjs"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { CLAUDE_SKILLS_REL } from "../.rulesync/scripts/emit-skill-links.mjs"
import {
  SKILLS_SOURCE_REL,
  findSkillContentConflicts,
  formatSkillConflictWarn,
  listSkillDirNames,
} from "../.rulesync/scripts/skill-conflicts.mjs"
import {
  SENTINEL_BEGIN,
  extractManagedBody,
  writeMergedGuardedFile,
  snapshotGuardedRoots,
  remergeGuardedRoots,
  withGuardedCheckInteriors,
  mergeReferenceMarkdown,
} from "../.rulesync/scripts/guarded-md.mjs"
import { LAW_REL, emitMaps } from "../.rulesync/scripts/emit-maps.mjs"
import {
  isUnselectedPackPath,
  resolvePackSelection,
  unselectedPackRels,
  unselectedRefNames,
  unselectedScriptNames,
  writePacks,
} from "../.rulesync/scripts/feature-packs.mjs"

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
} from "../.rulesync/scripts/guarded-md.mjs"

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

export const PRODUCT_SCRIPTS = [
  "check-globals.mjs",
  "emit-agent-shell-tools.mjs",
  "emit-maps.mjs",
  "emit-skill-links.mjs",
  "guarded-md.mjs",
  "guarded-roots.mjs",
  "emit-mcp-policy.mjs",
  "jsonc.mjs",
  "lessons.mjs",
  "folder-map.mjs",
  "gate-fat-tools.mjs",
  "hooks-union.mjs",
  "pipeline.mjs",
  "job.mjs",
  "parse-need.mjs",
  "persist-handoff.mjs",
  "persist-implementation.mjs",
  "persist-tmp.mjs",
  "persist-plan.mjs",
  "persist-roadmap.mjs",
  "purge-global-mcps.mjs",
  "scrub-spawn-prompt.mjs",
  "scrub-text-lib.mjs",
  "session-map.mjs",
  "sync-global-settings.mjs",
  "board.mjs",
  "browser.mjs",
  "feature-packs.mjs",
  "speak.mjs",
  "listen.mjs",
  "jev.mjs",
  "google-workspace.mjs",
  "interactive.mjs",
  "prompt.mjs",
  "setup.mjs",
  "doctor.mjs",
  "clean.mjs",
  "vscode-tasks.mjs",
  "workspace-root.mjs",
  "gitignore-guard.mjs",
  "worktree.mjs",
  "skill-conflicts.mjs",
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
export function toScriptName(k) {
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
const OWNED_HOOK_FILES = [
  "scrub-spawn-prompt.mjs",
  "gate-fat-tools.mjs",
  "orchestrate-parent.js",
  "session-map.mjs",
  "worktree.mjs",
]

function sortKeys(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]))
}

export function samePath(a, b) {
  try {
    return fs.realpathSync.native(a) === fs.realpathSync.native(b)
  } catch {
    return path.resolve(a) === path.resolve(b)
  }
}

const GITIGNORE_ENTRIES = [
  { re: /^\.tmp\/?$/, line: ".tmp/" },
  { re: /^\/?\.worktrees\/?$/, line: ".worktrees/" },
]

function rmQuiet(abs) {
  fs.rmSync(abs, { recursive: true, force: true })
}

/** Remove reserved skill names the package no longer ships: the source dir and its `.claude/skills` link. */
export function pruneRetired(dest, { pkgRoot }) {
  const root = path.resolve(dest)
  const packaged = new Set(listSkillDirNames(path.join(path.resolve(pkgRoot), SKILLS_SOURCE_REL)))
  for (const name of RESERVED_SKILLS) {
    if (packaged.has(name)) continue
    rmQuiet(path.join(root, SKILLS_SOURCE_REL, name))
    rmQuiet(path.join(root, CLAUDE_SKILLS_REL, name))
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

export function destAlreadyInited(dest) {
  return (
    fs.existsSync(path.join(dest, ".grok", "hooks", "orchestrate-parent.js")) ||
    fs.existsSync(path.join(dest, ".rulesync"))
  )
}

export function mergeGuardedMarkdown(dest, pkgRoot, file, { alreadyInited = false } = {}) {
  void alreadyInited
  const src = path.join(pkgRoot, file)
  const d = path.join(dest, file)
  if (samePath(src, d)) return
  const srcText = fs.readFileSync(src, "utf8")
  return writeMergedGuardedFile(d, extractManagedBody(srcText) ?? srcText)
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

// A command repo wrote: one of its scripts, or a run of a repo: script. Not any `bun run`, which a
// repo's own `bun run build && …` would match, and its script would be taken over as repo's.
function looksOwnedPrefix(prefix) {
  return /rulesync|sync:globals|^bun run repo:|guarded-roots\.mjs|hooks-union\.mjs|doctor\.mjs|clean\.mjs|sync-global-settings\.mjs|check-globals\.mjs|purge-global-mcps\.mjs/.test(
    prefix,
  )
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
      if (!looksOwnedPrefix(prefix)) return null
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
  if (looksOwnedPrefix(cur)) return newSrc
  return cur
}

function hasE2eConfig(dest) {
  return E2E_VITEST_CONFIGS.some((name) => fs.existsSync(path.join(dest, name)))
}

export function snapshotReferenceDocs(dest) {
  const dir = path.join(dest, REFERENCE_REL)
  const snap = {}
  if (!fs.existsSync(dir)) return snap
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".md") || GENERATED_MAP_FILES.has(name)) continue
    const abs = path.join(dir, name)
    if (!fs.statSync(abs).isFile()) continue
    snap[name] = fs.readFileSync(abs, "utf8")
  }
  return snap
}

export function remergeReferenceDocs(dest, snap, pkgRoot, skip = new Set()) {
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

export function placeDevDependency(destPkg, srcPkg) {
  const deps =
    destPkg.dependencies && typeof destPkg.dependencies === "object"
      ? destPkg.dependencies
      : null
  destPkg.devDependencies = { ...(destPkg.devDependencies || {}) }
  const fromDep = deps?.[PACKAGE_NAME]
  const fromDev = destPkg.devDependencies[PACKAGE_NAME]
  if (fromDep != null && deps) {
    delete destPkg.dependencies[PACKAGE_NAME]
    if (fromDev == null) destPkg.devDependencies[PACKAGE_NAME] = fromDep
    if (Object.keys(destPkg.dependencies).length === 0) delete destPkg.dependencies
  }
  if (
    destPkg.devDependencies[PACKAGE_NAME] == null &&
    srcPkg?.name === PACKAGE_NAME &&
    srcPkg.version
  ) {
    destPkg.devDependencies[PACKAGE_NAME] = srcPkg.version
  }
}

export function mergePackageJson(dest, pkgRoot) {
  const destPath = path.join(dest, "package.json")
  let destPkg = {}
  if (fs.existsSync(destPath)) {
    destPkg = JSON.parse(fs.readFileSync(destPath, "utf8"))
  }
  if (destPkg.name === "@workerstack/repo") return

  const srcPkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8"))
  destPkg.scripts = { ...(destPkg.scripts || {}) }
  for (const [k, v] of Object.entries(srcPkg.scripts || {})) {
    if (k === "test" || k.endsWith(":raw")) continue
    const destKey = toScriptName(k)
    const current = destPkg.scripts[destKey]
    if (k === "test:e2e" && current == null) {
      // A repo that runs its own e2e keeps it as the only one: repo's would rerun it without the
      // repo's own steps (a build first, say).
      if (destPkg.scripts[k] != null) {
        console.warn(`script \`${k}\` is the repo's own; not writing \`${destKey}\``)
        continue
      }
      if (!hasE2eConfig(dest)) continue
    }
    destPkg.scripts[destKey] = current != null ? mergeScriptValue(v, current) : v
  }
  destPkg.devDependencies = { ...(destPkg.devDependencies || {}) }
  destPkg.devDependencies["smol-toml"] = srcPkg.dependencies["smol-toml"]
  destPkg.devDependencies["rulesync"] = srcPkg.devDependencies["rulesync"]
  const clack = srcPkg.dependencies?.["@clack/prompts"]
  if (clack) destPkg.devDependencies["@clack/prompts"] = clack
  placeDevDependency(destPkg, srcPkg)
  destPkg.scripts = sortKeys(destPkg.scripts)
  destPkg.devDependencies = sortKeys(destPkg.devDependencies)
  fs.writeFileSync(destPath, `${JSON.stringify(destPkg, null, 2)}\n`)
}

/**
 * Recursive overwrite copy, filtered per path.
 * @param {string} src
 * @param {string} dest
 * @param {(path: string) => boolean} [filter] Return false to skip a path (and its subtree).
 * @returns {void}
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

/**
 * @typedef {object} InitOptions
 * @property {string} [pkgRoot] Package root to copy from; defaults to this package.
 * @property {(cmd: string, args: string[], opts: import("node:child_process").ExecFileSyncOptions) => unknown} [execFileSync]
 *   Runs the bun steps; throws on a non-zero exit. Defaults to the cross-spawn based `execFileSync`.
 * @property {boolean} [skipGlobals] Skip the `sync:globals:apply` step.
 * @property {(name: string, state: "start" | "stop") => void} [onPhase] Called around each step.
 * @property {string[]} [packs] Feature packs to install; an array (even empty) is an answer, omitted keeps the saved choice.
 */

/**
 * Merge the package into `dest`, then install, generate, sync globals, and check there.
 * @param {string} dest Workspace to initialise.
 * @param {InitOptions} [options]
 * @returns {void}
 */
export function init(dest, { pkgRoot: pkgRootOpt, execFileSync: exec = execFileSync, skipGlobals = false, onPhase, packs } = {}) {
  dest = path.resolve(dest)
  const pkgRoot = path.resolve(pkgRootOpt ?? PKG_ROOT)

  const phase = (name, fn) => {
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
  const allowPack = (src) => !isUnselectedPackPath(path.relative(pkgRoot, src), selected)

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
    mergeGitignore(dest)

    if (!self) {
      remergeReferenceDocs(dest, refSnap, pkgRoot, unselectedRefNames(selected))
      mergePackageJson(dest, pkgRoot)
      copyRootIfMissing(dest, pkgRoot)
      for (const rel of unselectedPackRels(selected)) {
        fs.rmSync(path.join(dest, rel), { recursive: true, force: true })
      }
      if (selection.answered) writePacks(dest, selection.packs)
      emitDestMaps(dest)
    }
  })

  // Self-skip: file/dir merge + .tmp + gitignore only. No package.json merge,
  // install, or generate/sync/check (would mutate this package in-place).
  if (self) return

  const bun = (name, args) => {
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
