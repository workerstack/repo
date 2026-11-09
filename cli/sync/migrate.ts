import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { extraH2Sections, extractUserMarkdown } from "./agents-text.ts";
import { emitYaml, parseDoc } from "./agents/frontmatter.ts";
import { stripJsonc } from "../scripts/jsonc.ts";
import { CONFIG_FILE, SKILL_PACKS, loadConfig, type ResolvedConfig, type SkillPack } from "../config.ts";
import { spawnSync } from "../spawn.ts";
import { untrackedEntries } from "./git-files.ts";
import { isHostOutput } from "./hosts.ts";
import { normalizeRel } from "./manifest.ts";
import type { Output } from "./outputs.ts";
import { PACKAGE_NAME } from "./stock.ts";
import { HOOK_COMMANDS_KEY, hashText, hookCommands, readStockHistory, type StockHistory } from "./stock-history.ts";

/** The file only a copied install has; it goes last, so a crash always leaves the next run what it needs to resume. */
export const COPIED_MARKER = ".rulesync/scripts/workspace-root.ts";

/**
 * One thing the migration does. Paths are root-relative with `/`. A step is a no-op once done and is planned only
 * while its source is still there, so a run that stopped anywhere is finished by planning again.
 */
export type MigrationStep =
  /**
   * Moves a file or dir; `except` names direct children that stay. `note` is the line printed. A `mark` is written
   * to its source path first, so the moved file says `overrides:` and a run that stopped between the two is finished
   * by planning again.
   */
  | { kind: "move"; from: string; to: string; except?: readonly string[]; note: string; mark?: { path: string; content: string; note: string } }
  /** Writes a file. `note` is the line printed. */
  | { kind: "write"; path: string; content: string; note: string }
  /** Prints a line for something the user must do by hand. */
  | { kind: "note"; note: string }
  /**
   * A destination that already holds other text, or (with `line`) a file of the user's that cannot move; any of
   * these stops the run before it changes anything.
   */
  | { kind: "conflict"; from: string; to: string; line?: string }
  /** `git rm -r --cached` of generated paths that are tracked. */
  | { kind: "untrack"; paths: string[] }
  /** Removes stock copies, then the copied `.rulesync/` with the marker last. */
  | { kind: "remove"; paths: string[] };

/** Seams for tests: which of `paths` git tracks (null when there is no git), and a crash after step `index`. */
export type MigrateDeps = {
  tracked?: (root: string, paths: string[]) => string[] | null;
  /** The hashes of past stock files; the shipped table when omitted. */
  history?: StockHistory;
  afterStep?: (index: number) => void;
};

const PREFIX = "repo sync: ";
const COPIED_DIR = ".rulesync";
const REPO_DIR = ".repo";
const REFERENCES_DIR = "references";
const REPLACES = " (it now replaces the stock one)";
/** Files older inits generated into `.rulesync/reference`; never the consumer's. */
const OLD_GENERATED_REFS = new Set(["law.md", "INDEX.md", "skills-map.md", "refs-map.md"]);
/** Entries of the copied dir with a rule of their own; any other entry moves to the same name under `.repo/`. */
const HANDLED = new Set([
  "rules",
  "subagents",
  "lessons",
  "hooks.jsonc",
  "mcp-policy.jsonc",
  "permissions.json",
  "global-settings",
  "reference",
  "repo.features.jsonc",
  "repo.pipeline.jsonc",
  "scripts",
  "settings",
]);
const RULE_FRONTMATTER = "---\ndescription: Carried over from your earlier setup\n---\n";

/**
 * The steps that move a copied install's own content to `.repo/` and `references/`, untrack its generated paths and
 * remove the copy. Empty without the copied-install marker, or while the stock package is not installed. `generated`
 * is the text sync plans for each generated file (see `generatedFiles`): the package ships no generated trees, so
 * it is the stock version of those files. `ignored` is the git ignore entries of the untracked outputs (see
 * `untrackedEntries`), whose tracked files are untracked.
 */
export function planMigration(
  root: string,
  stock: string,
  generated: ReadonlyMap<string, string>,
  ignored: readonly string[],
  deps: MigrateDeps = {},
): MigrationStep[] {
  if (!present(path.join(root, COPIED_MARKER)) || !present(path.join(stock, "package.json"))) return [];
  const plan = new Plan(root, stock, generated, deps.history ?? readStockHistory());
  plan.rules();
  plan.subagents();
  plan.skills();
  plan.references();
  plan.agentsText();
  plan.claudeSettings();
  plan.lessons();
  plan.overrides();
  plan.copies();
  plan.leftovers();
  plan.packs();
  plan.untrack(ignored, deps.tracked ?? gitTracked);
  plan.remove();
  return plan.steps;
}

/**
 * The steps that keep what a consumer already has where sync is about to generate. `outputs` are what the generators
 * plan for the current overlay and `manifest` the paths the last sync wrote: a path in the manifest is ours, and a
 * file equal to its output or to a stock version holds nothing of the user's. Text that can move goes to `.repo/`
 * (the AGENTS.md text, the settings keys and hooks, the MCP servers, a real skill dir); a tracked file under a
 * host dir, or a host file sync would overwrite, that cannot move stops the run with one line per file.
 */
export function planAdoption(
  root: string,
  stock: string,
  config: ResolvedConfig,
  outputs: readonly Output[],
  manifest: readonly string[],
  deps: MigrateDeps = {},
): MigrationStep[] {
  const plan = new Plan(root, stock, generatedFiles(outputs), deps.history ?? readStockHistory());
  plan.adopt(config, outputs, new Set(manifest), deps.tracked ?? gitTracked);
  return plan.steps;
}

