/** The words of a `git push` command line that the parser tells apart. */
export const PUSH = "push";
export const HEAD = "HEAD";
export const DECIMAL = 10;

/** An open backlog line that marks a ci job blocked, from column 0: ``- [ ] blocked: `<job>` <why>`` or `- [-]`. */
export const BLOCKED_LINE_RE: RegExp = /^- \[[ -]\] blocked: `([^`\r\n]+)`/gmu;
