import { DASH_EDGES, FIX, TOPIC_MAX_LENGTH, TOPIC_OUTSIDE } from "./github.constants.ts";
import { rulesetDrift, wantedRulesets } from "./github-rulesets.ts";
import type { Current, Drift, GithubManifest, WantedResult, Wanted } from "./github.types.ts";

/** A keyword as a GitHub topic: lowercase, each run outside letters, digits and dashes a dash, edges trimmed, cut to 50. */
const slug = (keyword: string): string =>
  keyword
    .toLowerCase()
    .replaceAll(TOPIC_OUTSIDE, "-")
    .replaceAll(DASH_EDGES, "")
    .slice(0, TOPIC_MAX_LENGTH)
    .replaceAll(DASH_EDGES, "");

/** The topics the keywords give, in order and without repeats, or one refusal per keyword that leaves nothing. */
function topicsOf(keywords: readonly string[]): { topics: string[]; errors: string[] } {
  const topics: string[] = [];
  const errors: string[] = [];
  for (const keyword of keywords) {
    const topic = slug(keyword);
    if (topic === "") errors.push(`keyword "${keyword}" gives no valid topic: use letters, digits and dashes`);
    else if (!topics.includes(topic)) topics.push(topic);
  }
  return { topics, errors };
}

/**
 * What the repository should look like: both rulesets with `checks` as the required status checks, and the
 * description, homepage and topics package.json gives. A field package.json leaves out is left alone on GitHub.
 */
export function wantedSettings(manifest: GithubManifest, checks: readonly string[]): WantedResult {
  const { topics, errors } = topicsOf(manifest.keywords ?? []);
  if (errors.length > 0) return { ok: false, errors };
  const wanted: Wanted = { rulesets: wantedRulesets(checks) };
  if (manifest.description !== undefined) wanted.description = manifest.description;
  if (manifest.homepage !== undefined) wanted.homepage = manifest.homepage;
  if (manifest.keywords !== undefined) wanted.topics = topics;
  return { ok: true, wanted };
}

/** Each setting of `current` that differs from `wanted`, with the line that says how to fix it. */
export function driftOf(wanted: Wanted, current: Current): Drift[] {
  const drifts: Drift[] = wanted.rulesets.flatMap((want): Drift[] => {
    const found = current.rulesets.find((ruleset) => ruleset.name === want.name);
    const messages = found === undefined ? [`ruleset ${want.name} is missing: ${FIX}`] : rulesetDrift(want, found);
    return messages.map((message) => ({ area: "ruleset", name: want.name, message }));
  });
  if (!current.reporting) drifts.push({ area: "reporting", message: `private vulnerability reporting is off: ${FIX}` });
  if (!current.alerts) drifts.push({ area: "alerts", message: `Dependabot alerts are off: ${FIX}` });
  for (const area of ["description", "homepage"] as const) {
    const want = wanted[area];
    if (want !== undefined && want !== current[area]) {
      drifts.push({ area, message: `${area} is "${current[area]}", package.json says "${want}": ${FIX}`, value: want });
    }
  }
  const { topics } = wanted;
  if (topics !== undefined && topics.toSorted().join() !== current.topics.toSorted().join()) {
    const [now, wants] = [current.topics.join(", "), topics.join(", ")];
    drifts.push({
      area: "topics",
      message: `topics are [${now}], package.json keywords give [${wants}]: ${FIX}`,
      value: topics,
    });
  }
  return drifts;
}
