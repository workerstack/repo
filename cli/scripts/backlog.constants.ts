/** The backlog file under the root, and how messages name it. */
export const BACKLOG_DIR = ".repo";
export const BACKLOG_NAME = "backlog.md";
export const BACKLOG_REL: string = `${BACKLOG_DIR}/${BACKLOG_NAME}`;

/** What `repo backlog` takes. */
export const BACKLOG_ARGS = "[list] | add <text> | start <N|text> | done <N|text> | clear [--yes]";
export const USAGE: string = `usage: repo backlog ${BACKLOG_ARGS}`;

export const YES_FLAG = "--yes";

/** The box characters of an item, and the verbs that set them. */
export const BOX_PROGRESS = "-";
export const BOX_DONE = "x";

/** Boxes in list order: open, in progress, done. */
export const BOX_ORDER = " -x";

/** The first item on a line: indent and bullet, the box character, then the end of the line or a space. */
export const ITEM_RE: RegExp = /^(\s*[-*+]\s+\[)([ xX-])(\](?:\s[\s\S]*)?)$/;
export const LINE_NUMBER_RE: RegExp = /^\d+$/;
export const NEWLINES_RE: RegExp = /\s*[\r\n]+\s*/g;
export const CR_END_RE: RegExp = /\r$/;

/** `Array#at` index of the last element, the box's group in an item match, an exit code and the line endings. */
export const LAST = -1;
export const BOX_GROUP = 2;
export const EXIT_USAGE = 2;
export const NEWLINE = "\n";

/** An append reads this many bytes from the end of the file: enough to see a CRLF. */
export const TAIL_BYTES = 2;
export const CRLF = "\r\n";

export const EMPTY = "backlog is empty";
export const NO_DONE = "no done lines";

export function noLine(n: number): string {
  return `no line ${n} in ${BACKLOG_REL}`;
}

export function notItem(n: number): string {
  return `line ${n} is not an item`;
}

export function noMatch(text: string): string {
  return `no item matches "${text}"`;
}

export function ambiguous(text: string, lines: readonly number[]): string {
  return `"${text}" matches lines ${lines.join(", ")}; pick one`;
}

export function already(n: number, state: string): string {
  return `line ${n} is already ${state}`;
}

export function notItems(k: number): string {
  return `${k} lines are not items`;
}

export function askClear(k: number): string {
  return `delete ${k} done lines? rerun with ${YES_FLAG}`;
}

export function cleared(k: number): string {
  return `deleted ${k} done lines`;
}
