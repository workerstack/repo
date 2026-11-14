/** The shapes of the shared bash parse: word parts, words, redirects, tokens, command nodes, and a walk's dir. */

/**
 * A piece of a word. `lit` is text in the spelling the path gate keeps (`text`, a backslash before a plain character
 * kept for a Windows separator) and in bash's (`bash`). `param` is an expansion whose value the parse cannot know
 * (`$x`, `${…}`, `$((…))`), with the bodies of the `$(…)` inside it. `subst` is a command substitution (`$(…)`, a
 * backtick, `<(…)` or `>(…)`) with the script it runs.
 */
export type Part =
  | { kind: "lit"; text: string; bash: string }
  | { kind: "param"; raw: string; substs: readonly string[] }
  | { kind: "subst"; raw: string; body: string };

/** One shell word: its parts, and its text as typed. */
export type ShellWord = { parts: readonly Part[]; raw: string };

/**
 * A word as a gate judges it: the text bash gives it, the text as typed, and whether that text is its value (no
 * expansion and no leading `~`).
 */
export type ReadWord = { text: string; raw: string; literal: boolean };

/** A word read from a text, and the index past it. */
export type WordSpan = { word: ShellWord; end: number };

/** A redirect: its operator, the word after it, and for a heredoc the body it feeds. */
export type Redirect = { op: string; target: ShellWord; body?: ShellWord };

export type Token =
  | { kind: "word"; word: ShellWord }
  | { kind: "op"; op: string }
  | { kind: "redirect"; redirect: Redirect };

/** A simple command; `data` marks the words of a `for` list, a `case` word or an arithmetic head, which run nothing. */
export type Simple = { kind: "simple"; words: readonly ShellWord[]; redirects: readonly Redirect[]; data?: true };

/**
 * A command node. `seq` runs its items in order in one state (`;`, a newline, `&&`, `{ }`); `or` runs `right` after
 * `left` and joins both outcomes; `pipe` runs each item in a copy, fed by the one before; `async` and `subshell` run
 * in a copy; `if` (`body` or `orElse`), `loop` and `case` join their branches; `func` defines `name`; `redir` runs
 * `body` with the redirects written after it.
 */
export type ShellNode =
  | Simple
  | { kind: "seq"; items: readonly ShellNode[] }
  | { kind: "or"; left: ShellNode; right: ShellNode }
  | { kind: "pipe"; items: readonly ShellNode[] }
  | { kind: "async"; body: ShellNode }
  | { kind: "subshell"; body: ShellNode }
  | { kind: "if"; cond: ShellNode; body: ShellNode; orElse?: ShellNode }
  | { kind: "loop"; cond: ShellNode; body: ShellNode }
  | { kind: "case"; word: Simple; arms: readonly ShellNode[] }
  | { kind: "func"; name: string; body: ShellNode }
  | { kind: "redir"; body: ShellNode; redirects: readonly Redirect[] };

/** What a command reads on stdin: nothing the gate judges, a script it can read, or one it cannot (`cause`). */
export type Stdin = { kind: "none" } | { kind: "text"; text: string } | { kind: "opaque"; cause: string };

/** The dir a command runs in: a path, or unknown with the text that lost it, named in a deny reason. */
export type Dir = { known: true; path: string } | { known: false; cause: string };

/** What a walk hands its visitor: a simple command with its dir, or a script a shell reads that the gate cannot. */
export type Visited = (Simple & { dir: Dir }) | { kind: "opaque"; cause: string; dir: Dir };

/** A script a command makes bash run: its text and whether it runs in the caller's state, or an unreadable one. */
export type Script = { kind: "text"; text: string; inherits: boolean } | { kind: "opaque"; cause: string };
