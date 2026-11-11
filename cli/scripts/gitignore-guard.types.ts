/** One `.gitignore` write: the file and the literal lines it would add. */
export type IgnoreEdit = {
  file: string;
  added: string[];
};

/** A tool call's argument bag; the shape varies per host and tool, so every field is read with a guard. */
export type ToolArgs = Record<string, unknown>;

/** A shell write of literal text to one file. */
export type ShellWrite = {
  file: string;
  append: boolean;
  text: string;
};

/** One word or one `>`, `>>`, `|` operator of a parsed shell line. */
export type ShellToken = {
  word?: string;
  op?: string;
};

/** An added line that a parent `.gitignore` already ignores, with the rule that covers it. */
export type RedundantLine = {
  line: string;
  rule: string;
};

/** A shell command's first line, and the heredoc body under it (null without one). */
export type ShellParts = { head: string; body: string | null };

/** The parent rule that ignores one probe path: its file relative to the scratch repo, line number and pattern. */
export type IgnoreHit = { source: string; n: string; pattern: string };
