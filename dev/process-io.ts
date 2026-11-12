/** A line writer to stdout and one to stderr. */
type LineIo = { out: (line: string) => void; err: (line: string) => void };

/** The line writers a dev script's `run` takes when it runs as a process: stdout and stderr, one line each. */
export const processIo: LineIo = {
  err: (line) => process.stderr.write(`${line}\n`),
  out: (line) => process.stdout.write(`${line}\n`),
};
