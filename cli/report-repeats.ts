import { TWICE } from "./config.constants.ts";

/** A zod refinement context: where a list reports an issue. */
type Issues = { addIssue: (issue: { code: "custom"; message: string }) => void };

/** Reports each name `names` lists more than once, with its count; the refinement of a list of unique names. */
export function reportRepeats(names: readonly string[], ctx: Issues): void {
  const counts = new Map<string, number>();

  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);

  for (const [name, count] of counts) {
    if (count === 1) continue;
    const times = count === TWICE ? "twice" : `${count} times`;
    ctx.addIssue({ code: "custom", message: `${JSON.stringify(name)} is listed ${times}` });
  }
}
