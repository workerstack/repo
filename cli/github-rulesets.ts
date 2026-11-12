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

function pullRequest(): Rule {
  return {
    parameters: {
      dismiss_stale_reviews_on_push: false,
      require_code_owner_review: false,
      require_last_push_approval: false,
      required_approving_review_count: 0,
      required_review_thread_resolution: false,
    },
    type: RULE_PULL_REQUEST,
  };
}

function statusChecks(checks: readonly string[]): Rule[] {
  return checks.length === 0
    ? []
    : [
        {
          parameters: {
            required_status_checks: checks.map((context) => ({ context, integration_id: GITHUB_ACTIONS_APP_ID })),
            strict_required_status_checks_policy: false,
          },
          type: RULE_CHECKS,
        },
      ];
}

function rulesetFrom({ name, target, include, rules }: Parts): Ruleset {
  return {
    bypass_actors: ADMINS,
    conditions: { ref_name: { exclude: [], include } },
    enforcement: ENFORCEMENT_ACTIVE,
    name,
    rules,
    target,
  };
}

/**
 * The two rulesets: `main` bans deletion and force pushes and wants a pull request with every CI check; the release
 * tags can only be created, moved or deleted by an admin, which is who runs `repo release`. Admins bypass both.
 */
export function wantedRulesets(checks: readonly string[]): Ruleset[] {
  return [
    rulesetFrom({
      include: [DEFAULT_BRANCH_REF],
      name: MAIN_RULESET,
      rules: [{ type: RULE_DELETION }, { type: RULE_NON_FAST_FORWARD }, pullRequest(), ...statusChecks(checks)],
      target: TARGET_BRANCH,
    }),
    rulesetFrom({
      include: [...RELEASE_TAG_REFS],
      name: TAGS_RULESET,
      rules: [{ type: RULE_CREATION }, { type: RULE_UPDATE }, { type: RULE_DELETION }],
      target: TARGET_TAG,
    }),
  ];
}

/** A setting that prints as a count or as on/off. */
type Setting = number | boolean;

function shown(value: Setting | undefined) {
  return String(value ?? UNSET);
}

function listed(items: readonly (string | number)[]) {
  return `[${items.join(", ")}]`;
}

function sorted(items: readonly string[]) {
  return items.toSorted();
}

function differ(a: readonly string[], b: readonly string[]) {
  return listed(sorted(a)) !== listed(sorted(b));
}

function paramsOf(ruleset: Ruleset, type: string): RuleParameters | undefined {
  return ruleset.rules.find((rule) => rule.type === type)?.parameters;
}

function typesOf(ruleset: Ruleset) {
  return ruleset.rules.map((rule) => rule.type);
}

function checksOf(ruleset: Ruleset) {
  return (paramsOf(ruleset, RULE_CHECKS)?.required_status_checks ?? []).map((check) => ({
    context: check.context,
    key: `${check.context}#${check.integration_id}`,
  }));
}

function bypassOf(ruleset: Ruleset) {
  return ruleset.bypass_actors.map((actor) => `${actor.actor_type} ${actor.actor_id} ${actor.bypass_mode}`);
}

/** The clauses for the fields that hold one value or a list of them. */
function shapeClauses(want: Ruleset, cur: Ruleset): string[] {
  const clauses: string[] = [];

  if (want.target !== cur.target) clauses.push(`targets "${cur.target}", wanted "${want.target}"`);

  if (want.enforcement !== cur.enforcement) clauses.push(`is "${cur.enforcement}", wanted "${want.enforcement}"`);
  const [wantRefs, curRefs] = [want.conditions.ref_name, cur.conditions.ref_name];

  if (differ(wantRefs.include, curRefs.include))
    clauses.push(`applies to ${listed(curRefs.include)}, wanted ${listed(wantRefs.include)}`);

  if (differ(wantRefs.exclude, curRefs.exclude))
    clauses.push(`excludes ${listed(curRefs.exclude)}, wanted ${listed(wantRefs.exclude)}`);

  return clauses;
}

/** The clause for the approvals a pull request needs, when both rulesets have that rule and differ. */
function approvalClauses(want: Ruleset, cur: Ruleset): string[] {
  const wantApprovals = paramsOf(want, RULE_PULL_REQUEST)?.required_approving_review_count;
  const curApprovals = paramsOf(cur, RULE_PULL_REQUEST)?.required_approving_review_count;

  return wantApprovals === curApprovals
    ? []
    : [`requires ${shown(curApprovals)} approvals, wanted ${shown(wantApprovals)}`];
}

/** The clause for strict status checks, when both rulesets have that rule and differ. */
function strictClauses(want: Ruleset, cur: Ruleset): string[] {
  const wantStrict = paramsOf(want, RULE_CHECKS)?.strict_required_status_checks_policy;
  const curStrict = paramsOf(cur, RULE_CHECKS)?.strict_required_status_checks_policy;

  if (wantStrict === curStrict) return [];

  return [`has strict status checks ${shown(curStrict)}, wanted ${shown(wantStrict)}`];
}

/** The clauses for the settings of the rules both rulesets have (`shared` holds their types). */
function settingClauses(want: Ruleset, cur: Ruleset, shared: readonly string[]): string[] {
  return [
    ...(shared.includes(RULE_PULL_REQUEST) ? approvalClauses(want, cur) : []),
    ...(shared.includes(RULE_CHECKS) ? strictClauses(want, cur) : []),
  ];
}

/** The clauses for the rules, and for the settings of the rules both rulesets have. */
function ruleClauses(want: Ruleset, cur: Ruleset): string[] {
  const [wantTypes, curTypes] = [typesOf(want), typesOf(cur)];

  return [
    ...wantTypes.filter((type) => !curTypes.includes(type)).map((type) => `is missing the rule "${type}"`),
    ...curTypes.filter((type) => !wantTypes.includes(type)).map((type) => `has the unwanted rule "${type}"`),
    ...settingClauses(
      want,
      cur,
      wantTypes.filter((type) => curTypes.includes(type)),
    ),
  ];
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

  if (differ(bypassOf(want), bypassOf(cur)))
    clauses.push(`lets ${listed(bypassOf(cur))} bypass, wanted ${listed(bypassOf(want))}`);

  return clauses;
}

/**
 * One line per way `cur` differs from `want`, on the fields `repo github` manages; the server's own fields never
 * count.
 */
export function rulesetDrift(want: Ruleset, cur: Ruleset): string[] {
  return [...shapeClauses(want, cur), ...ruleClauses(want, cur), ...checkClauses(want, cur)].map(
    (clause) => `ruleset ${want.name} ${clause}: ${FIX}`,
  );
}
