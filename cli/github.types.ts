import type { Json } from "./json.ts";

/** The settings of a rule that `repo github` reads and writes; GitHub's other parameters are left as they are. */
export type RuleParameters = {
  required_approving_review_count?: number | undefined;
  dismiss_stale_reviews_on_push?: boolean | undefined;
  require_code_owner_review?: boolean | undefined;
  require_last_push_approval?: boolean | undefined;
  required_review_thread_resolution?: boolean | undefined;
  strict_required_status_checks_policy?: boolean | undefined;
  required_status_checks?: { context: string; integration_id?: number | undefined }[] | undefined;
};

export type Rule = { type: string; parameters?: RuleParameters | undefined };

export type BypassActor = { actor_id: number; actor_type: string; bypass_mode: string };

/** A ruleset as the API takes it in a POST or PUT body. */
export type Ruleset = {
  name: string;
  target: string;
  enforcement: string;
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  rules: Rule[];
  bypass_actors: BypassActor[];
};

/** A ruleset as it is on GitHub: the body plus the id a PUT addresses. */
export type CurrentRuleset = Ruleset & { id: number };

/** The package.json fields the settings come from; an unset one is left alone on GitHub. */
export type GithubManifest = {
  description?: string | undefined;
  homepage?: string | undefined;
  /** As written; `keywordLines` judges its shape. */
  keywords?: Json | undefined;
};

/**
 * What the repository should look like; `description`, `homepage` and `topics` are absent when package.json is
 * silent.
 */
export type Wanted = {
  rulesets: Ruleset[];
  description?: string;
  homepage?: string;
  topics?: string[];
};

export type WantedResult = { ok: true; wanted: Wanted } | { ok: false; errors: string[] };

/** What the repository looks like now. */
export type Current = {
  rulesets: CurrentRuleset[];
  reporting: boolean;
  alerts: boolean;
  scanning: boolean;
  pushProtection: boolean;
  securityUpdates: boolean;
  description: string;
  homepage: string;
  topics: string[];
};

/** One setting that differs, with the line that says how to fix it; a ruleset's lines carry its name. */
export type Drift = {
  area:
    | "ruleset"
    | "reporting"
    | "alerts"
    | "scanning"
    | "pushProtection"
    | "securityUpdates"
    | "description"
    | "homepage"
    | "topics";
  name?: string;
  message: string;
  /** For description, homepage and topics: the value package.json wants. */
  value?: string | string[];
};