/** The text of each file among `outputs`, by path. */
export function generatedFiles(outputs: readonly Output[]): Map<string, string> {
  return new Map(outputs.flatMap((output) => (output.kind === "file" ? [[output.path, output.content] as const] : [])));
}

/** The host skill dirs an old install could hold real copies of stock skills in. */
const HOST_SKILL_DIRS = [".agents/skills/", ".claude/skills/"];

/**
 * Where the stock package keeps the file a copied install has at `rel`: its copied `.rulesync/scripts` are
 * `cli/scripts`, the rest of `.rulesync/` is under `agents/`, and a skill in either host skill dir is in
 * `agents/skills`. Other paths are the same.
 */
function stockRel(rel: string): string {
  if (rel.startsWith(`${COPIED_DIR}/scripts/`)) return `cli/scripts/${rel.slice(COPIED_DIR.length + "/scripts/".length)}`;
  if (rel.startsWith(`${COPIED_DIR}/`)) return `agents/${rel.slice(COPIED_DIR.length + 1)}`;
  const skills = HOST_SKILL_DIRS.find((dir) => rel.startsWith(dir));
  return skills === undefined ? rel : `agents/skills/${rel.slice(skills.length)}`;
}

/** The `repo sync:` lines for every conflict among `steps`, one each; empty when there is none. */
export function conflictLines(steps: readonly MigrationStep[]): string[] {
  return steps.flatMap((step) =>
    step.kind === "conflict"
      ? [step.line ?? `${PREFIX}cannot move ${step.from}: ${step.to} already exists and differs; merge them by hand, then run \`bun repo sync\``]
      : [],
  );
}

/** The paths git tracks, as root-relative `/` spellings: backslashes, a drive prefix and `./` all read the same. */
export function trackedRels(raw: readonly string[], root: string): string[] {
  return raw.flatMap((entry) => normalizeRel(entry, root) ?? []);
}

/**
 * Runs `steps` in order and returns the `repo sync:` lines. With a conflict among them it changes nothing and
 * returns the conflict lines. A failure throws; the marker is still there, so the next run plans what is left.
 */
export async function applyMigration(
  root: string,
  steps: readonly MigrationStep[],
  deps: MigrateDeps = {},
): Promise<string[]> {
  const conflicts = conflictLines(steps);
  if (conflicts.length > 0) return conflicts;
  const lines: string[] = [];
  let untracked: string[] = [];
  let removed = false;
  // No conflict survives the early return, so the loop sees only the steps that act.
  const acting = steps.filter((step): step is Exclude<MigrationStep, { kind: "conflict" }> => step.kind !== "conflict");
  for (const [index, step] of acting.entries()) {
    if (step.kind === "move") {
      if (step.mark !== undefined) writeAtomic(path.join(root, step.mark.path), step.mark.content);
      moveTree(path.join(root, step.from), path.join(root, step.to), step.except ?? []);
      lines.push(`${PREFIX}${step.note}`);
      if (step.mark !== undefined) lines.push(`${PREFIX}${step.mark.note}`);
    } else if (step.kind === "write") {
      lines.push(...(await writeStep(root, step)).split("\n").map((line) => `${PREFIX}${line}`));
    } else if (step.kind === "note") {
      lines.push(`${PREFIX}${step.note}`);
    } else if (step.kind === "untrack") {
      untrack(root, step.paths);
      untracked = step.paths;
    } else {
      removeAll(root, step.paths);
      removed = true;
    }
    deps.afterStep?.(index);
  }
  const parts = [
    ...(untracked.length > 0 ? [`untracked ${untracked.join(", ")} (now generated)`] : []),
    ...(removed ? [`removed the copied ${COPIED_DIR}/`] : []),
  ];
  if (parts.length > 0) lines.push(`${PREFIX}${parts.join(" and ")}${untracked.length > 0 ? "; commit the result" : ""}`);
  return lines;
}

class Plan {
  readonly steps: MigrationStep[] = [];
  private readonly drop: string[] = [];

  constructor(
    private readonly root: string,
    private readonly stock: string,
    private readonly generated: ReadonlyMap<string, string>,
    private readonly history: StockHistory,
  ) {}

  /** Rules the stock lacks move over; a stock rule's own `##` sections go to a `-local` sibling, so stock stays live. */
  rules(): void {
    for (const name of this.names(`${COPIED_DIR}/rules`)) {
      const from = `${COPIED_DIR}/rules/${name}`;
      const stockText = this.stockText(from);
      const own = isDir(path.join(this.root, from)) ? null : this.text(from);
      if (own !== null && this.unedited(from, own, stockText)) continue;
      const to = `${REPO_DIR}/rules/${name}`;
      if (own === null || stockText === null) {
        this.move(from, to, `moved ${from} to ${to}`);
        continue;
      }
      const extras = extraH2Sections(own, stockText);
      if (extras === "") {
        this.move(from, to, `moved your edited ${from} to ${to} (it now replaces the stock rule)`, [], this.mark(from, to, name.replace(/\.md$/, ""), "rule"));
        continue;
      }
      const heading = h1Of(stockText);
      const local = `${REPO_DIR}/rules/${name.replace(/\.md$/, "")}-local.md`;
      const content = `${RULE_FRONTMATTER}${heading === null ? "" : `${heading}\n\n`}${extras}\n`;
      this.write(from, local, content, `moved your sections ${titlesOf(extras)} of ${from} to ${local}`);
    }
  }

