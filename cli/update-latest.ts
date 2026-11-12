import { LATEST_TAG, LATEST_TIMEOUT_MS, SLASH, TRAILING_SLASH } from "./check-latest.constants.ts";
import { latestRegistry } from "./check-latest.ts";
import { registryDoc, type RegistryAnswer } from "./release/wait.ts";
import type { UpdateIo } from "./update-io.types.ts";
import { CONCURRENCY, NOT_ON_REGISTRY, NO_LATEST, noAnswer, prefixed } from "./update.constants.ts";

/** What the registry said for one name: its `latest`, or why it has none. */
export type Verdict = { latest: string } | { why: string };

/** What the registry said for a set of names, in the order they were asked, or the first failure to answer. */
export type Latest = { verdicts: Map<string, Verdict>; failure: string | null };

/** Runs `run` over `items`, `size` at a time, and returns the results in the order of `items`. */
async function pool<T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const queue = [...items.entries()];
  const results: R[] = [];

  async function worker(): Promise<void> {
    const next = queue.shift();

    if (next === undefined) return;
    results[next[0]] = await run(next[1]);
    await worker();
  }

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));

  return results;
}

/** A found document's `latest`, else why not; a 404 says the name is not on the registry. */
function verdictOf(answer: Exclude<RegistryAnswer, { kind: "unreachable" }>): Verdict {
  if (answer.kind === "missing") return { why: NOT_ON_REGISTRY };
  const latest = answer.doc["dist-tags"][LATEST_TAG];

  return latest === undefined ? { why: NO_LATEST } : { latest };
}

/**
 * Asks the registry for each name's `latest`. A 404 or a document without one is a `why`; any other failure stops
 * the write.
 */
export async function latestOf(names: readonly string[], io: UpdateIo): Promise<Latest> {
  const base = latestRegistry(io.env).replace(TRAILING_SLASH, SLASH);

  function ask(url: string) {
    return io.fetch(url, { signal: AbortSignal.timeout(LATEST_TIMEOUT_MS) });
  }

  const answers = await pool(names, CONCURRENCY, async (name) => ({
    answer: await registryDoc(ask, name, base),
    name,
  }));

  const verdicts = new Map<string, Verdict>();
  let failure: string | null = null;

  for (const { name, answer } of answers) {
    if (answer.kind === "unreachable") failure ??= prefixed(noAnswer(new URL(base).host, name, answer.why));
    else verdicts.set(name, verdictOf(answer));
  }

  return { failure, verdicts };
}
