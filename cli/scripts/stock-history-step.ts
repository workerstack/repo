/**
 * Turn's step that writes this package's stock history table when a stock file or the table changed, so the commit
 * that changes a stock file carries the table that lists it. It runs only in this package's own checkout.
 */
import { isSelf } from "../sync/stock.ts";
import { STOCK_HISTORY_REL } from "./stock-history-collect.constants.ts";
import { isStockPath, writeStockHistory } from "./stock-history-collect.ts";
import { failed, passed, type StepResult, type Turn } from "./turn-steps.ts";

/** The history every commit's table holds: `HEAD`'s, which a clone with no local `main` still has. */
const REFS: readonly string[] = ["HEAD"];

function isStock(rel: string): boolean {
  return rel === STOCK_HISTORY_REL || isStockPath(rel);
}

/**
 * `stock history written` when the table's bytes changed, else `stock history ok`; under `--staged` it hashes the
 * index, which turn has restaged with every earlier step's rewrites, else the working tree.
 */
export function stockHistoryStep(turn: Turn): StepResult | null {
  if (!turn.changes.some((change) => isStock(change.rel)) || !isSelf(turn.root)) return null;
  const written = writeStockHistory(turn.root, REFS, turn.isStaged ? "index" : "tree");

  if (!written.ok) return failed("stock history failed", written.error);

  return written.value.changed ? passed("stock history written", [STOCK_HISTORY_REL]) : passed("stock history ok");
}