  /** Subagents the stock lacks move over; an edited stock subagent moves whole and overrides stock. */
  subagents(): void {
    for (const name of this.names(`${COPIED_DIR}/subagents`)) {
      const from = `${COPIED_DIR}/subagents/${name}`;
      const stockText = this.stockText(from);
      const isFolder = isDir(path.join(this.root, from));
      if (!isFolder && this.unedited(from, this.text(from), stockText)) continue;
      const to = `${REPO_DIR}/subagents/${name}`;
      if (stockText === null || isFolder) this.move(from, to, `moved ${from} to ${to}`);
      else {
        const mark = this.mark(from, to, name.replace(/\.md$/, ""), "subagent");
        this.move(from, to, `moved your edited ${from} to ${to} (it now replaces the stock subagent)`, [], mark);
      }
    }
  }

  /** Skill dirs the stock lacks or the consumer edited move to `.repo/skills`; the rest are stock copies to remove. */
  skills(): void {
    for (const name of this.names(".agents/skills")) {
      const from = `.agents/skills/${name}`;
      if (!isDir(path.join(this.root, from))) continue;
      const to = `${REPO_DIR}/skills/${name}`;
      if (!this.editedSkill(from)) this.drop.push(from);
      else if (!present(path.join(this.stock, stockRel(from)))) this.move(from, to, `moved ${from} to ${to}`);
      else this.move(from, to, `moved your edited ${from} to ${to} (it now replaces the stock skill)`, [], this.mark(`${from}/SKILL.md`, `${to}/SKILL.md`, name, "skill"));
    }
  }

  /** Whether a skill dir holds a file that is no stock version, so it is the consumer's. */
  private editedSkill(from: string): boolean {
    return filesUnder(path.join(this.root, from)).some((file) => {
      const rel = `${from}/${file}`;
      return !this.unedited(rel, this.text(rel), this.stockText(rel));
    });
  }

  /** `.rulesync/reference` follows the old init's rules; a consumer file goes to `references/` and extra sections too. */
  references(): void {
    const dir = `${COPIED_DIR}/reference`;
    const names = this.names(dir).filter((name) => !OLD_GENERATED_REFS.has(name));
    const stockNamed = (name: string) => name.endsWith(".md") && present(path.join(this.stock, REFERENCES_DIR, name));
    for (const name of [...names.filter(stockNamed), ...names.filter((n) => !stockNamed(n))]) {
      const from = `${dir}/${name}`;
      const to = `${REFERENCES_DIR}/${name}`;
      const stockText = this.stockText(to);
      // a file is a past or current stock copy under either of its names: where older inits put it, or where it lives now
      if (!isDir(path.join(this.root, from)) && this.unedited(from, this.text(from), stockText, [to])) continue;
      if (!stockNamed(name)) {
        this.move(from, to, `moved ${from} to ${to}`);
        continue;
      }
      const extras = extraH2Sections(this.text(from), stockText!);
      if (extras === "") {
        this.move(from, to, `moved your edited ${from} to ${to}`);
        continue;
      }
      const existing = this.read(to);
      const missing = existing === null ? extras : extraH2Sections(extras, existing);
      if (missing === "") continue;
      const content =
        existing === null ? `${h1Of(stockText!) ?? h1Of(this.text(from)) ?? `# ${name}`}\n\n${missing}\n` : `${existing.trimEnd()}\n\n${missing}\n`;
      this.steps.push({ kind: "write", path: to, content, note: `moved your sections ${titlesOf(missing)} of ${from} to ${to}` });
    }
  }

  /** AGENTS.md text outside the guarded block becomes the `agents` rule, which every host reads. */
  agentsText(): void {
    const text = this.read("AGENTS.md");
    const own = text === null || this.unedited("AGENTS.md", text, this.stockText("AGENTS.md")) ? "" : extractUserMarkdown(text).trim();
    if (own === "") return;
    const to = `${REPO_DIR}/rules/agents.md`;
    this.write("AGENTS.md", to, `${RULE_FRONTMATTER}${own}\n`, `moved your AGENTS.md text to ${to}`);
    // The text now lives in the rule; the stale file must not be there to be adopted again.
    this.drop.push("AGENTS.md");
  }

  /** `.claude/settings.json` keys the stock's own settings lack go to the overlay; `hooks` come from hooks.jsonc. */
  claudeSettings(): void {
    const rel = ".claude/settings.json";
    const raw = this.read(rel);
    if (raw !== null && this.unedited(rel, raw, this.stockText(rel))) return;
    const have = readJson(path.join(this.root, rel));
    if (have === null) {
      this.steps.push({
        kind: "note",
        note: `${rel} is not valid JSON; copy any keys of yours into ${REPO_DIR}/settings/claude.json`,
      });
      return;
    }
    const base = parseJson(this.stockText(rel));
    if (!isObject(have) || !isObject(base)) return;
    const { hooks, ...mine } = have;
    const paths: string[] = [];
    const extras = settingsExtras(mine, base, "", paths);
    const stockCommands = new Set(hookCommands(base));
    const known = (command: string) => stockCommands.has(command) || this.history[HOOK_COMMANDS_KEY]?.includes(hashText(command)) === true;
    const own = ownHooks(hooks, known);
    if (extras === undefined && own.events.length === 0) return;
    const to = `${REPO_DIR}/settings/claude.json`;
    const content = { ...(extras as object | undefined), ...(own.events.length > 0 ? { hooks: own.hooks } : {}) };
    const lines = [
      ...(paths.length > 0 ? [`moved your ${rel} keys ${paths.join(", ")} to ${to}`] : []),
      ...own.events.map(([event, count]) => `moved your ${rel} hooks ${event} (${count}) to ${to}`),
    ];
    this.write(rel, to, `${JSON.stringify(content, null, 2)}\n`, lines.join("\n"));
    this.drop.push(rel);
  }

