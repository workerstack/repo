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

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

const PRODUCT_SCRIPTS = [
  "check-globals.mjs",
  "emit-agent-shell-tools.mjs",
  "emit-gemini.mjs",
  "emit-maps.mjs",
  "guarded-roots.mjs",
  "emit-mcp-policy.mjs",
  "gate-fat-tools.mjs",
  "hooks-union.mjs",
  "pipeline.mjs",
  "grunt-job.mjs",
  "grunt-config.mjs",
  "parse-need.mjs",
  "persist-handoff.mjs",
  "persist-tmp.mjs",
  "persist-plan.mjs",
  "purge-global-mcps.mjs",
  "scrub-spawn-prompt.mjs",
  "scrub-text-lib.mjs",
  "sync-global-settings.mjs",
  "browser.mjs",
  "speak.mjs",
  "listen.mjs",
  "google-workspace.mjs",
  "doctor.mjs",
  "skill-conflicts.mjs",
  "scrub-text",
]

const COPY_DIRS = [".rulesync", ".grok", ".codex", ".claude", ".agents"]
export const RETIRED_SKILLS = ["parent", "solo", "cascade"]
export const RETIRED_AGENTS = ["implementer", "thinker"]
/** Cumulative. Dest `scripts/<name>` deleted on init/upgrade even if no longer shipped. */
export const RETIRED_SCRIPTS = ["telemetry.mjs"]
/** Repo-relative paths grunt used to ship. Deleted on init/upgrade. Consumer extras elsewhere kept. */
export const RETIRED_PATHS = [".grok/parent.md", ".grok/skills/shared"]
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
export const GUARDED_ROOT_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]
// .mcp.json is intentionally not copied here: scripts/emit-mcp-policy.mjs
// (run via consumer `grunt:rulesync:generate`, see mergeClaudeSettings ordering) owns and
// merges it, so a plain-copy would just be clobbered/redundant.
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
const OWNED_HOOK_FILES = ["scrub-spawn-prompt.mjs", "gate-fat-tools.mjs", "orchestrate-parent.js"]
export const SENTINEL_BEGIN = "<!-- grunt:begin -->"
export const SENTINEL_END = "<!-- grunt:end -->"
export const MAX_GUARDED_MARKDOWN_BYTES = 2 * 1024 * 1024
const GRUNT_REGION_RE =
  /(?:^|(?<=\n)|(?<=\r\n))[ \t]*<!-- grunt:begin -->[ \t]*\r?\n?[\s\S]*?(?:^|(?<=\n)|(?<=\r\n))[ \t]*<!-- grunt:end -->[ \t]*\r?\n?/g
const GRUNT_INTERIOR_RE =
  /(?:^|(?<=\n)|(?<=\r\n))[ \t]*<!-- grunt:begin -->[ \t]*\r?\n?([\s\S]*?)(?:^|(?<=\n)|(?<=\r\n))[ \t]*<!-- grunt:end -->/g
const ORPHAN_END_RE = /(?:^|\r?\n)[ \t]*<!-- grunt:end -->[ \t]*(?=\r?\n|$)|<!-- grunt:end -->/g
const BEGIN_LINE_RE = /^[ \t]*<!-- grunt:begin -->[ \t]*$/
const END_LINE_RE = /^[ \t]*<!-- grunt:end -->[ \t]*$/

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

const GITIGNORE_ENTRIES = [
  { re: /^\.tmp\/?$/, line: ".tmp/" },
  {
    re: /^\.rulesync\/grunt\.config\.local\.jsonc$/,
    line: ".rulesync/grunt.config.local.jsonc",
  },
]

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

function detectNewline(text) {
  return String(text).includes("\r\n") ? "\r\n" : "\n"
}

function toNewline(text, nl) {
  return String(text).replace(/\r\n/g, "\n").replace(/\n/g, nl)
}

function trimTrailingNewlines(text) {
  return String(text).replace(/(?:\r?\n)+$/, "")
}

