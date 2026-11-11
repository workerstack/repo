import fs from "node:fs";
import path from "node:path";

import { byCodeUnit } from "./by-code-unit.ts";
import { clashes, same, stockRel } from "./migrate-fs.ts";
import { markNote, markedText } from "./migrate-rules.ts";
import { alreadyHolds } from "./migrate-settings.ts";
import type { MigrationStep, MoveMark } from "./migrate.ts";
import { hashText, type StockHistory } from "./stock-history.ts";

/**
 * What a migration of one root has planned so far, and the reads every planner shares: the root's files, the stock
 * version of each (the text sync generates, else the package's file) and the hashes of past stock versions.
 */
export class MigrationState {
  readonly steps: MigrationStep[] = [];
  /** The stock copies to remove last. */
  readonly drop: string[] = [];
  readonly root: string;
  readonly stock: string;
  readonly generated: ReadonlyMap<string, string>;
  readonly history: StockHistory;

  constructor(of: { root: string; stock: string; generated: ReadonlyMap<string, string>; history: StockHistory }) {
    this.root = of.root;
    this.stock = of.stock;
    this.generated = of.generated;
    this.history = of.history;
  }

  /** Moves `from` to `to`, or records the conflict when `to` already holds other text. */
  move(from: string, to: string, how: { note: string; except?: readonly string[]; mark?: MoveMark | undefined }): void {
    const except = how.except ?? [];
    if (clashes(path.join(this.root, from), path.join(this.root, to), except)) {
      this.steps.push({ from, kind: "conflict", to });
    } else {
      this.steps.push({
        from,
        kind: "move",
        to,
        ...(except.length > 0 ? { except } : {}),
        note: how.note,
        ...(how.mark === undefined ? {} : { mark: how.mark }),
      });
    }
  }

  /**
   * The mark for the file at `from` that moves to `to` and replaces a stock `kind`; undefined when it already says so
   * or cannot be read.
   */
  mark(from: string, to: string, of: { name: string; kind: "rule" | "subagent" | "skill" }): MoveMark | undefined {
    const text = this.read(from);
    const content = text === null ? null : markedText(text, of.name);
    if (content === null) return undefined;
    return { content, note: markNote(to, of.name, of.kind), path: from };
  }

  /** Writes `content` to `to` for text taken from `from`; nothing to do when it is already there. */
  write(from: string, to: string, file: { content: string; note: string }): void {
    const existing = this.read(to);
    if (existing === file.content || (existing !== null && alreadyHolds(to, existing, file.content))) return;
    if (existing === null) this.steps.push({ content: file.content, kind: "write", note: file.note, path: to });
    else this.steps.push({ from, kind: "conflict", to });
  }

  /** Whether the file at `rel` is there and is no stock version. */
  differs(rel: string, stockText: string | null): boolean {
    const own = this.read(rel);
    return own !== null && !this.unedited(rel, own, stockText);
  }

  /**
   * Whether `text` is an unedited stock file: the stock's current one, or a version the history table holds under
   * `keys`, the file's path or every name it went by.
   */
  unedited(keys: string | readonly string[], text: string, stockText: string | null): boolean {
    if (stockText !== null && same(text, stockText)) return true;
    const hash = hashText(text);
    return [keys].flat().some((key) => this.history[key]?.includes(hash) === true);
  }

  /** The entries of the dir at `rel`, sorted; none when it cannot be read. */
  names(rel: string): string[] {
    try {
      return fs.readdirSync(path.join(this.root, rel)).toSorted(byCodeUnit);
    } catch {
      return [];
    }
  }

  /** The text of the file at `rel`; null when it cannot be read. */
  read(rel: string): string | null {
    try {
      return fs.readFileSync(path.join(this.root, rel), "utf8");
    } catch {
      return null;
    }
  }

  /** A file the plan found by listing its dir. */
  text(rel: string): string {
    return fs.readFileSync(path.join(this.root, rel), "utf8");
  }

  /**
   * The stock version of the file at `rel`: the text sync generates there, else the package's file; null when neither
   * has one.
   */
  stockText(rel: string): string | null {
    const generated = this.generated.get(rel);
    if (generated !== undefined) return generated;
    try {
      return fs.readFileSync(path.join(this.stock, stockRel(rel)), "utf8");
    } catch {
      return null;
    }
  }
}
