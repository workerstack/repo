import { matchesName } from "./matches-name.ts";
import type { Latest, Verdict } from "./update-latest.ts";
import { isBehind, parseSpec } from "./update-spec.ts";
import { PEER_FIELD, rangeReason } from "./update.constants.ts";
import type { Checked, Plain, Source } from "./update.types.ts";

/** The sources `repo update` looks at: plain versions to check and ranges to list. */
export type Candidates = { plain: Plain[]; ranges: Source[] };

/** What the registry's answers make of the candidates. */
export type Assessed = { checked: Checked[]; behind: Checked[]; skipped: string[] };

/** Sorts the sources of the named dependencies (all of them without names) into plain and range; peers, protocols and tags drop out. */
export function candidatesOf(sources: readonly Source[], names: readonly string[]): Candidates {
  const result: Candidates = { plain: [], ranges: [] };
  for (const source of sources) {
    if (
      source.field === PEER_FIELD ||
      (names.length > 0 && !names.some((pattern) => matchesName(pattern, source.name)))
    )
      continue;
    const parsed = parseSpec(source.spec);
    if (parsed.kind === "plain") result.plain.push({ ...source, prefix: parsed.prefix, version: parsed.version });
    else if (parsed.kind === "range") result.ranges.push(source);
  }
  return result;
}

/** Pairs each plain source with its `latest`; a name the registry lacks, and every range, is skipped with its reason. */
export function assess(found: Candidates, answers: Latest): Assessed {
  const checked: Checked[] = [];
  const reasons = new Map<string, string>();
  for (const source of found.plain) {
    const verdict = answers.verdicts.get(source.name) /* every plain name was asked */ as Verdict;
    if ("latest" in verdict) checked.push({ ...source, latest: verdict.latest });
    else reasons.set(source.name, `${source.name} ${verdict.why}`);
  }
  const ranges = found.ranges.map((source) => rangeReason(source.name, source.where, source.spec));
  return {
    behind: checked.filter((source) => isBehind(source.version, source.latest)),
    checked,
    skipped: [...ranges, ...reasons.values()],
  };
}