  /**
   * What the consumer already keeps where sync generates, for a repo that never ran the copying init: see
   * `planAdoption`. Nothing it cannot move is left to be overwritten or hidden by the gitignore block.
   */
  adopt(
    config: ResolvedConfig,
    outputs: readonly Output[],
    owned: ReadonlySet<string>,
    tracked: (root: string, paths: string[]) => string[] | null,
  ): void {
    const { hosts } = config.agents;
    const ignored = untrackedEntries(hosts, outputs);
    const stops = new Set<string>();
    const stop = (rel: string) => stops.add(rel);
    const byPath = new Map(outputs.map((output) => [output.path, output]));
    const known = (rel: string, text: string) => this.unedited(rel, text, this.stockText(rel));

    const skillDirs: string[] = [];
    for (const dir of [".agents/skills", ".claude/skills"]) {
      if (!isHostOutput(hosts, `${dir}/x`)) continue;
      for (const name of this.names(dir)) {
        const from = `${dir}/${name}`;
        if (owned.has(from) || !isRealDir(path.join(this.root, from))) continue;
        skillDirs.push(from);
        if (!this.editedSkill(from)) continue;
        const to = `${REPO_DIR}/skills/${name}`;
        const stocked = present(path.join(this.stock, stockRel(from)));
        this.move(from, to, `moved ${from} to ${to}`, [], stocked ? this.mark(`${from}/SKILL.md`, `${to}/SKILL.md`, name, "skill") : undefined);
      }
    }
    const inSkillDir = (rel: string) => skillDirs.some((dir) => rel.startsWith(`${dir}/`));

    const adoptable = new Set(["AGENTS.md", ".mcp.json", ".claude/settings.json"]);
    for (const output of outputs) {
      if (owned.has(output.path) || !isHostOutput(hosts, output.path)) continue;
      const abs = path.join(this.root, output.path);
      const found = fs.lstatSync(abs, { throwIfNoEntry: false });
      if (found === undefined || found.isSymbolicLink() || skillDirs.includes(output.path)) continue;
      if (output.kind === "link" || found.isDirectory()) {
        stop(output.path);
        continue;
      }
      const text = this.text(output.path);
      if (same(text, output.content) || known(output.path, text)) continue;
      if (!adoptable.has(output.path)) stop(output.path);
      else if (output.path === "AGENTS.md") this.adoptAgents(text);
      else this.adoptJson(output.path, text, stop);
    }

    const rels = trackedRels(tracked(this.root, [...ignored]) ?? [], this.root);
    for (const rel of rels) {
      if (owned.has(rel) || byPath.has(rel) || adoptable.has(rel) || inSkillDir(rel) || !isHostOutput(hosts, rel)) continue;
      const found = fs.lstatSync(path.join(this.root, rel), { throwIfNoEntry: false });
      if (found === undefined || found.isSymbolicLink() || known(rel, this.text(rel))) continue;
      stop(rel);
    }

    for (const rel of [...stops].sort()) {
      this.steps.push({
        kind: "conflict",
        from: rel,
        to: "",
        line: `${PREFIX}${rel} is yours and would be ignored; move it under ${REPO_DIR}/ (see node_modules/${PACKAGE_NAME}/${REFERENCES_DIR}/map.md) or delete it, then run \`bun repo sync\``,
      });
    }
    if (stops.size === 0 && this.steps.length > 0) this.untrack(ignored, tracked);
  }

  /** The whole text of a hand-written AGENTS.md becomes the `agents` rule, which every host reads. */
  private adoptAgents(text: string): void {
    const own = extractUserMarkdown(text).trim();
    if (own === "") return;
    const to = `${REPO_DIR}/rules/agents.md`;
    this.write("AGENTS.md", to, `${RULE_FRONTMATTER}${own}\n`, `adopted your AGENTS.md as ${to}`);
  }

  /** Moves the keys of a hand-written settings or MCP file that sync does not generate; a file that is no JSON object stops the run. */
  private adoptJson(rel: string, text: string, stop: (rel: string) => void): void {
    let have: unknown;
    try {
      have = JSON.parse(text);
    } catch {
      have = null;
    }
    if (!isObject(have)) stop(rel);
    else if (rel === ".claude/settings.json") this.claudeSettings();
    else this.mcpServers(have);
  }

  /** `.mcp.json` servers the stock's own file lacks go to the overlay `trees` merges back. */
  private mcpServers(have: Record<string, unknown>): void {
    const base = parseJson(this.stockText(".mcp.json"));
    if (!isObject(base)) return;
    const paths: string[] = [];
    const extras = settingsExtras(have, base, "", paths);
    if (extras === undefined) return;
    const to = `${REPO_DIR}/mcp.json`;
    this.write(".mcp.json", to, `${JSON.stringify(extras, null, 2)}\n`, `moved your .mcp.json keys ${paths.join(", ")} to ${to}`);
  }

  /** Lessons move whole; their index is generated, so it stays behind for sync to rewrite. */
  lessons(): void {
    const from = `${COPIED_DIR}/lessons`;
    const names = this.names(from).filter((name) => name !== "INDEX.md");
    if (names.length === 0) return;
    const to = `${REPO_DIR}/lessons`;
    this.move(from, to, `moved ${from}/ (${names.length}) to ${to}/`, ["INDEX.md"]);
  }

