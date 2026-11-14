/** The simple commands bash would run for a shell command, each as the words the path gate judges. */
import path from "node:path";

import type { ReadWord, Scope, Simple } from "./shell-ast.types.ts";
import { expandWord } from "./shell-expand.ts";
import { shellFlow } from "./shell-flow.ts";
import { processEnv } from "./shell-vars.ts";

/** Redirects whose word is no file: a heredoc's delimiter and a here-string's text. */
const DATA_REDIRECTS: ReadonlySet<string> = /* @__PURE__ */ new Set(["<<", "<<-", "<<<"]);

/**
 * A simple command: its words, then the files its redirects read or write, each with the values the line set; each
 * word as bash reads it, which drops a backslash outside quotes that `words` keeps for a Windows path; the indices of
 * the redirect files; and the indices of the words that hold an expansion the gate cannot read (`$name` the line did
 * not set, `${…}`, `$(…)` or a backtick). A substitution reads as empty: its own commands are commands of their own.
 */
export type ShellCommand = {
  bashWords: string[];
  expanded: ReadonlySet<number>;
  redirects: ReadonlySet<number>;
  words: string[];
};

/** Every simple command a shell command runs, and whether it also runs a script the gate cannot read. */
export type ShellWords = { commands: ShellCommand[]; hasUnreadScript: boolean };

/** The indices of `words` that `keep` picks. */
function indicesWhere(words: readonly ReadWord[], keep: (w: ReadWord, i: number) => boolean): Set<number> {
  return new Set(words.flatMap((w, i) => (keep(w, i) ? [i] : [])));
}

/** `c` as the words the path gate judges, read with the variables of `scope`. */
function commandOf(c: Simple, { vars }: Scope): ShellCommand {
  const files = c.redirects.filter((r) => !DATA_REDIRECTS.has(r.op)).map((r) => r.target);
  const all = [...c.words, ...files].map((w) => expandWord(w, vars));

  return {
    bashWords: all.map((w) => w.pathBash),
    expanded: indicesWhere(all, (w) => !w.literal),
    redirects: indicesWhere(all, (_w, i) => i >= c.words.length),
    words: all.map((w) => w.pathText),
  };
}

/**
 * The simple commands of `cmd` that bash would run (see {@link ShellCommand}): those of blocks, branches, loops,
 * functions, substitutions and the scripts a command makes bash run, with heredoc bodies and comments left out as
 * data. A command with no word and no redirect file is left out.
 */
export function shellWords(cmd: string): ShellWords {
  const got: ShellWords = { commands: [], hasUnreadScript: false };

  shellFlow(cmd, { cwd: path.sep, env: processEnv(), p: path }, (v) => {
    if (v.kind === "opaque") {
      got.hasUnreadScript = true;

      return;
    }

    const c = commandOf(v, v);

    if (c.words.length > 0) got.commands.push(c);
  });

  return got;
}
