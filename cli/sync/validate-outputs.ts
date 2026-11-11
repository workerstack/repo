import path from "node:path";

import type { z } from "zod";

import type { Output } from "./outputs.ts";
import { type FormatEntry, OUTPUT_FORMATS, parseContent } from "./validate-formats.ts";
import { linkProblem, planLinks } from "./validate-links.ts";
import { isCurrent } from "./write.ts";

const REGISTER_HINT = "no output format registered; add it to cli/sync/validate.ts";

/** `dotted.path: message` per zod issue; an issue at the root has no path. */
function schemaProblems(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const where = issue.path.map(String).join(".");
    return where === "" ? issue.message : `${where}: ${issue.message}`;
  });
}

/** The problems of one file output: its parse error, its schema misses, or the missing registration. */
function fileProblems(output: Extract<Output, { kind: "file" }>, formats: readonly FormatEntry[]): string[] {
  const entry = formats.find((candidate) => candidate.match(output.path));
  if (entry === undefined) return [REGISTER_HINT];
  const parsed = parseContent(entry.format, output.content);
  if ("problem" in parsed) return [parsed.problem];
  return entry.schema === undefined ? [] : schemaProblems(entry.schema, parsed.value);
}

/**
 * Whether `output` is a block file sync plans byte for byte as the user keeps it: theirs to fix, as sync writes
 * nothing.
 */
function leftAsIs(root: string, output: Output): boolean {
  return (
    output.kind === "file" && output.managed === "block" && isCurrent(path.join(root, output.path), output.content)
  );
}

/**
 * Every problem in `outputs` as `path: problem` lines, in output order, so a caller can refuse before it writes
 * anything. A file must parse in its registered format and match that format's schema; a path with no registered
 * format is a problem; a block file planned exactly as it is on disk is not checked, as sync leaves it as the user
 * wrote it (invalid settings JSONC, say, which the settings pass warns about). A link must resolve, against what is
 * on disk under `root` plus the planned outputs (a link to another planned link, or into the dir of a planned file,
 * resolves). `formats` is a test seam.
 */
export function validateOutputs(
  root: string,
  outputs: readonly Output[],
  formats: readonly FormatEntry[] = OUTPUT_FORMATS,
): string[] {
  const plan = planLinks(outputs);
  const lines: string[] = [];
  for (const output of outputs) {
    if (leftAsIs(root, output)) continue;
    if (output.kind === "file") {
      lines.push(...fileProblems(output, formats).map((problem) => `${output.path}: ${problem}`));
      continue;
    }
    const problem = linkProblem(root, output, plan);
    if (problem !== null) lines.push(problem);
  }
  return lines;
}
