/** The line writers a dev script's `run` takes when it runs as a process: stdout and stderr, one line each. */
export const processIo: { out: (line: string) => void; err: (line: string) => void } = {
  err: (line) => process.stderr.write(`${line}\n`),
  out: (line) => process.stdout.write(`${line}\n`),
};
