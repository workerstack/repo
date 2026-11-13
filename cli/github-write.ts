import type { Gh, GhCall, GhFailure } from "./github-gh.ts";
import { ONE } from "./github.constants.ts";
import type { Current, Drift, Wanted } from "./github.types.ts";

/** What a run changes: the settings it wanted, the ones it found, and the drift between them. */
export type Plan = { slug: string; wanted: Wanted; current: Current; drifts: Drift[] };

/** One API call, with the phrase for the summary line; the last call of a group carries the group's phrase. */
export type Write = { call: GhCall; part?: string };

function noun(count: number, word: string) {
  return `${count} ${word}${count === ONE ? "" : "s"}`;
}

function hasArea(drifts: readonly Drift[], area: Drift["area"]) {
  return drifts.some((drift) => drift.area === area);
}

/** `a`, `a and b`, `a, b and c`. */
function joined(items: string[]) {
  return new Intl.ListFormat("en-GB", { type: "conjunction" }).format(items);
}

function rulesetWrites({ slug, wanted, current, drifts }: Plan): Write[] {
  const names = new Set(drifts.filter((drift) => drift.area === "ruleset").map((drift) => drift.name));
  const base = `repos/${slug}/rulesets`;

  return wanted.rulesets
    .filter((want) => names.has(want.name))
    .map((want): Write => {
      const found = current.rulesets.find((ruleset) => ruleset.name === want.name);

      if (found === undefined)
        return { call: { body: want, method: "POST", path: base }, part: `ruleset ${want.name} created` };

      return { call: { body: want, method: "PUT", path: `${base}/${found.id}` }, part: `ruleset ${want.name} updated` };
    });
}

function metadataWrites({ slug, drifts }: Plan): Write[] {
  const texts = drifts.filter((drift) => drift.area === "description" || drift.area === "homepage");
  const topics = drifts.find((drift) => drift.area === "topics")?.value;
  const done: string[] = texts.map((drift) => drift.area);
  const writes: Write[] = [];

  if (texts.length > 0) {
    const body = Object.fromEntries(texts.map((drift) => [drift.area, drift.value]));
    writes.push({ call: { body, method: "PATCH", path: `repos/${slug}` } });
  }

  if (Array.isArray(topics)) {
    done.push(noun(topics.length, "topic"));
    writes.push({ call: { body: { names: topics }, method: "PUT", path: `repos/${slug}/topics` } });
  }

  const last = writes.pop();

  return last === undefined ? [] : [...writes, { ...last, part: `${joined(done)} set` }];
}

function securityWrites({ slug, drifts }: Plan): Write[] {
  const writes: Write[] = [];

  if (hasArea(drifts, "reporting")) {
    const call: GhCall = { method: "PUT", path: `repos/${slug}/private-vulnerability-reporting` };
    writes.push({ call, part: "private vulnerability reporting on" });
  }

  if (hasArea(drifts, "alerts"))
    writes.push({ call: { method: "PUT", path: `repos/${slug}/vulnerability-alerts` }, part: "Dependabot alerts on" });

  if (hasArea(drifts, "scanning") || hasArea(drifts, "pushProtection")) {
    const enabled = { status: "enabled" };
    const body = { security_and_analysis: { secret_scanning: enabled, secret_scanning_push_protection: enabled } };
    const part = "secret scanning and push protection on";
    writes.push({ call: { body, method: "PATCH", path: `repos/${slug}` }, part });
  }

  if (hasArea(drifts, "securityUpdates")) {
    const call: GhCall = { method: "PUT", path: `repos/${slug}/automated-security-fixes` };
    writes.push({ call, part: "Dependabot security updates on" });
  }

  return writes;
}

/** The API calls that fix `plan.drifts`, in the order they run, each with the phrase for the summary. */
export function writesFor(plan: Plan): Write[] {
  return [...rulesetWrites(plan), ...securityWrites(plan), ...metadataWrites(plan)];
}

/** Runs the writes one after another and stops at the first failure; a rerun converges from wherever this stopped. */
export async function runWrites(
  gh: Gh,
  [next, ...rest]: readonly Write[],
  done: readonly string[] = [],
): Promise<{ ok: true; parts: string[] } | GhFailure> {
  if (next === undefined) return { ok: true, parts: [...done] };
  const result = await gh(next.call);

  if (!result.ok) return result;

  return await runWrites(gh, rest, next.part === undefined ? done : [...done, next.part]);
}
