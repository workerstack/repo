/** A Conventional Commits header: `type(scope)!: subject`. */
export const HEADER: RegExp = /^(?<type>[^\s():!]+)(?:\((?<scope>[^()]*)\))?(?<bang>!)?: (?<subject>.+)$/;

const FOOTER = /^BREAKING[ -]CHANGE: /;

/** Whether a commit is breaking: its header has `!`, or a line of its body is a `BREAKING CHANGE:` footer. */
export function isBreaking(header: string, body: readonly string[]): boolean {
  return HEADER.exec(header)?.groups?.["bang"] === "!" || body.some((line) => FOOTER.test(line));
}
