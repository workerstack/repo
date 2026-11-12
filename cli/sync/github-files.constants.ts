export const SECURITY_PATH: string = "SECURITY.md";
export const CONTRIBUTING_PATH: string = "CONTRIBUTING.md";
export const CODEOWNERS_PATH: string = ".github/CODEOWNERS";
export const PULL_REQUEST_PATH: string = ".github/PULL_REQUEST_TEMPLATE.md";
export const BUG_REPORT_PATH: string = ".github/ISSUE_TEMPLATE/bug_report.yml";
export const ISSUE_CONFIG_PATH: string = ".github/ISSUE_TEMPLATE/config.yml";

export const MANIFEST_PATH: string = "package.json";

/** A GitHub repository in `repository.url` or the string form: `git+https://github.com/o/r.git`, `github:o/r` or `o/r`. */
export const GITHUB_REPOSITORY: RegExp =
  /^(?:git\+)?(?:https:\/\/github\.com\/|github:)?([\w.-]+\/[\w.-]+?)(?:\.git)?$/;

export const ADVISORIES_URL: string = "https://github.com/%REPO%/security/advisories/new";

export const SECURITY: string = `# Security

Report a vulnerability with GitHub private vulnerability reporting: %ADVISORIES%

Please do not open a public issue for a vulnerability.
`;

export const CONTRIBUTING: string = `# Contributing

- Install with \`bun install\`.
- \`bun repo ci\` must pass.
- Write commit messages as Conventional Commits.
- Keep one change to a pull request.
`;

export const PULL_REQUEST: string = `## What and why

## Checklist

- [ ] \`bun repo ci\` passes
- [ ] The commit message is a Conventional Commit
- [ ] The pull request is one change
`;

export const BUG_REPORT: string = `name: Bug report
description: Something does not work as documented
labels:
  - bug
body:
  - type: markdown
    attributes:
      value: For a security vulnerability, use the private report link in the issue chooser instead.
  - type: input
    id: version
    attributes:
      label: Version
      description: The package version, like 1.0.0
    validations:
      required: true
  - type: textarea
    id: what-happened
    attributes:
      label: What happened
      description: The steps to reproduce, what you expected and what you saw
    validations:
      required: true
`;

export const ISSUE_CONFIG: string = `blank_issues_enabled: false
contact_links:
  - name: Report a security vulnerability
    url: %ADVISORIES%
    about: Report it privately, not in a public issue
`;
