import { z } from "zod";

import { rulesetDrift, wantedRulesets } from "./github-rulesets.ts";
import { FIX } from "./github.constants.ts";
import type { Current, Drift, GithubManifest, WantedResult, Wanted } from "./github.types.ts";
import { keywordLines } from "./keyword-lines.ts";

/**
 * What the repository should look like: both rulesets with `checks` as the required status checks, and the
 * description, homepage and topics package.json gives; keywords are the topics as written, or a refusal. A field
 * package.json leaves out is left alone on GitHub.
 */
export function wantedSettings(manifest: GithubManifest, checks: readonly string[]): WantedResult {
  const errors = manifest.keywords === undefined ? [] : keywordLines(manifest.keywords);

  if (errors.length > 0) return { errors, ok: false };
  const wanted: Wanted = { rulesets: wantedRulesets(checks) };

  if (manifest.description !== undefined) wanted.description = manifest.description;

  if (manifest.homepage !== undefined) wanted.homepage = manifest.homepage;

  if (manifest.keywords !== undefined) wanted.topics = z.array(z.string()).parse(manifest.keywords);

  return { ok: true, wanted };
}

/** The code security settings that are off. */
function securityDrift(current: Current): Drift[] {
  const drifts: Drift[] = [];

  if (!current.scanning) drifts.push({ area: "scanning", message: `secret scanning is off: ${FIX}` });

  if (!current.pushProtection) drifts.push({ area: "pushProtection", message: `push protection is off: ${FIX}` });

  if (!current.securityUpdates)
    drifts.push({ area: "securityUpdates", message: `Dependabot security updates are off: ${FIX}` });

  return drifts;
}

/** Each setting of `current` that differs from `wanted`, with the line that says how to fix it. */
export function driftOf(wanted: Wanted, current: Current): Drift[] {
  const drifts: Drift[] = wanted.rulesets.flatMap((want): Drift[] => {
    const found = current.rulesets.find((ruleset) => ruleset.name === want.name);
    const messages = found === undefined ? [`ruleset ${want.name} is missing: ${FIX}`] : rulesetDrift(want, found);

    return messages.map((message) => ({ area: "ruleset", message, name: want.name }));
  });

  if (!current.reporting) drifts.push({ area: "reporting", message: `private vulnerability reporting is off: ${FIX}` });

  if (!current.alerts) drifts.push({ area: "alerts", message: `Dependabot alerts are off: ${FIX}` });

  drifts.push(...securityDrift(current));

  for (const area of ["description", "homepage"] as const) {
    const want = wanted[area];

    if (want !== undefined && want !== current[area])
      drifts.push({ area, message: `${area} is "${current[area]}", package.json says "${want}": ${FIX}`, value: want });
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