function normEq(a, b) {
  return trimTrailingNewlines(String(a).replace(/\r\n/g, "\n")) ===
    trimTrailingNewlines(String(b).replace(/\r\n/g, "\n"))
}

function cloneRe(re) {
  return new RegExp(re.source, re.flags)
}

function inspectGuardedBuffer(buf) {
  if (buf.length > MAX_GUARDED_MARKDOWN_BYTES) return "huge"
  if (buf.includes(0)) return "binary"
  return null
}

export function extractUserMarkdown(text) {
  let user = String(text).replace(cloneRe(GRUNT_REGION_RE), "")
  const i = user.indexOf(SENTINEL_BEGIN)
  if (i >= 0) user = user.slice(0, i)
  user = user.replace(cloneRe(ORPHAN_END_RE), "")
  return userRemainderIsBlank(user) ? "" : user
}

function unwrapStackedMarkers(text) {
  const lines = String(text).split(/\r?\n/)
  let start = 0
  let end = lines.length
  while (start < end && BEGIN_LINE_RE.test(lines[start])) start++
  while (end > start && lines[end - 1] === "") end--
  while (end > start && END_LINE_RE.test(lines[end - 1])) {
    end--
    while (end > start && lines[end - 1] === "") end--
  }
  return lines.slice(start, end).join("\n")
}

export function extractGruntBody(text) {
  const src = String(text)
  const parts = []
  const re = cloneRe(GRUNT_INTERIOR_RE)
  let m
  while ((m = re.exec(src))) {
    parts.push(trimTrailingNewlines(unwrapStackedMarkers(m[1])))
  }
  if (parts.length) return parts.join("\n")
  const i = src.indexOf(SENTINEL_BEGIN)
  if (i >= 0) {
    return trimTrailingNewlines(
      unwrapStackedMarkers(src.slice(i + SENTINEL_BEGIN.length).replace(/^[ \t]*\r?\n/, "")),
    )
  }
  if (!src.includes(SENTINEL_END)) return null
  return trimTrailingNewlines(unwrapStackedMarkers(src))
}

function userRemainderIsBlank(user) {
  return String(user).replace(/\r\n/g, "\n").replace(/\n/g, "") === ""
}

export function composeGuardedMarkdown(gruntBody, userRemainder, nl = "\n") {
  const raw = extractGruntBody(gruntBody) ?? gruntBody
  const body = toNewline(trimTrailingNewlines(raw), nl)
  const block = `${SENTINEL_BEGIN}${nl}${body}${nl}${SENTINEL_END}${nl}`
  const user = extractUserMarkdown(userRemainder == null ? "" : String(userRemainder))
  if (!user || userRemainderIsBlank(user)) return block
  return block + toNewline(user, nl)
}

export function mergeGuardedContent(existingText, gruntBody) {
  const existing = existingText == null ? "" : String(existingText)
  const nl = existing.includes("\r\n") || String(gruntBody).includes("\r\n")
    ? detectNewline(existing || gruntBody)
    : "\n"
  if (!existing) return composeGuardedMarkdown(gruntBody, "", nl)
  const hadSentinel = existing.includes(SENTINEL_BEGIN) && existing.includes(SENTINEL_END)
  const user = extractUserMarkdown(existing)
  if (!hadSentinel && normEq(existing, gruntBody)) {
    return composeGuardedMarkdown(gruntBody, "", nl)
  }
  return composeGuardedMarkdown(gruntBody, user, nl)
}

export function writeMergedGuardedFile(destPath, gruntBody) {
  if (!fs.existsSync(destPath)) {
    fs.writeFileSync(destPath, mergeGuardedContent("", gruntBody))
    return
  }
  const buf = fs.readFileSync(destPath)
  if (inspectGuardedBuffer(buf)) return "aborted-unsafe"
  fs.writeFileSync(destPath, mergeGuardedContent(buf.toString("utf8"), gruntBody))
}

