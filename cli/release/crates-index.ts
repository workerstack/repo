import { z } from "zod";

import { tryJson } from "../json.ts";
import { quote } from "../rust/cargo-tools.ts";
import {
  DIR_LENGTH,
  INDEX_BASE,
  SECOND_DIR_END,
  SHORT_NAME_MAX,
  STATUS_ABSENT,
  STATUS_OK,
  USER_AGENT,
} from "./crates-index.constants.ts";
import { parseSemver, type Parts } from "./version.ts";

/** What the crates.io index says about a crate: no published version to compare, the baseline, or why it failed. */
export type Baseline =
  | { kind: "absent" }
  | { kind: "found"; version: string; published: string | null }
  | { kind: "failed"; line: string };

/** The part of `fetch` this reads: a URL and headers in, a status and a body out. */
type IndexFetch = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;

/** One version line of the index, as far as this reads it. */
function entry() {
  return z.object({ pubtime: z.string().nullish(), vers: z.string(), yanked: z.boolean().optional() });
}

type Entry = z.infer<ReturnType<typeof entry>>;

/** The sparse index URL of a crate: its name lowercased under the directories the length of the name picks. */
export function indexUrl(name: string): string {
  const lower = name.toLowerCase();
  const { length } = lower;

  if (length > SHORT_NAME_MAX)
    return `${INDEX_BASE}${lower.slice(0, DIR_LENGTH)}/${lower.slice(DIR_LENGTH, SECOND_DIR_END)}/${lower}`;

  return `${INDEX_BASE}${length === SHORT_NAME_MAX ? `${SHORT_NAME_MAX}/${lower[0]}` : length}/${lower}`;
}

/** Negative when `left` is the lower version; a prerelease is below its release, as semver orders them. */
function compare(left: Parts, right: Parts): number {
  const gaps = [left.major - right.major, left.minor - right.minor, left.patch - right.patch];
  const numbers = gaps.find((gap) => gap !== 0) ?? 0;

  if (numbers !== 0) return numbers;
  const release = Number(left.id === undefined) - Number(right.id === undefined);

  if (release !== 0) return release;

  if (left.id === right.id) return left.n - right.n;

  return String(left.id).localeCompare(String(right.id));
}

/** The entries of an NDJSON body, or the first line that is not one. */
function entriesOf(body: string): { entries: Entry[] } | { bad: string } {
  const entries: Entry[] = [];

  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    const read = tryJson(entry(), line);

    if (read === undefined) return { bad: line };
    entries.push(read);
  }

  return { entries };
}

/** The highest published version that is not yanked or above `current`; versions repo cannot order are left out. */
function highest(entries: Entry[], current: Parts): Entry | null {
  let best: { entry: Entry; parts: Parts } | null = null;

  for (const candidate of entries) {
    const parts = parseSemver(candidate.vers);

    if (candidate.yanked === true || parts === null || compare(parts, current) > 0) continue;

    if (best === null || compare(parts, best.parts) > 0) best = { entry: candidate, parts };
  }

  return best?.entry ?? null;
}

function failed(line: string): Baseline {
  return { kind: "failed", line };
}

/**
 * The version of `crate` to compare against: the highest non-yanked one at or below the crate's own, with when it was
 * published. A crate the index does not have, or has only above its version, is `absent`.
 */
export async function baselineOf(crate: { name: string; version: string }, fetchIndex: IndexFetch): Promise<Baseline> {
  const { name } = crate;
  const current = parseSemver(crate.version);

  if (current === null)
    return failed(`crate ${name} has version ${quote(crate.version)}, which is not a version repo reads`);
  let response: Response;
  let body: string;

  try {
    response = await fetchIndex(indexUrl(name), { headers: { "User-Agent": USER_AGENT } });

    if (response.status === STATUS_ABSENT) return { kind: "absent" };

    if (response.status !== STATUS_OK)
      return failed(`crates.io index for ${name} answered ${response.status}; try again`);
    body = await response.text();
  } catch {
    return failed(`crates.io index for ${name} could not be reached; try again`);
  }

  const read = entriesOf(body);

  if ("bad" in read) return failed(`crates.io index for ${name} has an unreadable line: ${quote(read.bad)}`);
  const found = highest(read.entries, current);

  if (found === null) return { kind: "absent" };

  return { kind: "found", published: found.pubtime ?? null, version: found.vers };
}
