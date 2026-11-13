import path from "node:path";

import type { ResolvedConfig } from "../config.ts";
import { gitTracked, present } from "./migrate-fs.ts";
import { COPIED_MARKER, PREFIX } from "./migrate.constants.ts";
import { planAdopt, planClaudeSettings } from "./migration-adopt.ts";
import { planRules, planSkills, planSubagents } from "./migration-docs.ts";
import { planCopies, planLeftovers, planPacks, planRemove, planUntrack } from "./migration-finish.ts";
import { planLessons, planOverrides, planReferences } from "./migration-refs.ts";
import { MigrationState } from "./migration-state.ts";
import type { Output } from "./outputs.ts";
import { readStockHistory, type StockHistory } from "./stock-history.ts";

/** The file a moved file's source path gets first, so the moved file says `overrides:`; `note` is the line printed. */
export type MoveMark = { path: string; content: string; note: string };

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
  | {
      kind: "move";
      from: string;
      to: string;
      except?: readonly string[];
      note: string;
      mark?: MoveMark;
      /** Rewrites the old `.tmp/repo` paths in its text files before moving. */
      relocate?: true;
    }
  /** Removes the dir when it is empty; nothing otherwise. `note` is the line printed when it did. */
  | { kind: "prune"; path: string; note: string }
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
  | { kind: "remove"; paths: string[] }
  /**
   * Hands text the user kept where the old layout put it to the file that is theirs now: writes each of `writes`, then
   * removes `remove`. `note` is the lines printed, `pending` the one `--check` prints.
   */
  | {
      kind: "handover";
      writes: readonly { path: string; content: string }[];
      remove: readonly string[];
      note: string;
      pending: string;
    };

/** Seams for tests: which of `paths` git tracks (null when there is no git), and a crash after step `index`. */
export type MigrateDeps = {
  tracked?: (root: string, paths: string[]) => string[] | null;
  /** The hashes of past stock files; the shipped table when omitted. */
  history?: StockHistory;
  afterStep?: (index: number) => void;
};

/**
 * The steps that move a copied install's own content to `.repo/` and `references/`, untrack its generated paths and
 * remove the copy. Empty without the copied-install marker, or while the stock package is not installed. `generated`
 * is the text sync plans for each generated file (see `generatedFiles`): the package ships no generated trees, so
 * it is the stock version of those files. `ignored` is the git ignore entries of the untracked outputs (see
 * `untrackedEntries`), whose tracked files are untracked.
 */
export function planMigration(
  root: string,
  input: { stock: string; generated: ReadonlyMap<string, string>; ignored: readonly string[] },
  deps: MigrateDeps = {},
): MigrationStep[] {
  const { stock, generated } = input;

  if (!present(path.join(root, COPIED_MARKER)) || !present(path.join(stock, "package.json"))) return [];
  const state = new MigrationState({ generated, history: deps.history ?? readStockHistory(), root, stock });
  planRules(state);
  planSubagents(state);
  planSkills(state);
  planReferences(state);
  planClaudeSettings(state);
  planLessons(state);
  planOverrides(state);
  planCopies(state);
  planLeftovers(state);
  planPacks(state);
  planUntrack(state, input.ignored, deps.tracked ?? gitTracked);
  planRemove(state);

  return state.steps;
}

/** The text of each file among `outputs`, by path. */
export function generatedFiles(outputs: readonly Output[]): Map<string, string> {
  return new Map(outputs.flatMap((output) => (output.kind === "file" ? [[output.path, output.content] as const] : [])));
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
  input: { stock: string; config: ResolvedConfig; outputs: readonly Output[]; manifest: readonly string[] },
  deps: MigrateDeps = {},
): MigrationStep[] {
  const { stock, config, outputs } = input;
  const history = deps.history ?? readStockHistory();
  const state = new MigrationState({ generated: generatedFiles(outputs), history, root, stock });
  planAdopt(state, { config, outputs, owned: new Set(input.manifest), tracked: deps.tracked ?? gitTracked });

  return state.steps;
}

/** The `repo sync:` lines for every conflict among `steps`, one each; empty when there is none. */
export function conflictLines(steps: readonly MigrationStep[]): string[] {
  return steps.flatMap((step) =>
    step.kind === "conflict"
      ? [
          step.line ??
            `${PREFIX}cannot move ${step.from}: ${step.to} already exists and differs; ` +
              `merge them by hand, then run \`bun repo sync\``,
        ]
      : [],
  );
}
