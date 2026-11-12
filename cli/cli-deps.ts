import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCommand } from "./commands.ts";
import type { CheckIo } from "./github-apply.ts";
import { ghRunner } from "./github-gh.ts";
import { init } from "./init.ts";
import { confirm, isInteractive, select, spinner } from "./prompt.ts";
import { repoEnv } from "./repo-env.ts";
import { mapCommand } from "./scripts/folder-map.ts";
import { runSync } from "./sync.ts";

/** What `start` runs on: init, the TTY prompts, the commands, sync, the folder map, GitHub and package.json. */
export type CliDeps = {
  init: typeof init;
  /** The prompts `start` and the TTY menu ask with; the menu picks a command name. */
  prompts: {
    confirm: typeof confirm;
    isInteractive: typeof isInteractive;
    select: typeof select<string>;
    spinner: typeof spinner;
  };
  runCommand: typeof runCommand;
  runSync: typeof runSync;
  mapCommand: typeof mapCommand;
  /** The door `repo check` reaches GitHub through, and whether this is CI. */
  checkIo: CheckIo;
  /** This package's package.json text, which `repo version` reads. */
  packageJson: () => string;
};

/** The real ones: what `repo` runs on outside a test. */
export function cliDeps(): CliDeps {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

  return {
    checkIo: { ci: Boolean(repoEnv.process.GITHUB_ACTIONS), gh: ghRunner() },
    init,
    mapCommand,
    packageJson: () => readFileSync(path.join(root, "package.json"), "utf8"),
    prompts: { confirm, isInteractive, select, spinner },
    runCommand,
    runSync,
  };
}