  /** Hooks, MCP policy, permissions and global settings that differ from stock move to the same path under `.repo/`. */
  overrides(): void {
    const stockOf = (rel: string) => this.stockText(rel);
    const hooks = `${COPIED_DIR}/hooks.jsonc`;
    if (this.differs(hooks, stockOf(hooks))) {
      this.move(hooks, `${REPO_DIR}/hooks.jsonc`, `moved your ${hooks} to ${REPO_DIR}/hooks.jsonc (it now replaces the stock hooks)`);
    }
    const policy = `${COPIED_DIR}/mcp-policy.jsonc`;
    if (this.differs(policy, stockOf(policy))) {
      this.move(policy, `${REPO_DIR}/mcp-policy.jsonc`, `moved your ${policy} to ${REPO_DIR}/mcp-policy.jsonc`);
    }
    const permissions = `${COPIED_DIR}/permissions.json`;
    if (this.differs(permissions, stockOf(permissions))) {
      this.move(permissions, `${REPO_DIR}/permissions.json`, `moved your ${permissions} to ${REPO_DIR}/permissions.json`);
    }
    for (const name of this.names(`${COPIED_DIR}/global-settings`)) {
      const from = `${COPIED_DIR}/global-settings/${name}`;
      if (!isDir(path.join(this.root, from)) && !this.differs(from, stockOf(from))) continue;
      const to = `${REPO_DIR}/global-settings/${name}`;
      this.move(from, to, `moved your ${from} to ${to}${stockOf(from) === null ? "" : REPLACES}`);
    }
  }

  /**
   * Files of the copied dir that were never meant to be edited (scripts, the pipeline file, the settings base) go
   * only when they match no stock version; an edited or own file keeps its path under `.repo/`.
   */
  copies(): void {
    for (const dir of ["scripts", "settings"]) {
      const base = `${COPIED_DIR}/${dir}`;
      if (!isDir(path.join(this.root, base))) continue;
      for (const file of filesUnder(path.join(this.root, base))) {
        const from = `${base}/${file}`;
        if (from === COPIED_MARKER || this.unedited(from, this.text(from), this.stockText(from))) continue;
        const to = `${REPO_DIR}/${dir}/${file}`;
        this.move(from, to, `moved your ${from} to ${to}`);
      }
    }
    const pipeline = `${COPIED_DIR}/repo.pipeline.jsonc`;
    if (this.differs(pipeline, this.stockText(pipeline))) {
      this.move(pipeline, `${REPO_DIR}/repo.pipeline.jsonc`, `moved your ${pipeline} to ${REPO_DIR}/repo.pipeline.jsonc`);
    }
  }

  /** Anything else in the copied dir is the consumer's; it keeps its name under `.repo/`. */
  leftovers(): void {
    for (const name of this.names(COPIED_DIR).filter((entry) => !HANDLED.has(entry))) {
      this.move(`${COPIED_DIR}/${name}`, `${REPO_DIR}/${name}`, `moved ${COPIED_DIR}/${name} to ${REPO_DIR}/${name}`);
    }
  }

