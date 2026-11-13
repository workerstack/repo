/** GitHub Actions' app id: a required check from any other app does not satisfy a ruleset. */
export const GITHUB_ACTIONS_APP_ID: number = 15368;

/** The `RepositoryRole` id of an admin. */
export const ADMIN_ROLE_ID: number = 5;
export const ADMIN_ROLE_TYPE: string = "RepositoryRole";
export const BYPASS_ALWAYS: string = "always";

export const MAIN_RULESET: string = "main";
export const TAGS_RULESET: string = "release tags";
export const DEFAULT_BRANCH_REF: string = "~DEFAULT_BRANCH";
export const RELEASE_TAG_REFS: readonly string[] = ["refs/tags/v*", "refs/tags/*@*"];
export const ENFORCEMENT_ACTIVE: string = "active";
export const TARGET_BRANCH: string = "branch";
export const TARGET_TAG: string = "tag";

export const RULE_DELETION: string = "deletion";
export const RULE_NON_FAST_FORWARD: string = "non_fast_forward";
export const RULE_PULL_REQUEST: string = "pull_request";
export const RULE_CHECKS: string = "required_status_checks";
export const RULE_CREATION: string = "creation";
export const RULE_UPDATE: string = "update";

export const UNSET: string = "unset";

/** Every drift line ends with this, the command that converges. */
export const FIX: string = "run `bun repo github`";

/** The prefix of every line `repo github` prints, and `repo check`'s for this check. */
export const GITHUB_PREFIX: string = "repo github:";
export const CHECK_PREFIX: string = "github:";
export const GITHUB_USAGE: string = "usage: repo github [--check]";
export const CHECK_FLAG: string = "--check";
export const MID_DOT: string = " · ";
export const UP_TO_DATE: string = "up to date";
export const NO_ORIGIN: string = "no GitHub origin";
export const NO_ORIGIN_LINE: string = `${NO_ORIGIN}; \`git remote get-url origin\` is not a github.com URL`;

/** The request timeout of every gh call, so `repo check` waits for the slowest of them, not for a hung one. */
export const GH_TIMEOUT_MS: number = 5000;
export const GH_AUTH_EXIT: number = 4;
export const HTTP_STATUS: RegExp = /HTTP (\d{3})/;
export const DENIED_STATUSES: readonly number[] = [401, 403, 404];
export const NOT_FOUND: number = 404;
export const LOGIN_HINT: string = "log in as an admin with `gh auth login`";
export const INSTALL_HINT: string = "install it from https://cli.github.com";
export const RETRY_HINT: string = "try again";
export const CI_SKIP: string = "CI's token cannot read admin settings";

/** `https://github.com/o/r(.git)`, `git@github.com:o/r.git` and `ssh://git@github.com/o/r.git`: owner and repo. */
export const GITHUB_REMOTE: RegExp =
  /^(?:https?:\/\/(?:[^@/\s]+@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;

/** The help line of `repo github`. */
export const GITHUB_SUMMARY: string =
  "apply the repository's rulesets, security settings and metadata, or report drift with --check";

/** One, for the plural of a count, and a second's milliseconds. */
export const ONE: number = 1;
export const MS_PER_SECOND: number = 1000;

/** The status GitHub reports for a security feature that is on. */
export const ENABLED: string = "enabled";
