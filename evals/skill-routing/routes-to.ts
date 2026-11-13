const LEADING_SLASH = /^\//;
const WRAPPING_TICKS = /^`+|`+$/g;
const TRAILING_DOT = /\.$/;

/** A grader for the skill name `name`: the first line of the answer, normalized, must equal it exactly. */
export function routesTo(name: string): (answer: string) => boolean {
  return (answer) => {
    const first = answer.trim().split("\n")[0] ?? "";

    const cleaned = first
      .trim()
      .toLowerCase()
      .replaceAll(WRAPPING_TICKS, "")
      .replace(LEADING_SLASH, "")
      .replace(TRAILING_DOT, "");

    return cleaned === name;
  };
}
