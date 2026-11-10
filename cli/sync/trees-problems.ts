/** Several source problems at once, so a render reports each instead of the first. */
export class TreesProblems extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(problems.join("\n"));
    this.problems = problems;
  }
}
