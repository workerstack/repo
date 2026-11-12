import { dispatch } from "./commands.ts";

/** What the bin runs on and how it ends; tests pass stubs. */
export type Bin = {
  /** Runs a registry command or hook and returns its exit code, or null when `cli/main.ts` owns argv. */
  dispatch: (argv: readonly string[]) => Promise<number | null>;
  /** Loads `cli/main.ts`, only once the registry has named nothing. */
  load: () => Promise<{ start: () => Promise<void> }>;
  exit: (code?: number) => void | Promise<void>;
};

/** What `exitWhenFlushed` ends: a writable whose `end` calls back once everything written has been handed on. */
type Endable = { end: (done: () => void) => unknown };

/**
 * Ends every stream, then exits with `code` once all have finished. A bare `process.exit` right after a write to a pipe
 * with a slow reader keeps only the first 64 KiB, which on CI dropped the tail of a command's output.
 */
export async function exitWhenFlushed(
  streams: readonly Endable[],
  exit: (code?: number) => void,
  code?: number,
): Promise<void> {
  await Promise.all(streams.map((stream) => new Promise<void>((resolve) => stream.end(resolve))));
  exit(code);
}

/** The registry, a lazy `cli/main.ts`, and the process's own exit. */
export const BIN: Readonly<Bin> = {
  dispatch,
  exit: (code) => exitWhenFlushed([process.stdout, process.stderr], (c) => process.exit(c), code),
  load: () => import("./main.ts"),
};

/** The exit code of a registry command or hook, or undefined once `cli/main.ts` has run and set its own. */
async function run(argv: readonly string[], deps: Readonly<Bin>): Promise<number | undefined> {
  const code = await deps.dispatch(argv);

  if (code !== null) return code;
  const loaded = await deps.load();
  await loaded.start();

  return undefined;
}

/**
 * `repo`: registry commands and hooks first, so they never load the init, sync and prompt code in `cli/main.ts`.
 * Exits once the command settles, as each script did when run directly, so a hook never waits on a stray handle; a
 * thrown error prints `repo: <message>` and exits 1.
 */
export async function main(argv: readonly string[], deps: Readonly<Bin> = BIN): Promise<void> {
  await run(argv, deps).then(
    (code) => deps.exit(code),
    (err: unknown) => {
      process.stderr.write(`repo: ${err instanceof Error ? err.message : String(err)}\n`);

      return deps.exit(1);
    },
  );
}
