/** Prints `prefix` and `line` to stderr and returns the failing exit code. */
export function refuse(io: { stderr: (text: string) => void }, prefix: string, line: string): number {
  io.stderr(`${prefix}${line}\n`);

  return 1;
}
