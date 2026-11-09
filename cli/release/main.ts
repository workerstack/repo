import { realSleep, spawnRunner } from "../scripts/ci-wait-run.ts";
import { WAIT_COMMAND } from "./release.constants.ts";
import { releaseMain } from "./release.ts";
import { releaseWait } from "./wait.ts";

/** `repo release [--stable | --pre <id>]`, or `repo release wait <name>@<version>`. */
export function main(argv: string[]): Promise<number> {
  const io = {
    stdout: process.stdout.write.bind(process.stdout),
    stderr: process.stderr.write.bind(process.stderr),
    now: Date.now,
    sleep: realSleep,
  };
  if (argv[0] === WAIT_COMMAND) return releaseWait(argv.slice(1), { ...io, fetch });
  return releaseMain(argv, { ...io, cwd: process.cwd(), git: spawnRunner("git"), gh: spawnRunner("gh") });
}
