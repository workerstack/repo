import {
  ADMIN_ROLE_ID,
  ADMIN_ROLE_TYPE,
  BYPASS_ALWAYS,
  DEFAULT_BRANCH_REF,
  ENFORCEMENT_ACTIVE,
  FIX,
  GITHUB_ACTIONS_APP_ID,
  MAIN_RULESET,
  RELEASE_TAG_REFS,
  RULE_CHECKS,
  RULE_CREATION,
  RULE_DELETION,
  RULE_NON_FAST_FORWARD,
  RULE_PULL_REQUEST,
  RULE_UPDATE,
  TAGS_RULESET,
  TARGET_BRANCH,
  TARGET_TAG,
  UNSET,
} from "./github.constants.ts";
import type { BypassActor, Rule, RuleParameters, Ruleset } from "./github.types.ts";

type Parts = { name: string; target: string; include: string[]; rules: Rule[] };

const ADMINS: BypassActor[] = [{ actor_id: ADMIN_ROLE_ID, actor_type: ADMIN_ROLE_TYPE, bypass_mode: BYPASS_ALWAYS }];

const pullRequest = (): Rule => ({
  type: RULE_PULL_REQUEST,
  parameters: {
    required_approving_review_count: 0,
    dismiss_stale_reviews_on_push: false,
    require_code_owner_review: false,
    require_last_push_approval: false,
    required_review_thread_resolution: false,
  },
});

const statusChecks = (checks: readonly string[]): Rule[] =>
  checks.length === 0
    ? []
    : [
        {
          type: RULE_CHECKS,
          parameters: {
            strict_required_status_checks_policy: false,
            required_status_checks: checks.map((context) => ({ context, integration_id: GITHUB_ACTIONS_APP_ID })),
          },
        },
      ];

/**
 * The two rulesets: `main` bans deletion and force pushes and wants a pull request with every CI check; the release
 * tags can only be created, moved or deleted by an admin, which is who runs `repo release`. Admins bypass both.
 */
export function wantedRulesets(checks: readonly string[]): Ruleset[] {
  const ruleset = ({ name, target, include, rules }: Parts): Ruleset => ({
    name,
    target,
    enforcement: ENFORCEMENT_ACTIVE,
    conditions: { ref_name: { include, exclude: [] } },
    rules,
    bypass_actors: ADMINS,
  });
  return [
    ruleset({
      name: MAIN_RULESET,
      target: TARGET_BRANCH,
      include: [DEFAULT_BRANCH_REF],
      rules: [{ type: RULE_DELETION }, { type: RULE_NON_FAST_FORWARD }, pullRequest(), ...statusChecks(checks)],
    }),
    ruleset({
      name: TAGS_RULESET,
      target: TARGET_TAG,
      include: [...RELEASE_TAG_REFS],
      rules: [{ type: RULE_CREATION }, { type: RULE_UPDATE }, { type: RULE_DELETION }],
    }),
  ];
}

const shown = (value: number | boolean | undefined) => String(value ?? UNSET);
const listed = (items: readonly (string | number)[]) => `[${items.join(", ")}]`;
const sorted = (items: readonly string[]) => items.toSorted();
const differ = (a: readonly string[], b: readonly string[]) => listed(sorted(a)) !== listed(sorted(b));
const paramsOf = (ruleset: Ruleset, type: string): RuleParameters | undefined =>
  ruleset.rules.find((rule) => rule.type === type)?.parameters;
const typesOf = (ruleset: Ruleset) => ruleset.rules.map((rule) => rule.type);
const checksOf = (ruleset: Ruleset) =>
  (paramsOf(ruleset, RULE_CHECKS)?.required_status_checks ?? []).map((check) => ({
    context: check.context,
    key: `${check.context}#${check.integration_id}`,
  }));
const bypassOf = (ruleset: Ruleset) =>
  ruleset.bypass_actors.map((actor) => `${actor.actor_type} ${actor.actor_id} ${actor.bypass_mode}`);

