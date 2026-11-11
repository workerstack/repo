// A small copied install over a fake stock package, so each migration rule can be tried alone, and step readers.
import path from "node:path";
import type { ResolvedConfig } from "../../config.ts";
import { untrackedEntries } from "../git-files.ts";
import { HOST_TREES } from "../hosts.ts";
import { COPIED_MARKER } from "../migrate.constants.ts";
import { planMigration, type MigrateDeps, type MigrationStep } from "../migrate.ts";
import type { Output } from "../outputs.ts";
import { CONFIG, git, write } from "./copied-install.ts";
import { tempDir } from "./temp-dirs.ts";

/** The marker that makes a dir a copied install. */
export const MARKER_FILE: Readonly<Record<string, string>> = { [COPIED_MARKER]: "// copied script\n" };
/** A local defineConfig, so a config loads without the package. */
export const DEFINE = "const defineConfig = (config: object) => config\n";
/** A config that only lists the agents pack. */
export const SIMPLE_CONFIG = `${DEFINE}export default defineConfig({\n  packs: ["agents"],\n})\n`;
/** The fake stock's references/hooks.md. */
export const STOCK_HOOKS_REF = "---\ntags: [hooks]\n---\n# Hooks\n\n## Stock\n\nbody\n";
/** A stock package as it is packed: sources under `agents/`, scripts under `cli/scripts/`, no generated trees. */
export const STOCK_FILES: Readonly<Record<string, string>> = {
  "package.json": '{ "name": "@workerstack/repo" }\n',
  "agents/rules/overview.md": "---\nroot: true\n---\n# Overview\n\n## Stock\n\nbody\n",
  "agents/rules/plain.md": "---\nroot: false\n---\nno heading and no sections\n",
  "agents/subagents/scout.md": "scout\n",
  "agents/hooks.jsonc": "{}\n",
  "agents/mcp-policy.jsonc": "{}\n",
  "agents/global-settings/claude.json": "{}\n",
  "agents/skills/ask/SKILL.md": "ask\n",
  "references/hooks.md": STOCK_HOOKS_REF,
  "references/bare.md": "bare\n\n## Stock\n\nbody\n",
  "references/cascade.md": "# Cascade\n\n## Stock\n\nbody\n",
};
/** The `.claude/settings.json` sync generates from that stock. */
export const GENERATED_SETTINGS = '{ "permissions": { "allow": ["A"] }, "env": { "X": "1" } }\n';
const GENERATED: Readonly<Record<string, string>> = { ".claude/settings.json": GENERATED_SETTINGS };
/** The removal of the copied dir that ends every migration. */
export const REMOVAL: MigrationStep = { kind: "remove", paths: [".rulesync"] };

/** A copied install and the stock and generated text it is compared with. */
export interface Mini {
  root: string;
  stock: string;
  generated: Map<string, string>;
}

/** What a mini install holds beside its own files. */
export interface MiniOptions {
  stock?: Record<string, string>;
  generated?: Record<string, string>;
  git?: boolean;
}

/** A whole-file output sync plans, untracked. */
export function fileOutput(rel: string, content: string): Output & { kind: "file" } {
  return { kind: "file", path: rel, content, tracked: false, managed: "whole" };
}

/** The ignore entries sync derives for `config` when every host generated a file in each dir it owns. */
function ignoredOf(config: ResolvedConfig): string[] {
  const paths = ["AGENTS.md", ...config.agents.hosts.flatMap((host) => HOST_TREES[host].owns.map((dir) => `${dir}x`))];
  return untrackedEntries(
    config.agents.hosts,
    paths.map((rel) => fileOutput(rel, "")),
  );
}

/** A small copied install over a fake stock package, so each rule can be tried alone. */
export function mini(files: Record<string, string>, options: MiniOptions = {}): Mini {
  const dir = tempDir("workerstack-migrate-");
  const stock = path.join(dir, "stock");
  const root = path.join(dir, "root");
  for (const [rel, text] of Object.entries({ ...STOCK_FILES, ...options.stock })) write(stock, rel, text);
  for (const [rel, text] of Object.entries({ ...MARKER_FILE, "workerstack.config.ts": SIMPLE_CONFIG, ...files })) {
    write(root, rel, text);
  }
  if (options.git === true) {
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "copied install");
  }
  return { root, stock, generated: new Map(Object.entries({ ...GENERATED, ...options.generated })) };
}

/** The migration planned for `m` under `config`. */
export function planOf(m: Mini, config: ResolvedConfig = CONFIG, deps: MigrateDeps = {}): MigrationStep[] {
  return planMigration(m.root, { stock: m.stock, generated: m.generated, ignored: ignoredOf(config) }, deps);
}

/** The lines of each step that prints one, in order. */
export function notes(steps: readonly MigrationStep[]): string[] {
  return steps.flatMap((step) => ("note" in step ? [step.note] : []));
}

/** The content of each write step, in order. */
export function contents(steps: readonly MigrationStep[]): string[] {
  return steps.flatMap((step) => (step.kind === "write" ? [step.content] : []));
}

/** The JSON of the first write step. */
export function firstWritten(steps: readonly MigrationStep[]): unknown {
  return JSON.parse(contents(steps)[0] ?? "");
}

/** The stop line for an entry of the copied dir nothing reads. */
export const yours = (rel: string): string =>
  `repo sync: ${rel} is yours and nothing reads it; move it out of .rulesync (to references/ if it explains something) or delete it, then run \`bun repo sync\``;

/** The stop line for a move onto a differing destination. */
export const clash = (from: string, to: string): string =>
  `repo sync: cannot move ${from}: ${to} already exists and differs; merge them by hand, then run \`bun repo sync\``;
