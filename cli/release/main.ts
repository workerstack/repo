import fs from "node:fs";
import os from "node:os";

import { latestRegistry } from "../check-latest.ts";
import { readEnv } from "../env.ts";
import { runCargo } from "../rust/clippy.ts";
import { inheritRunner, realSleep, spawnRunner } from "../scripts/ci-wait-run.ts";
import { releaseApi } from "./api.ts";
import { releaseConsumer, tscScript } from "./consumer.ts";
import { gate } from "./gate.ts";
import type { Tools } from "./git.ts";
import { releaseGithub } from "./github.ts";
import { listDir } from "./list-dir.ts";
import { releasePack } from "./pack.ts";
import { releasePublish } from "./publish.ts";
import { USAGE } from "./release-messages.constants.ts";
import {
  API_COMMAND,
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
import { releaseWait } from "./wait.ts";

function removeDir(dir: string): void {
  return fs.rmSync(dir, { force: true, recursive: true });
}

function packTools() {
  return {
    bun: spawnRunner("bun"),
    list: listDir,
    mkdtemp: fs.mkdtempSync,
    tar: spawnRunner("tar"),
    tmp: os.tmpdir(),
  };
}

function apiMain(
  argv: string[],
  run: Tools & { stdout: (text: string) => void; stderr: (text: string) => void },
): Promise<number> {
  const registry = latestRegistry(readEnv());
  return releaseApi(argv, { ...run, ...packTools(), cargo: runCargo, fetch, registry, rm: removeDir });
}

/**
 * `repo release [--stable | --pre <id>]`, or one of `help`, `wait`, `gate`, `pack`, `publish`, `github`, `consumer`
 * and `api`.
 */
export function main(argv: string[]): Promise<number> {
  const io = {
    now: Date.now,
    sleep: realSleep,
    stderr: process.stderr.write.bind(process.stderr),
    stdout: process.stdout.write.bind(process.stdout),
  };
  const run = { ...io, cwd: process.cwd(), gh: spawnRunner("gh"), git: spawnRunner("git") };
  const rest = argv.slice(1);
  const isCi = readEnv().GITHUB_ACTIONS === GITHUB_ACTIONS_ON;
  if (argv[0] === HELP_COMMAND) return (io.stdout(`${USAGE}\n`), Promise.resolve(0));
  if (argv[0] === WAIT_COMMAND) return releaseWait(rest, { ...io, fetch });
  if (argv[0] === GATE_COMMAND) return gate(rest, run);
  if (argv[0] === PACK_COMMAND) return Promise.resolve(releasePack(rest, { ...run, ...packTools() }));
  if (argv[0] === CONSUMER_COMMAND) {
    return Promise.resolve(
      releaseConsumer(rest, {
        ...run,
        ...packTools(),
        rm: removeDir,
        tsc: tscScript(),
      }),
    );
  }
  if (argv[0] === API_COMMAND) return apiMain(rest, run);
  if (argv[0] === GITHUB_COMMAND) return Promise.resolve(releaseGithub(rest, run));
  if (argv[0] === PUBLISH_COMMAND)
    return releasePublish(rest, { ...run, ...packTools(), ci: isCi, fetch, npm: inheritRunner("npm") });

  return releaseMain(argv, run);
}
