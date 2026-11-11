/** The Conventional Commits types a commit may use. */
export const TYPES: readonly string[] = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "test",
  "docs",
  "build",
  "ci",
  "chore",
  "revert",
];

/** A Conventional Commits header: `type(scope)!: subject`. */
export const HEADER: RegExp = /^(?<type>[^\s():!]+)(?:\((?<scope>[^()]*)\))?(?<bang>!)?: (?<subject>.+)$/;

/** The first line of a `BREAKING CHANGE:` footer. */
export const BREAKING_FOOTER: RegExp = /^BREAKING[ -]CHANGE: /;

/** Whether a commit is breaking: its header has `!`, or a line of its body is a `BREAKING CHANGE:` footer. */
export function isBreaking(header: string, body: readonly string[]): boolean {
  return HEADER.exec(header)?.groups?.["bang"] === "!" || body.some((line) => BREAKING_FOOTER.test(line));
}