export function guardedMarkdownDrift(destPath, gruntBody) {
  if (!fs.existsSync(destPath)) return true
  const buf = fs.readFileSync(destPath)
  if (inspectGuardedBuffer(buf)) return true
  const text = buf.toString("utf8")
  const interior = extractGruntBody(text)
  if (interior == null) return !normEq(text, gruntBody)
  return !normEq(interior, gruntBody)
}

export function mergeGuardedMarkdown(dest, pkgRoot, file, { alreadyInited = false } = {}) {
  void alreadyInited
  const src = path.join(pkgRoot, file)
  const d = path.join(dest, file)
  if (samePath(src, d)) return
  const srcText = fs.readFileSync(src, "utf8")
  return writeMergedGuardedFile(d, extractGruntBody(srcText) ?? srcText)
}

export function snapshotGuardedRoots(root) {
  const snap = {}
  for (const file of GUARDED_ROOT_FILES) {
    const p = path.join(root, file)
    if (!fs.existsSync(p)) continue
    const buf = fs.readFileSync(p)
    const unsafe = inspectGuardedBuffer(buf)
    if (unsafe) {
      snap[file] = { unsafe, rawBuf: buf }
      continue
    }
    const raw = buf.toString("utf8")
    snap[file] = { raw, user: extractUserMarkdown(raw) }
  }
  return snap
}

export function remergeGuardedRoots(root, snap) {
  for (const file of GUARDED_ROOT_FILES) {
    const p = path.join(root, file)
    const rec = snap[file]
    if (rec?.unsafe) {
      fs.writeFileSync(p, rec.rawBuf)
      continue
    }
    if (!fs.existsSync(p)) {
      if (rec?.raw != null) fs.writeFileSync(p, rec.raw)
      continue
    }
    const buf = fs.readFileSync(p)
    if (inspectGuardedBuffer(buf)) {
      if (rec?.raw != null) fs.writeFileSync(p, rec.raw)
      continue
    }
    const current = buf.toString("utf8")
    if (rec && current === rec.raw) continue
    const gruntBody = extractGruntBody(current) ?? current
    const nl = detectNewline((rec && rec.raw) || current)
    let user = rec ? rec.user : extractUserMarkdown(current)
    if (rec && !rec.raw.includes(SENTINEL_BEGIN) && normEq(rec.raw, gruntBody)) user = ""
    if (!rec && extractGruntBody(current) == null && normEq(current, gruntBody)) user = ""
    fs.writeFileSync(p, composeGuardedMarkdown(gruntBody, user, nl))
  }
}

export function healGuardedRootFile(root, file, snap) {
  if (!GUARDED_ROOT_FILES.includes(file)) return
  const p = path.join(root, file)
  const rec = snap[file]
  if (!fs.existsSync(p)) return
  if (rec?.unsafe) {
    fs.writeFileSync(p, rec.rawBuf)
    return
  }
  const buf = fs.readFileSync(p)
  if (inspectGuardedBuffer(buf)) {
    if (rec?.raw != null) fs.writeFileSync(p, rec.raw)
    return
  }
  const current = buf.toString("utf8")
  const interior = extractGruntBody(current)
  if (interior != null) {
    snap[file] = { raw: current, user: extractUserMarkdown(current) }
    return
  }
  if (rec && current === rec.raw) return
  const gruntBody = current
  const nl = detectNewline((rec && rec.raw) || current)
  let user = rec ? rec.user : extractUserMarkdown(current)
  if (rec && !rec.raw.includes(SENTINEL_BEGIN) && normEq(rec.raw, gruntBody)) user = ""
  if (!rec && normEq(current, gruntBody)) user = ""
  const out = composeGuardedMarkdown(gruntBody, user, nl)
  fs.writeFileSync(p, out)
  snap[file] = { raw: out, user }
}

