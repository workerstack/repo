/** The first value that is neither undefined nor "", or undefined when there is none. */
export function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  return values.find((v) => v !== undefined && v !== "");
}
