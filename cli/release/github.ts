import fs from "node:fs";
import path from "node:path";

import type { Runner } from "../scripts/ci-wait.ts";
import { sectionFor, trimBlank } from "./changelog-parse.ts";
import { refuse } from "./refuse.ts";
import {
  GITHUB_PREFIX,
  WAIT_USAGE,
  createFailed,
  noNotes,
  releaseCreated,
  releaseExists,
} from "./release-messages.constants.ts";
import { CHANGELOG_FILE, GH_RELEASE_CREATE, GH_RELEASE_VIEW } from "./release.constants.ts";
import { splitSpec } from "./wait.ts";

/** Where `repo release github` reads the changelog and prints, and the gh it works through. */
export type GithubIo = { cwd: string; stdout: (text: string) => void; stderr: (text: string) => void; gh: Runner };

/** The text of CHANGELOG.md in `cwd`; empty when it cannot be read. */
function changelogText(cwd: string): string {
  try {
    return fs.readFileSync(path.join(cwd, CHANGELOG_FILE), "utf8");
  } catch {
    return "";
  }
}

/** `repo release github <name>@<version>`: creates the GitHub release of the tag from its changelog section, once. */
export function releaseGithub(argv: readonly string[], io: GithubIo): number {
  const tag = argv[0] ?? "";
  const parts = argv.length === 1 ? splitSpec(tag) : null;
  if (parts === null) return refuse(io, GITHUB_PREFIX, WAIT_USAGE);
  const section = sectionFor(changelogText(io.cwd), parts.version);
  if (section === null) return refuse(io, GITHUB_PREFIX, noNotes(parts.version));
  const exists = (): boolean => io.gh(GH_RELEASE_VIEW(tag), io.cwd).code === 0;
  let line = releaseExists(tag);
  if (!exists()) {
    const notes = trimBlank(section.body).join("\n");
    const made = io.gh(GH_RELEASE_CREATE(tag, notes, parts.version.includes("-")), io.cwd);
    if (made.code === 0) line = releaseCreated(tag);
    else if (!exists()) return refuse(io, GITHUB_PREFIX, createFailed(made.stderr.trim()));
  }
  io.stdout(`${GITHUB_PREFIX}${line}\n`);
  return 0;
}
