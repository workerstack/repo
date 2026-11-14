/** The simple commands bash would run for a shell command, each as the words the path gate judges. */
import path from "node:path";

import type { ReadWord, Simple } from "./shell-ast.types.ts";
import { readWord } from "./shell-fields.ts";
import { shellFlow } from "./shell-flow.ts";
import { processEnv } from "./shell-vars.ts";
import { DATA_REDIRECTS } from "./shell.constants.ts";

/**
 * A simple command: the words bash runs, then the files its redirects read or write, each a field bash made with the
 * values the line set and the files a glob matched; each word as bash reads it, which drops a backslash outside quotes
 * that `words` keeps for a Windows path; the indices of the redirect files; the indices of the words that hold what
 * the gate cannot read (`$name` the line did not set, `${…}`, `$(…)`, a backtick, or a glob it could not match); and
 * per word, the glob it could not match, else null. A substitution reads as empty: its commands are commands too.
 */
export type ShellCommand = {
  bashWords: string[];
  expanded: ReadonlySet<number>;
  globs: (string | null)[];
  redirects: ReadonlySet<number>;
  words: string[];
};

/** Every simple command a shell command runs, and whether it also runs a script the gate cannot read. */
export type ShellWords = { commands: ShellCommand[]; hasUnreadScript: boolean };

/** The indices of `words` that `keep` picks. */
function indicesWhere(words: readonly ReadWord[], keep: (w: ReadWord, i: number) => boolean): Set<number> {
  return new Set(words.flatMap((w, i) => (keep(w, i) ? [i] : [])));
}

/** The command bash runs, `c`, as the words the path gate judges. */
function commandOf(c: Simple): ShellCommand {
  const files = c.redirects.filter((r) => !DATA_REDIRECTS.has(r.op)).map((r) => r.target);
  const all = [...c.words, ...files].map(readWord);

  return {
    bashWords: all.map((w) => w.pathBash),
    expanded: indicesWhere(all, (w) => !w.literal),
    globs: all.map((w) => w.glob),
    redirects: indicesWhere(all, (_w, i) => i >= c.words.length),
    words: all.map((w) => w.pathText),
  };
}

/**
 * The simple commands of `cmd` that bash would run (see {@link ShellCommand}): those of blocks, branches, loops,
 * functions, substitutions and the scripts a command makes bash run, with heredoc bodies and comments left out as
 * data, each run from `cwd`. A command with no word and no redirect file is left out.
 */
export function shellWords(cmd: string, cwd: string): ShellWords {
  const got: ShellWords = { commands: [], hasUnreadScript: false };

  shellFlow(cmd, { cwd, env: processEnv(), p: path }, (v) => {
    if (v.kind === "opaque") {
      got.hasUnreadScript = true;

      return;
    }

    const c = commandOf(v);

    if (c.words.length > 0) got.commands.push(c);
  });

  return got;
}
