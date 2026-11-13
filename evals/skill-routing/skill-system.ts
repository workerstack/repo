import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { parseDoc } from "../../cli/sync/agents/frontmatter.ts";

const WHITESPACE_RUN = /\s+/g;
const HEADER = "The following skills are available for use with the Skill tool:";

const INSTRUCTION =
  "Reply with only the name of the skill you would load for the user's message, or none when no skill fits.";

/**
 * The system prompt for `dir`, a folder of `<name>/SKILL.md` files; throws an Error naming a file with no
 * description.
 */
export function skillSystem(dir: string): string {
  // A skill's frontmatter as far as routing reads it.
  const frontmatter = z.looseObject({ description: z.string() });

  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();

  const lines = names.map((name) => {
    const file = join(dir, name, "SKILL.md");
    const parsed = frontmatter.safeParse(parseDoc(file, readFileSync(file, "utf8")).data);
    const description = parsed.success ? parsed.data.description.replaceAll(WHITESPACE_RUN, " ").trim() : "";

    if (description === "") throw new Error(`${file}: missing description`);

    return `- ${name}: ${description}`;
  });

  return [HEADER, ...lines, "", INSTRUCTION].join("\n");
}
