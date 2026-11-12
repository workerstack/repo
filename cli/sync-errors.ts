import { SYNC_PREFIX } from "./sync.constants.ts";

/** Where a sync run prints errors, and whether it is `--postinstall`, which never fails. */
export type FailIo = { postinstall: boolean; io: { stderr: (s: string) => void } };

/** A Node system error: an Error whose `code` names what failed. */
type SystemError = Error & { code: string };

/** True for an Error carrying a string `code`, false for any other thrown value. */
function isSystemError(cause: unknown): cause is SystemError {
  return cause instanceof Error && "code" in cause && typeof cause.code === "string";
}

/** The `code` of a Node system error, or undefined for any other thrown value. */
export function errorCode(cause: unknown): string | undefined {
  return isSystemError(cause) ? cause.code : undefined;
}

/** The message of a thrown Error; any other thrown value as text. */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Prints each error as a sync line; the exit code, which `--postinstall` keeps at 0. */
export function fail(run: FailIo, errors: readonly string[]): number {
  for (const error of errors) run.io.stderr(`${SYNC_PREFIX}${error}\n`);

  return run.postinstall ? 0 : 1;
}
