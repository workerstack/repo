import fs from "node:fs";
import os from "node:os";
import { readEnv } from "../env.ts";
import { inheritRunner, realSleep, spawnRunner } from "../scripts/ci-wait-run.ts";
import { releaseConsumer, tscScript } from "./consumer.ts";
import { gate } from "./gate.ts";
import { releaseGithub } from "./github.ts";
import { listDir } from "./list-dir.ts";
import { releasePack } from "./pack.ts";
import { releasePublish } from "./publish.ts";
import {
  CONSUMER_COMMAND,
  GATE_COMMAND,
  GITHUB_ACTIONS_ON,
  GITHUB_COMMAND,
  HELP_COMMAND,
  PACK_COMMAND,
  PUBLISH_COMMAND,
  WAIT_COMMAND,
} from "./release.constants.ts";
import { releaseMain } from "./release.ts";
import { USAGE } from "./release-messages.constants.ts";
import { releaseWait } from "./wait.ts";

const removeDir = (dir: string): void => fs.rmSync(dir, { recursive: true, force: true });

const packTools = () => ({
  bun: spawnRunner("bun"),
  tar: spawnRunner("tar"),
  tmp: os.tmpdir(),
  mkdtemp: fs.mkdtempSync,
  list: listDir,
});

/** `repo release [--stable | --pre <id>]`, or one of `help`, `wait`, `gate`, `pack`, `publish`, `github` and `consumer`. */
export function main(argv: string[]): Promise<number> {
  const io = {
    stdout: process.stdout.write.bind(process.stdout),
    stderr: process.stderr.write.bind(process.stderr),
    now: Date.now,
    sleep: realSleep,
  };
  const run = { ...io, cwd: process.cwd(), git: spawnRunner("git"), gh: spawnRunner("gh") };
  const rest = argv.slice(1);
  const ci = readEnv().GITHUB_ACTIONS === GITHUB_ACTIONS_ON;
  if (argv[0] === HELP_COMMAND) return (io.stdout(`${USAGE}\n`), Promise.resolve(0));
  if (argv[0] === WAIT_COMMAND) return releaseWait(rest, { ...io, fetch });
  if (argv[0] === GATE_COMMAND) return gate(rest, run);
  if (argv[0] === PACK_COMMAND) return Promise.resolve(releasePack(rest, { ...run, ...packTools() }));
  if (argv[0] === CONSUMER_COMMAND)
    return Promise.resolve(
      releaseConsumer(rest, {
        ...run,
        ...packTools(),
        rm: removeDir,
        tsc: tscScript(),
      }),
    );
  if (argv[0] === GITHUB_COMMAND) return Promise.resolve(releaseGithub(rest, run));
  if (argv[0] === PUBLISH_COMMAND) {
    return releasePublish(rest, { ...run, ...packTools(), npm: inheritRunner("npm"), fetch, ci });
  }
  return releaseMain(argv, run);
}