/** The clauses for the fields that hold one value or a list of them. */
function shapeClauses(want: Ruleset, cur: Ruleset): string[] {
  const clauses: string[] = [];
  if (want.target !== cur.target) clauses.push(`targets "${cur.target}", wanted "${want.target}"`);
  if (want.enforcement !== cur.enforcement) clauses.push(`is "${cur.enforcement}", wanted "${want.enforcement}"`);
  const [wantRefs, curRefs] = [want.conditions.ref_name, cur.conditions.ref_name];
  if (differ(wantRefs.include, curRefs.include)) {
    clauses.push(`applies to ${listed(curRefs.include)}, wanted ${listed(wantRefs.include)}`);
  }
  if (differ(wantRefs.exclude, curRefs.exclude)) {
    clauses.push(`excludes ${listed(curRefs.exclude)}, wanted ${listed(wantRefs.exclude)}`);
  }
  return clauses;
}

/** The clauses for the rules, and for the settings of the rules both rulesets have. */
function ruleClauses(want: Ruleset, cur: Ruleset): string[] {
  const [wantTypes, curTypes] = [typesOf(want), typesOf(cur)];
  const clauses = [
    ...wantTypes.filter((type) => !curTypes.includes(type)).map((type) => `is missing the rule "${type}"`),
    ...curTypes.filter((type) => !wantTypes.includes(type)).map((type) => `has the unwanted rule "${type}"`),
  ];
  const both = (type: string) => wantTypes.includes(type) && curTypes.includes(type);
  const [wantPr, curPr] = [paramsOf(want, RULE_PULL_REQUEST), paramsOf(cur, RULE_PULL_REQUEST)];
  const [wantApprovals, curApprovals] = [
    wantPr?.required_approving_review_count,
    curPr?.required_approving_review_count,
  ];
  if (both(RULE_PULL_REQUEST) && wantApprovals !== curApprovals) {
    clauses.push(`requires ${shown(curApprovals)} approvals, wanted ${shown(wantApprovals)}`);
  }
  const [wantStrict, curStrict] = [
    paramsOf(want, RULE_CHECKS)?.strict_required_status_checks_policy,
    paramsOf(cur, RULE_CHECKS)?.strict_required_status_checks_policy,
  ];
  if (both(RULE_CHECKS) && wantStrict !== curStrict) {
    clauses.push(`has strict status checks ${shown(curStrict)}, wanted ${shown(wantStrict)}`);
  }
  return clauses;
}

/** The clauses for the required checks and the bypass list. */
function checkClauses(want: Ruleset, cur: Ruleset): string[] {
  const [wantChecks, curChecks] = [checksOf(want), checksOf(cur)];
  const curKeys = curChecks.map((check) => check.key);
  const wantKeys = wantChecks.map((check) => check.key);
  const wantContexts = wantChecks.map((check) => check.context);
  const clauses = [
    ...wantChecks
      .filter((check) => !curKeys.includes(check.key))
      .map((check) => `is missing the required check "${check.context}"`),
    ...curChecks
      .filter((check) => !wantKeys.includes(check.key) && !wantContexts.includes(check.context))
      .map((check) => `requires "${check.context}", which CI does not report`),
  ];
  if (differ(bypassOf(want), bypassOf(cur))) {
    clauses.push(`lets ${listed(bypassOf(cur))} bypass, wanted ${listed(bypassOf(want))}`);
  }
  return clauses;
}

/** One line per way `cur` differs from `want`, on the fields `repo github` manages; the server's own fields never count. */
export function rulesetDrift(want: Ruleset, cur: Ruleset): string[] {
  return [...shapeClauses(want, cur), ...ruleClauses(want, cur), ...checkClauses(want, cur)].map(
    (clause) => `ruleset ${want.name} ${clause}: ${FIX}`,
  );
}