export function withGuardedCheckInteriors(root, fn) {
  const snap = snapshotGuardedRoots(root)
  try {
    for (const file of GUARDED_ROOT_FILES) {
      const rec = snap[file]
      if (!rec || rec.unsafe) continue
      const body = extractGruntBody(rec.raw)
      if (body == null) continue
      const nl = detectNewline(rec.raw)
      fs.writeFileSync(path.join(root, file), `${toNewline(trimTrailingNewlines(body), nl)}${nl}`)
    }
    return fn()
  } finally {
    for (const file of GUARDED_ROOT_FILES) {
      const rec = snap[file]
      if (!rec) continue
      if (rec.unsafe) fs.writeFileSync(path.join(root, file), rec.rawBuf)
      else fs.writeFileSync(path.join(root, file), rec.raw)
    }
  }
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
    destPerms[key] = merged
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
  return /rulesync|sync:globals|^npm run |guarded-roots\.mjs|hooks-union\.mjs|doctor\.mjs|sync-global-settings\.mjs|check-globals\.mjs|purge-global-mcps\.mjs/.test(
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

function rewriteNpmRunRefs(scripts, srcKeys) {
  const keys = srcKeys
    .filter((k) => k !== toGruntScriptName(k))
    .sort((a, b) => b.length - a.length)
  if (!keys.length) return
  for (const name of Object.keys(scripts)) {
    let val = scripts[name]
    if (typeof val !== "string") continue
    for (const k of keys) {
      val = val.replace(
        new RegExp(`npm run ${escapeRe(k)}(?=$|\\s|;|&)`, "g"),
        `npm run ${toGruntScriptName(k)}`,
      )
    }
    scripts[name] = val
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
  rewriteNpmRunRefs(destPkg.scripts, srcKeys)
  destPkg.devDependencies = { ...(destPkg.devDependencies || {}) }
  destPkg.devDependencies["smol-toml"] = srcPkg.devDependencies["smol-toml"]
  destPkg.devDependencies["rulesync"] = srcPkg.devDependencies["rulesync"]
  destPkg.scripts = sortKeys(destPkg.scripts)
  destPkg.devDependencies = sortKeys(destPkg.devDependencies)
  fs.writeFileSync(destPath, `${JSON.stringify(destPkg, null, 2)}\n`)
}

export function init(dest, { pkgRoot: pkgRootOpt, execFileSync: exec = execFileSync, skipGlobals = false, applyGlobals, onPhase } = {}) {
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
        fs.cpSync(src, d, {
          recursive: true,
          force: true,
          filter: (s) => path.basename(s) !== "settings.json",
        })
        mergeClaudeSettings(dest, pkgRoot)
      } else {
        fs.cpSync(src, d, { recursive: true, force: true })
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
      const st = fs.statSync(src)
      if (st.isDirectory()) fs.cpSync(src, d, { recursive: true, force: true })
      else fs.copyFileSync(src, d)
    }

    fs.mkdirSync(path.join(dest, ".tmp"), { recursive: true })
    mergeGitignore(dest)

    if (!self) mergePackageJson(dest, pkgRoot)
  })

  // Self-skip: file/dir merge + .tmp + gitignore only. No package.json merge,
  // npm install, or generate/sync/check (would mutate this package in-place).
  if (self) return

  const runNpm = (name, args) => {
    onPhase?.(name, "start")
    onPhase?.(name, "stop")
    exec("npm", args, { cwd: dest, stdio: "inherit" })
  }
  runNpm("install", ["install"])
  const guardedSnap = snapshotGuardedRoots(dest)
  runNpm("generate", ["run", toGruntScriptName("rulesync:generate")])
  remergeGuardedRoots(dest, guardedSnap)
  if (!skipGlobalsApply) {
    runNpm("sync-globals", ["run", toGruntScriptName("sync:globals:apply")])
  }
  withGuardedCheckInteriors(dest, () => {
    runNpm("check", ["run", toGruntScriptName("rulesync:check")])
  })
}
