/** The simple commands bash would run for a shell command, each as the words the path gate judges. */
import path from "node:path";

import type { Part, ShellWord, Simple } from "./shell-ast.types.ts";
import { shellFlow } from "./shell-flow.ts";

/** Redirects whose word is no file: a heredoc's delimiter and a here-string's text. */
const DATA_REDIRECTS: ReadonlySet<string> = /* @__PURE__ */ new Set(["<<", "<<-", "<<<"]);

/**
 * A simple command: its words, then the files its redirects read or write; each word as bash reads it, which drops a
 * backslash outside quotes that `words` keeps for a Windows path; the indices of the redirect files; and the indices
 * of the words that hold an expansion (`$name`, `${…}`, `$(…)` or a backtick), whose value the gate cannot know. A
 * substitution reads as empty: its own commands are commands of their own.
 */
export type ShellCommand = {
  bashWords: string[];
  expanded: ReadonlySet<number>;
  redirects: ReadonlySet<number>;
  words: string[];
};

/** Every simple command a shell command runs, and whether it also runs a script the gate cannot read. */
export type ShellWords = { commands: ShellCommand[]; hasUnreadScript: boolean };

type Lit = Extract<Part, { kind: "lit" }>;

/** A part as the gate reads it: a literal by `pick`, a parameter as typed, a substitution as empty. */
function partText(part: Part, pick: (lit: Lit) => string): string {
  if (part.kind === "lit") return pick(part);

  return part.kind === "param" ? part.raw : "";
}

function spelled(word: ShellWord, pick: (lit: Lit) => string): string {
  return word.parts.map((part) => partText(part, pick)).join("");
}

/** The indices of `words` that `keep` picks. */
function indicesWhere(words: readonly ShellWord[], keep: (w: ShellWord, i: number) => boolean): Set<number> {
  return new Set(words.flatMap((w, i) => (keep(w, i) ? [i] : [])));
}

/** `c` as the words the path gate judges. */
function commandOf(c: Simple): ShellCommand {
  const files = c.redirects.filter((r) => !DATA_REDIRECTS.has(r.op)).map((r) => r.target);
  const all = [...c.words, ...files];

  return {
    bashWords: all.map((w) => spelled(w, (lit) => lit.bash)),
    expanded: indicesWhere(all, (w) => w.parts.some((part) => part.kind !== "lit")),
    redirects: indicesWhere(all, (_w, i) => i >= c.words.length),
    words: all.map((w) => spelled(w, (lit) => lit.text)),
  };
}

/**
 * The simple commands of `cmd` that bash would run (see {@link ShellCommand}): those of blocks, branches, loops,
 * functions, substitutions and the scripts a command makes bash run, with heredoc bodies and comments left out as
 * data. A command with no word and no redirect file is left out.
 */
export function shellWords(cmd: string): ShellWords {
  const got: ShellWords = { commands: [], hasUnreadScript: false };

  shellFlow(cmd, { cwd: path.sep, p: path }, (v) => {
    if (v.kind === "opaque") {
      got.hasUnreadScript = true;

      return;
    }

    const c = commandOf(v);

    if (c.words.length > 0) got.commands.push(c);
  });

  return got;
}
