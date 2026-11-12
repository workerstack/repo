import {
  BOM,
  FRONTMATTER,
  HTML_CLOSE,
  HTML_OPEN,
  LEGACY_HEADERS,
  OWNED_LOOSE,
  OWNED_TOKEN,
  SHEBANG,
} from "./header.constants.ts";
import { formatOf } from "./validate-formats.ts";

const LINE_BREAK = /\r?\n/;

/** The comment marker a format's line comment opens with; `<!--` also closes with `-->`. */
export type CommentSyntax = "#" | "//" | "<!--";

/** The exact header line sync writes in `syntax`. */
function ownedLine(syntax: CommentSyntax): string {
  return syntax === HTML_OPEN ? `${HTML_OPEN} ${OWNED_TOKEN} ${HTML_CLOSE}` : `${syntax} ${OWNED_TOKEN}`;
}

/**
 * The line of `text` a header sits on: line 1, or line 2 when line 1 is a shebang; a BOM and a CR are dropped.
 * Null when a shebang has no line after it.
 */
export function headerLine(text: string): string | null {
  const rows = (text.startsWith(BOM) ? text.slice(BOM.length) : text).split(LINE_BREAK);
  const [first, second] = rows /* split always yields line 1, even of an empty text */ as [string, string?];

  return first.startsWith(SHEBANG) ? (second ?? null) : first;
}

/** Whether `text` carries sync's header line: the new form read loosely, or one of the legacy lines exactly. */
export function hasOwnedHeader(text: string): boolean {
  const line = headerLine(text);

  return line !== null && (LEGACY_HEADERS.includes(line) || OWNED_LOOSE.test(line));
}

/**
 * `content` with sync's header line in the comment syntax registered for `rel`: an owned header line is replaced,
 * otherwise the header goes on line 1, or line 2 after a shebang. A file that opens with frontmatter, a format with
 * no comment and an unregistered path come back unchanged. A BOM stays first and CRLF line endings stay.
 */
export function stamp(rel: string, content: string): string {
  const syntax = formatOf(rel)?.comment ?? null;

  if (syntax === null || FRONTMATTER.test(content)) return content;
  const bom = content.startsWith(BOM) ? BOM : "";
  const body = content.slice(bom.length);
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const rows = body.split(eol);
  rows.splice(body.startsWith(SHEBANG) ? 1 : 0, hasOwnedHeader(body) ? 1 : 0, ownedLine(syntax));

  return bom + rows.join(eol);
}
