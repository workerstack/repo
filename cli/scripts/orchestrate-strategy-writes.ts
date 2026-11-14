/** The strategy writes an approval makes: each file's new `strategy:` line, validated, then written. */
import fs from "node:fs";

import type { Result } from "../result.ts";
import { itemKey } from "./orchestrate-reviews.ts";
import type { ApprovalItem, Strategy, StrategyChange, StrategyItem, StrategyWrite } from "./orchestrate.types.ts";
import { preparePlanUpdate } from "./persist-plan.ts";
import { prepareRoadmapUpdate } from "./persist-roadmap.ts";
import { hasStrategy } from "./strategy.ts";

const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---(?=\r?\n)/;
const STRATEGY_LINE = /^strategy:.*$/m;

// The file's text with its `strategy:` frontmatter line set, validated through the persist module;
// null when nothing would change.
function strategyWrite(ws: string, item: StrategyItem, strategy: Strategy): StrategyWrite {
  const previous = fs.readFileSync(item.path, "utf8");
  const m = FRONTMATTER_BLOCK.exec(previous);

  if (m === null) return { error: "no frontmatter", ok: false };
  const next = m[0].replace(STRATEGY_LINE, `strategy: ${strategy}`) + previous.slice(m[0].length);

  if (next === previous) return { content: null, ok: true };
  const prepare = item.kind === "plan" ? preparePlanUpdate : prepareRoadmapUpdate;
  const result = prepare({ content: next, filePath: item.path, workspaceRoot: ws });

  if (!result.ok) return { error: result.error, ok: false };

  return { content: result.content, ok: true };
}

type Planned = Result<StrategyChange[], string>;

/** Each item's strategy change; the failure, as `kind N: why`, when one cannot be written. */
export function planWrites(ws: string, resolved: ApprovalItem[], wanted: Strategy | null): Planned {
  const writes: StrategyChange[] = [];

  for (const i of resolved) {
    // A fast plan or roadmap has no strategy, so a strategy word leaves it alone.
    const w: StrategyWrite =
      wanted === null || !hasStrategy(i) ? { content: null, ok: true } : strategyWrite(ws, i, wanted);

    if (!w.ok) return { error: `${itemKey(i)}: strategy ${wanted} could not be written (${w.error})`, ok: false };
    writes.push({ content: w.content, item: i });
  }

  return { ok: true, value: writes };
}

/** Writes each changed file; the error text when one fails. */
export function applyWrites(writes: StrategyChange[]): string | null {
  try {
    for (const w of writes) if (w.content !== null) fs.writeFileSync(w.item.path, w.content);

    return null;
  } catch (err) {
    return String(err);
  }
}
