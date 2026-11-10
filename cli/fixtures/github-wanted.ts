import { driftOf, wantedSettings } from "../github.ts";
import type { Current, CurrentRuleset, GithubManifest, Ruleset, Wanted } from "../github.types.ts";
import { MANIFEST } from "./github-repo.ts";

export const CHECKS: string[] = ["test (ubuntu-latest)", "commits", "consumer"];
export const RUN = "run `bun repo github`";
export const GITHUB_ACTIONS_ID = 15368;
export const ADMIN = { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" };

/** `value`, or a thrown error: a fixture that was meant to hold something does. */
export function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("fixture is missing a value");
  return value;
}

/** The wanted settings for `manifest` and `checks`; a refusal throws. */
export function wantedOf(manifest: GithubManifest = MANIFEST, checks: string[] = CHECKS): Wanted {
  const result = wantedSettings(manifest, checks);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.wanted;
}

/** What GitHub serves back for `wanted`: every wanted field, plus the ones it fills in itself. */
export function served(wanted: Wanted = wantedOf()): Current {
  const rulesets = wanted.rulesets.map((ruleset, index) => ({
    ...ruleset,
    id: index + 1,
    node_id: `RRS_${index}`,
    source: "workerstack/repo",
    created_at: "2026-11-10T00:00:00Z",
    _links: { self: { href: "https://api.github.com" } },
  }));
  const { description = "", homepage = "", topics = [] } = wanted;
  return { rulesets, reporting: true, alerts: true, description, homepage, topics };
}

/** `served`, with the ruleset called `name` replaced by `change` of it. */
export function changed(name: string, change: (ruleset: CurrentRuleset) => Ruleset): Current {
  const current = served();
  const rulesets = current.rulesets.map((ruleset) =>
    ruleset.name === name ? { ...change(ruleset), id: ruleset.id } : ruleset,
  );
  return { ...current, rulesets };
}

/** The messages of the drift between the wanted settings and `current`. */
export function messages(current: Current, wanted: Wanted = wantedOf()): string[] {
  return driftOf(wanted, current).map((drift) => drift.message);
}
