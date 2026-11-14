/** A pattern that matches any message and keeps each one it is tested on, in the order RuleTester reports them. */
export class MessageRecorder extends RegExp {
  readonly seen: string[];

  constructor(seen: string[]) {
    super("");
    this.seen = seen;
  }

  override test(message: string): boolean {
    this.seen.push(message);

    return true;
  }
}