  /** The packs of `repo.features.jsonc` become `agents.skills` in the config. */
  packs(): void {
    const packs = this.featurePacks();
    const text = this.text(CONFIG_FILE);
    if (packs.length === 0 || configHasSkills(text, packs)) return;
    const list = `[${packs.map((pack) => JSON.stringify(pack)).join(", ")}]`;
    const open = /defineConfig\(\s*\{/.exec(text);
    if (open === null || /["']?\bagents\b["']?\s*:/.test(text)) {
      this.steps.push({
        kind: "note",
        note: `could not add the packs ${list} of ${COPIED_DIR}/repo.features.jsonc to ${CONFIG_FILE}; add agents: { skills: ${list} } there`,
      });
      return;
    }
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const at = open.index + open[0].length;
    const inserted = `${text.slice(0, at)}${eol}  agents: { skills: ${list} },${text.slice(at)}`;
    this.steps.push({
      kind: "write",
      path: CONFIG_FILE,
      content: withAgentsPack(inserted),
      note: `moved packs ${list} from ${COPIED_DIR}/repo.features.jsonc to agents.skills in ${CONFIG_FILE}`,
    });
  }

  /** The generated paths git still tracks; none outside git. */
  untrack(candidates: readonly string[], tracked: (root: string, paths: string[]) => string[] | null): void {
    const raw = tracked(this.root, [...candidates]);
    if (raw === null) return;
    const rels = trackedRels(raw, this.root);
    const paths = candidates.filter((entry) => rels.some((rel) => (entry.endsWith("/") ? rel.startsWith(entry) : rel === entry)));
    if (paths.length > 0) this.steps.push({ kind: "untrack", paths });
  }

  /** Last: the stock copies of skills, then the copied dir. */
  remove(): void {
    this.steps.push({ kind: "remove", paths: [...this.drop, COPIED_DIR] });
  }

  private featurePacks(): SkillPack[] {
    const text = this.read(`${COPIED_DIR}/repo.features.jsonc`);
    let packs: unknown;
    try {
      packs = (JSON.parse(stripJsonc(text ?? "")) as { packs?: unknown }).packs;
    } catch {
      return [];
    }
    const known = (Array.isArray(packs) ? packs : []).filter((pack): pack is SkillPack => (SKILL_PACKS as readonly unknown[]).includes(pack));
    return [...new Set(known)];
  }

  /** Moves `from` to `to`, or records the conflict when `to` already holds other text. */
  private move(from: string, to: string, note: string, except: readonly string[] = [], mark?: { path: string; content: string; note: string }): void {
    if (clashes(path.join(this.root, from), path.join(this.root, to), except)) this.steps.push({ kind: "conflict", from, to });
    else this.steps.push({ kind: "move", from, to, ...(except.length > 0 ? { except } : {}), note, ...(mark === undefined ? {} : { mark }) });
  }

  /** The mark for the file at `from` that moves to `to` and replaces a stock `kind`; undefined when it already says so or cannot be read. */
  private mark(from: string, to: string, name: string, kind: "rule" | "subagent" | "skill"): { path: string; content: string; note: string } | undefined {
    const text = this.read(from);
    const content = text === null ? null : markedText(text, name);
    if (content === null) return undefined;
    return { path: from, content, note: markNote(to, name, kind) };
  }

  /** Writes `content` to `to` for text taken from `from`; nothing to do when it is already there. */
  private write(from: string, to: string, content: string, note: string): void {
    const existing = this.read(to);
    if (existing === content || (existing !== null && alreadyHolds(to, existing, content))) return;
    if (existing !== null) this.steps.push({ kind: "conflict", from, to });
    else this.steps.push({ kind: "write", path: to, content, note });
  }

  private differs(rel: string, stockText: string | null): boolean {
    const own = this.read(rel);
    return own !== null && !this.unedited(rel, own, stockText);
  }

  /** Whether `text` is an unedited stock file: the stock's current one, or a version in the history table. */
  private unedited(rel: string, text: string, stockText: string | null, also: readonly string[] = []): boolean {
    if (stockText !== null && same(text, stockText)) return true;
    const hash = hashText(text);
    return [rel, ...also].some((key) => this.history[key]?.includes(hash) === true);
  }

  private names(rel: string): string[] {
    try {
      return fs.readdirSync(path.join(this.root, rel)).sort();
    } catch {
      return [];
    }
  }

  private read(rel: string): string | null {
    try {
      return fs.readFileSync(path.join(this.root, rel), "utf8");
    } catch {
      return null;
    }
  }

  /** A file the plan found by listing its dir. */
  private text(rel: string): string {
    return fs.readFileSync(path.join(this.root, rel), "utf8");
  }

  /** The stock version of the file at `rel`: the text sync generates there, else the package's file; null when neither has one. */
  private stockText(rel: string): string | null {
    const generated = this.generated.get(rel);
    if (generated !== undefined) return generated;
    try {
      return fs.readFileSync(path.join(this.stock, stockRel(rel)), "utf8");
    } catch {
      return null;
    }
  }

}

const markNote = (rel: string, name: string, kind: string) => `marked ${rel} with overrides: ${name} (it replaces the stock ${kind})`;

/** `text` with `overrides: name` as the first frontmatter key (or a new frontmatter block); null when it already has one. */
function markedText(text: string, name: string): string | null {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const bounds = frontmatterBounds(lines);
  if (bounds !== null) {
    try {
      if (parseDoc("", text).data["overrides"] !== undefined) return null;
    } catch {
      return null;
    }
  }
  const line = emitYaml([["overrides", name]]).trimEnd();
  return bounds === null ? ["---", line, "---", ...lines].join(eol) : [lines[0]!, line, ...lines.slice(1)].join(eol);
}

/** The lines between the fences as `[open, close]` indexes; null without a closed frontmatter block. */
function frontmatterBounds(lines: readonly string[]): [number, number] | null {
  if (lines[0]?.trimEnd() !== "---") return null;
  const close = lines.findIndex((line, i) => i > 0 && line.trimEnd() === "---");
  return close === -1 ? null : [0, close];
}

const OLD_KEYS = ["root", "targets", "globs"] as const;

/** `a`, `a and b` or `a, b and c`. */
function joinAnd(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The names under `<dir>/<kind>/` of a stock package, case-folded and without `.md`, nested paths included. */
function stockNames(stock: string, kind: "rules" | "subagents"): Set<string> {
  const dir = path.join(stock, "agents", kind);
  return new Set(isDir(dir) ? filesUnder(dir).filter((file) => file.endsWith(".md")).map((file) => file.slice(0, -3).toLowerCase()) : []);
}

/** The `.md` files under `<root>/.repo/<kind>`, POSIX paths relative to it, dot entries skipped, in string order. */
function ownDocs(root: string, kind: "rules" | "subagents"): string[] {
  const base = path.join(root, REPO_DIR, kind);
  if (!isDir(base)) return [];
  return filesUnder(base).filter((file) => file.endsWith(".md") && !file.split("/").some((part) => part.startsWith(".")));
}

/**
 * The steps that bring a `.repo/` rule or subagent still in the old format to the new one, once: a rule loses
 * `root`, `targets` and `globs` (`globs` become `paths`, none when they cover every file) and gains a `description`
 * from its first `#` heading, else its name; a subagent loses `root` and `globs`, and keeps `targets`, which its
 * generator still reads. Such a file that bears a stock name is marked `overrides: <name>`, since an earlier sync
 * let it replace the stock one. A file in the new format is never touched or marked, so a new same-name file still
 * fails. Each step is the whole new file, so it is planned only while the file is old and a second run plans nothing.
 * A file whose frontmatter does not parse is left for the loader to report.
 */
export function planRuleUpgrade(root: string, stock: string): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const kind of ["rules", "subagents"] as const) {
    const stocked = stockNames(stock, kind);
    for (const file of ownDocs(root, kind)) {
      const rel = `${REPO_DIR}/${kind}/${file}`;
      const text = fs.readFileSync(path.join(root, rel), "utf8");
      const name = file.slice(0, -3);
      const upgraded = upgradeText(text, name, kind, stocked.has(name.toLowerCase()));
      if (upgraded !== null) steps.push({ kind: "write", path: rel, content: upgraded.content, note: upgraded.notes.map((note) => note.replace("@", rel)).join("\n") });
    }
  }
  return steps;
}

/** The new text of an old-format rule or subagent and the lines to print for it (`@` stands for its path); null when it needs nothing. */
function upgradeText(text: string, name: string, kind: "rules" | "subagents", stocked: boolean): { content: string; notes: string[] } | null {
  let data: Record<string, unknown>;
  let body: string;
  try {
    ({ data, body } = parseDoc("", text));
  } catch {
    return null;
  }
  const carried = OLD_KEYS.filter((key) => key in data);
  if (carried.length === 0) return null;
  const isRule = kind === "rules";
  const removed = carried.filter((key) => isRule || key !== "targets");
  const dropped = [...removed];
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const [, close] = frontmatterBounds(lines)!;

  const top: [string, string | string[]][] = [];
  const parts: string[] = [];
  if (isRule) {
    if (typeof data["description"] !== "string" || data["description"].trim() === "") {
      top.push(["description", (/^#\s+(.+?)\s*#*\s*$/m.exec(body)?.[1] ?? name.split("/").at(-1)!).trim()]);
      parts.push("description added");
    }
    const globs = globList(data["globs"]);
    const everywhere = globs.some((glob) => glob === "**/*" || glob === "*");
    if (data["paths"] === undefined && globs.length > 0 && !everywhere) {
      top.push(["paths", globs]);
      parts.push("globs → paths");
      dropped.splice(dropped.indexOf("globs"), 1);
    }
  }
  const mark = stocked && data["overrides"] === undefined;
  if (mark) top.push(["overrides", name]);
  if (dropped.length > 0) parts.push(`${joinAnd(dropped)} dropped`);

  const kept: string[] = [];
  let skipping = false;
  for (const line of lines.slice(1, close)) {
    const key = /^([A-Za-z_]+)\s*:/.exec(line)?.[1];
    if (key !== undefined && removed.includes(key as (typeof OLD_KEYS)[number])) skipping = true;
    else if (skipping && (/^\s/.test(line) || /^-(\s|$)/.test(line))) continue;
    else {
      skipping = false;
      kept.push(line);
      continue;
    }
  }
  const head = emitYaml(top).split("\n").filter((line) => line !== "");
  const content = [lines[0]!, ...head, ...kept, ...lines.slice(close)].join(eol);
  const notes = [
    ...(parts.length > 0 ? [`rewrote @ frontmatter (${parts.join(", ")})`] : []),
    ...(mark ? [markNote("@", name, isRule ? "rule" : "subagent")] : []),
  ];
  return notes.length === 0 ? null : { content, notes };
}

/** Globs from a `globs` value: a list, or a comma-separated string. */
function globList(value: unknown): string[] {
  const items = Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(",") : [];
  return items.map((item) => item.trim()).filter((item) => item !== "");
}

/** The parsed file; undefined when it is missing, null when it is not valid JSON. */
function readJson(file: string): unknown {
  try {
    return parseJson(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** The JSON value of `text`: undefined for no text, null when it is not JSON. */
function parseJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What `have` holds that `base` does not, as the value to merge over `base` again, with the dotted path of each
 * piece in `paths`: new keys whole, list items `base` lacks, scalars that differ. Undefined when there is none.
 */
function settingsExtras(have: unknown, base: unknown, at: string, paths: string[]): unknown {
  if (Array.isArray(have) && Array.isArray(base)) {
    const extra = have.filter((item) => !base.some((known) => isDeepStrictEqual(known, item)));
    if (extra.length === 0) return undefined;
    paths.push(at);
    return extra;
  }
  if (isObject(have) && isObject(base)) {
    const found: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(have)) {
      const next = at === "" ? key : `${at}.${key}`;
      const extra = key in base ? settingsExtras(value, base[key], next, paths) : keep(value, next, paths);
      if (extra !== undefined) found[key] = extra;
    }
    return Object.keys(found).length > 0 ? found : undefined;
  }
  return isDeepStrictEqual(have, base) ? undefined : keep(have, at, paths);
}

/**
 * The hooks of `hooks` (a settings file's `hooks` value) that run a command `known` does not: per event, the groups
 * cut down to their unknown hooks. `events` lists each carried event with its group count.
 */
function ownHooks(hooks: unknown, known: (command: string) => boolean): { hooks: Record<string, unknown[]>; events: [string, number][] } {
  const carried: Record<string, unknown[]> = {};
  if (isObject(hooks)) {
    for (const [event, value] of Object.entries(hooks)) {
      const groups = (Array.isArray(value) ? value : [value]).flatMap((group: unknown) => {
        if (!isObject(group) || !Array.isArray(group.hooks)) return [group];
        const unknown = group.hooks.filter((hook: unknown) => !(isObject(hook) && typeof hook.command === "string" && known(hook.command)));
        return unknown.length > 0 ? [{ ...group, hooks: unknown }] : [];
      });
      if (groups.length > 0) carried[event] = groups;
    }
  }
  return { hooks: carried, events: Object.entries(carried).map(([event, groups]) => [event, groups.length]) };
}

function keep(value: unknown, at: string, paths: string[]): unknown {
  paths.push(at);
  return value;
}

/** The config text with "agents" added to its `packs` list when it has one without it; agents.skills needs the pack. */
function withAgentsPack(text: string): string {
  return text.replace(/(\bpacks\s*:\s*\[)([^\]]*)\]/, (whole, head: string, items: string) => {
    if (/["']agents["']/.test(items)) return whole;
    const kept = items.trimEnd();
    return `${head}${kept}${kept === "" ? "" : ", "}"agents"]`;
  });
}

/** Whether the config text already lists every pack in an `agents.skills` array. */
function configHasSkills(text: string, packs: readonly string[]): boolean {
  const list = /\bskills\s*:\s*\[([^\]]*)\]/.exec(text)?.[1];
  return list !== undefined && packs.every((pack) => list.includes(`"${pack}"`) || list.includes(`'${pack}'`));
}

/** Whether `existing`, the file already at `to`, holds everything `content` would write there: the rule text, or every key and list item. */
function alreadyHolds(to: string, existing: string, content: string): boolean {
  if (to.endsWith(".md")) {
    // every markdown file `write` makes is a rule, which starts with the same frontmatter
    return existing.includes(content.slice(RULE_FRONTMATTER.length).trim());
  }
  try {
    return covers(JSON.parse(existing), JSON.parse(content));
  } catch {
    return false;
  }
}

/** Whether `have` has every key of `want` (recursively) and every list item of it. */
function covers(have: unknown, want: unknown): boolean {
  if (Array.isArray(want)) return Array.isArray(have) && want.every((item) => have.some((known) => isDeepStrictEqual(known, item)));
  if (isObject(want)) return isObject(have) && Object.entries(want).every(([key, value]) => key in have && covers(have[key], value));
  return isDeepStrictEqual(have, want);
}

/** The first `# ` heading line of a markdown text, or null. */
function h1Of(text: string): string | null {
  return /^# .+$/m.exec(text)?.[0].trimEnd() ?? null;
}

/** `"A", "B"`: the titles of the `## ` sections in `sections`. */
function titlesOf(sections: string): string {
  return [...sections.matchAll(/^## (.+)$/gm)].map((match) => `"${match[1]!.trim()}"`).join(", ");
}

/** Whether anything, a dangling link included, is at `abs`. */
function present(abs: string): boolean {
  return fs.lstatSync(abs, { throwIfNoEntry: false }) !== undefined;
}

/** Whether `abs` is a directory itself, not a link to one. */
function isRealDir(abs: string): boolean {
  return fs.lstatSync(abs, { throwIfNoEntry: false })?.isDirectory() === true;
}

function isDir(abs: string): boolean {
  try {
    return fs.lstatSync(abs, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

/** Equal text, whatever the line endings. */
function same(a: string, b: string): boolean {
  return a.replaceAll("\r\n", "\n") === b.replaceAll("\r\n", "\n");
}

/** Every file under `dir` as a `/` path relative to it. */
function filesUnder(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    .sort();
}

/** Whether moving `src` to `dst` would overwrite other text; children named in `except` do not move. */
function clashes(src: string, dst: string, except: readonly string[]): boolean {
  if (!present(dst)) return false;
  if (isDir(src) && isDir(dst)) {
    return fs
      .readdirSync(src)
      .filter((name) => !except.includes(name))
      .some((name) => clashes(path.join(src, name), path.join(dst, name), []));
  }
  if (isDir(src) || isDir(dst)) return true;
  return !same(fs.readFileSync(src, "utf8"), fs.readFileSync(dst, "utf8"));
}

/** Renames `src` to `dst`; into an existing dir it goes entry by entry, and an equal file just goes. */
function moveTree(src: string, dst: string, except: readonly string[]): void {
  if (!present(dst) && except.length === 0) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
  } else if (isDir(src)) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src).filter((entry) => !except.includes(entry))) {
      moveTree(path.join(src, name), path.join(dst, name), []);
    }
    if (except.length === 0) fs.rmdirSync(src);
  } else if (same(fs.readFileSync(src, "utf8"), fs.readFileSync(dst, "utf8"))) fs.rmSync(src);
  else throw new Error(`cannot move ${src}: ${dst} already exists and differs`);
}

/** Writes a step's file through a temp file and a rename; the config is checked after and restored when it fails. */
async function writeStep(root: string, step: Extract<MigrationStep, { kind: "write" }>): Promise<string> {
  const file = path.join(root, step.path);
  const before = step.path === CONFIG_FILE ? fs.readFileSync(file, "utf8") : null;
  writeAtomic(file, step.content);
  if (before === null) return step.note;
  const wanted = /skills: (\[[^\]]*\])/.exec(step.content)![1]!;
  const loaded = await loadConfig(root);
  if (loaded.ok && (JSON.parse(wanted) as SkillPack[]).every((pack) => loaded.config.agents.skills.includes(pack))) {
    return step.note;
  }
  writeAtomic(file, before);
  return `could not add agents.skills ${wanted} to ${CONFIG_FILE}; add agents: { skills: ${wanted} } there`;
}

function writeAtomic(file: string, content: string): void {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}

/** Which of `paths` git tracks, as git prints them; null outside a git repo. */
function gitTracked(root: string, paths: string[]): string[] | null {
  if (!present(path.join(root, ".git"))) return null;
  const result = spawnSync("git", ["ls-files", "-z", "--", ...paths], { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.split("\0").filter((entry) => entry !== "") : null;
}

/** Takes `paths` out of the index and leaves the files, so sync can regenerate them as ignored. */
function untrack(root: string, paths: readonly string[]): void {
  const result = spawnSync("git", ["rm", "-r", "--cached", "-q", "--", ...paths], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git rm --cached failed: ${result.stderr.trim()}`);
}

/** Removes `paths`; the copied dir loses everything but the marker first, so the marker is the last file to go. */
function removeAll(root: string, paths: readonly string[]): void {
  for (const rel of paths) {
    const abs = path.join(root, rel);
    if (rel === COPIED_DIR) {
      for (const file of filesUnder(abs).filter((entry) => `${COPIED_DIR}/${entry}` !== COPIED_MARKER)) {
        fs.rmSync(path.join(abs, file), { force: true });
      }
    }
    fs.rmSync(abs, { recursive: true, force: true });
  }
}
