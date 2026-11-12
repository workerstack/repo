/** `repo ci --shard i/n`, read at the CLI so the gates get a slice they can trust. */
import { SHARD_PATTERN } from "./ci.constants.ts";

/**
 * The slice `text` asks for, as vitest's `i/n`: none for `1/1`, which is the whole run. An error for anything that is
 * not two whole numbers with 1 ≤ i ≤ n.
 */
export function parseShard(text: string): { shard: string | undefined } | { error: string } {
  const [, index = "", count = ""] = SHARD_PATTERN.exec(text) ?? [];
  const [i, n] = [Number(index), Number(count)];

  if (!(i >= 1 && i <= n)) return { error: `--shard takes i/n with 1 ≤ i ≤ n, got "${text}"` };

  if (n === 1) return { shard: undefined };

  return { shard: `${i}/${n}` };
}
