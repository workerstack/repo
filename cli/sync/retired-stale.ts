import fs from "node:fs";
import path from "node:path";

import { hashText, readStockHistory } from "./stock-history.ts";

/**
 * Files an older version wrote that no output names any more. A consumer whose manifest predates the version that
 * dropped one still has it, and the manifest cannot name it, so each is listed here.
 */
const RETIRED_OUTPUTS: readonly string[] = [".grok/hooks/rulesync.json"];

/** The text at `abs`, or null when no file is there. */
function fileText(abs: string): string | null {
  const found = fs.lstatSync(abs, { throwIfNoEntry: false });

  return found?.isFile() === true ? fs.readFileSync(abs, "utf8") : null;
}

/**
 * The retired outputs under `root` that still hold a text some stock version wrote there; an edited one is the
 * consumer's and stays. The stock history is read only when a retired output is present.
 */
export function retiredStale(root: string): string[] {
  const present = RETIRED_OUTPUTS.flatMap((rel) => {
    const text = fileText(path.join(root, rel));

    return text === null ? [] : [{ rel, text }];
  });

  if (present.length === 0) return [];
  const hashes = readStockHistory();

  return present.filter(({ rel, text }) => hashes[rel]?.includes(hashText(text)) === true).map(({ rel }) => rel);
}
