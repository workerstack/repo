/** The shapes of the shared bash parse: word parts, words, redirects, tokens, command nodes, and a walk's dir. */

/**
 * A piece of a word. `lit` is text in the spelling the path gate keeps (`text`, a backslash before a plain character
 * kept for a Windows separator) and in bash's (`bash`), `quoted` when quotes or a backslash keep bash from reading a
 * brace or a pattern in it. `param` is an expansion (`$x`, `${…}`, `$((…))`), with the
 * bodies of the `$(…)` inside it and whether double quotes (or a heredoc body) keep it from being split. `subst` is a
 * command substitution (`$(…)`, a backtick, `<(…)` or `>(…)`) with the script it runs.
 */
export type Part =
  | { kind: "lit"; text: string; bash: string; quoted: boolean }
  | { kind: "param"; raw: string; substs: readonly string[]; quoted: boolean }
  | { kind: "subst"; raw: string; body: string };

/**
 * One shell word: its parts, and its text as typed. A field, a word after expansion, keeps the raw of the word it came
 * from, so an assignment is still found as bash finds it, before expansion.
 */
export type ShellWord = { parts: readonly Part[]; raw: string };

/**
 * A word as a gate judges it, expanded by the variables the line sets: the text bash gives it (an unknown part as
 * typed); the path gate's two spellings of it, a substitution as empty (`pathText` with the backslashes a Windows path
 * keeps, `pathBash` as bash reads them); the text as typed; whether every part is known; and the known text around
 * each unknown part (`pieces`, one item when all is known); and for a pattern bash would match on disk, the pattern
 * with each character that matches only itself escaped (`glob`), else null. A pattern character is an unknown part.
 */
export type ReadWord = {
  text: string;
  pathText: string;
  pathBash: string;
  raw: string;
  literal: boolean;
  pieces: readonly string[];
  glob: string | null;
};

/** A variable's value: known text, or unknown with the text that lost it. */
export type Value = { known: true; text: string } | { known: false; cause: string };

/** The variables a walk knows; a name not here is unknown. */
export type Vars = ReadonlyMap<string, Value>;

/** The variables a line starts with from the shell that runs it: the home folder and the `cd` search path. */
export type StartEnv = { home: string; cdpath: string; path: string };

/** Where a command runs: its dir and the variables it sees. */
export type Scope = { dir: Dir; vars: Vars };

/** A word read from a text, and the index past it. */
export type WordSpan = { word: ShellWord; end: number };

/** A redirect: its operator, the word after it, and for a heredoc the body it feeds. */
export type Redirect = { op: string; target: ShellWord; body?: ShellWord };

export type Token =
  | { kind: "word"; word: ShellWord }
  | { kind: "op"; op: string }
  | { kind: "redirect"; redirect: Redirect };

/**
 * How bash reads the words of a command that runs nothing: `fields` makes each word its fields as for a command (a
 * `for` list), `value` reads each as one value (a `case` word, an arithmetic head).
 */
export type DataRead = "fields" | "value";

/** A simple command; `data` marks the words of a `for` list, a `case` word or an arithmetic head, which run nothing. */
export type Simple = { kind: "simple"; words: readonly ShellWord[]; redirects: readonly Redirect[]; data?: DataRead };

/**
 * A command node. `for` runs `body` once per word of `words` (`"$@"` when null) with `name` set to it, or for
 * `select` to a word the user picks. `seq` runs its items in order in one state (`;`, a newline, `&&`, `{ }`), each
 * command taken to succeed; `or` runs `right` after `left` and joins both outcomes; `pipe` runs each item in a copy,
 * fed by the one before; `async` and `subshell` run in a copy; `if` (`body` or `orElse`), `loop` and `case` join
 * their branches; `func` defines `name`; `redir` runs `body` with the redirects written after it.
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
  | { kind: "for"; name: string; words: Simple | null; body: ShellNode; select?: true }
  | { kind: "case"; word: Simple; arms: readonly ShellNode[] }
  | { kind: "func"; name: string; body: ShellNode }
  | { kind: "redir"; body: ShellNode; redirects: readonly Redirect[] };

/** What a command reads on stdin: nothing the gate judges, a script it can read, or one it cannot (`cause`). */
export type Stdin = { kind: "none" } | { kind: "text"; text: string } | { kind: "opaque"; cause: string };

/** The dir a command runs in: a path, or unknown with the text that lost it, named in a deny reason. */
export type Dir = { known: true; path: string } | { known: false; cause: string };

/**
 * What a walk hands its visitor: a simple command with its dir and variables, or a script a shell reads that the gate
 * cannot.
 */
export type Visited = (Simple & Scope) | { kind: "opaque"; cause: string; dir: Dir };

/**
 * A script a command makes bash run: its text, whether it runs in the caller's state, and the file it was read from;
 * a file a shell reads, by the word that names it; or an unreadable one.
 */
export type Script =
  | { kind: "text"; text: string; inherits: boolean; file?: string }
  | { kind: "file"; word: ShellWord; inherits: boolean }
  | { kind: "opaque"; cause: string };
