import { runSync } from "./sync.ts";
import { captureBun } from "./scripts/lint.ts";
import { BINS } from "./scripts/turn.ts";
import type { DocsTools } from "./docs-root.ts";
import { PACK_ARGS } from "./docs.constants.ts";

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
  tsc: BINS.tsc,
  bun: (args, cwd) => captureBun(args, cwd),
  pack: (cwd) => captureBun([...PACK_ARGS], cwd),
};

/** The process's own folder and streams, the real tools and `runSync`. */
export function docsIo(): DocsIo {
  const out = (text: string) => process.stdout.write(text);
  const err = (text: string) => process.stderr.write(text);
  return {
    cwd: process.cwd(),
    out,
    err,
    tools: REAL_TOOLS,
    sync: (cwd) => runSync([], { cwd, stdout: out, stderr: err }),
  };
}
