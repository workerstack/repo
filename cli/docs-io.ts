import type { DocsTools } from "./docs-root.ts";
import { PACK_ARGS } from "./docs.constants.ts";
import { captureBun } from "./scripts/lint.ts";
import { BINS } from "./scripts/turn.ts";
import { runSync } from "./sync.ts";

/** What `repo docs` touches: the folder it runs in, its two streams, the tools and sync. */
export type DocsIo = {
  cwd: string;
  out: (text: string) => void;
  err: (text: string) => void;
  tools: DocsTools;
  /** Runs `repo sync` from `cwd`; its exit code. */
  sync: (cwd: string) => Promise<number>;
};

/** tsc from this package's install, bun, and `bun pm pack --dry-run`, each with the tool environment. */
export const REAL_TOOLS: DocsTools = {
  bun: (args, cwd) => captureBun(args, cwd),
  pack: (cwd) => captureBun([...PACK_ARGS], cwd),
  tsc: BINS.tsc,
};

/** The process's own folder and streams, the real tools and `runSync`. */
export function docsIo(): DocsIo {
  const out = (text: string) => process.stdout.write(text);
  const err = (text: string) => process.stderr.write(text);
  return {
    cwd: process.cwd(),
    err,
    out,
    sync: (cwd) => runSync([], { cwd, stderr: err, stdout: out }),
    tools: REAL_TOOLS,
  };
}
