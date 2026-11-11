import { SECOND_GROUP } from "./docs-fences.constants.ts";

/** One line of markdown, numbered from 1. */
type Line = { line: number; text: string };

/** A fenced block: its info string, the line that opens it and the lines inside. */
type Fence = { info: string; start: number; body: string[] };

/** A markdown file split into the lines outside any fence and the fences. */
export type Markdown = { prose: Line[]; fences: Fence[] };

const OPEN = /^ {0,3}(`{3,})([^`]*)$/;
const CLOSE = /^ {0,3}(`{3,})\s*$/;

/** The text a capture group matched; the patterns in the docs checks fill every group they name. */
export function group(match: RegExpExecArray, index: number): string {
  return match[index] /* a group the pattern always fills */ as string;
}

/** Splits markdown into prose and backtick-fenced blocks; a fence still open at the end closes there. */
export function splitMarkdown(text: string): Markdown {
  const prose: Line[] = [];
  const fences: Fence[] = [];
  let open: { ticks: number; fence: Fence } | null = null;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = index + 1;
    if (open === null) {
      const opening = OPEN.exec(raw);
      if (opening === null) prose.push({ line, text: raw });
      else
        open = {
          fence: { body: [], info: group(opening, SECOND_GROUP).trim(), start: line },
          ticks: group(opening, 1).length,
        };
      continue;
    }
    const closing = CLOSE.exec(raw);
    if (closing !== null && group(closing, 1).length >= open.ticks) {
      fences.push(open.fence);
      open = null;
    } else open.fence.body.push(raw);
  }
  if (open !== null) fences.push(open.fence);
  return { fences, prose };
}

/** The first capture group of an alternation that matched. */
export function firstGroup(match: RegExpMatchArray): string {
  return match.slice(1).find(Boolean) /* one alternative always matches */ as string;
}
