import { z } from "zod";

import { ghJson, waitFor, type Target, type WaitOutcome } from "../scripts/ci-wait.ts";
import { sectionFor } from "./changelog-parse.ts";
import { read, type Tools } from "./git.ts";
import { parseManifest } from "./manifest.ts";
import { refuse } from "./refuse.ts";
import {
  GATE_PREFIX,
  WAIT_USAGE,
  gateCiLines,
  gateOk,
  nameDiffers,
  noDefaultBranch,
  noManifestAt,
  noSection,
  notOnBranch,
  tagMissing,
  versionDiffers,
} from "./release-messages.constants.ts";
import {
  CHANGELOG_FILE,
  GH_DEFAULT_BRANCH,
  GIT_ON_BRANCH,
  GIT_SHOW,
  GIT_TAG_REF,
  MANIFEST_FILE,
  SHA_SHOWN,
} from "./release.constants.ts";
import type { ReleaseIo } from "./release.ts";
import { splitSpec, type Spec } from "./wait.ts";

function branchSchema() {
  return z.object({ defaultBranchRef: z.object({ name: z.string() }) });
}

/** The commit the tag names when its package.json, changelog and branch agree with the tag; else the refusal line. */
function check(t: Tools, tag: string, parts: Spec): string | Target {
  const sha = read(t, GIT_TAG_REF(tag));

  if (sha === "") return tagMissing(tag);
  const short = sha.slice(0, SHA_SHOWN);
  const manifest = parseManifest(read(t, GIT_SHOW(sha, MANIFEST_FILE)));

  if (manifest === null) return noManifestAt(short);

  if (manifest.name !== parts.name) return nameDiffers(parts.name, short, manifest.name);

  if (manifest.version !== parts.version) return versionDiffers(parts.version, short, manifest.version);

  if (sectionFor(read(t, GIT_SHOW(sha, CHANGELOG_FILE)), parts.version) === null)
    return noSection(short, parts.version);
  const got = t.gh([...GH_DEFAULT_BRANCH], t.cwd);
  const named = ghJson(got, branchSchema());

  if (named === null) return noDefaultBranch(got.stderr.trim());
  const branch = named.defaultBranchRef.name;

  return t.git(GIT_ON_BRANCH(sha, branch), t.cwd).code === 0 ? { branch, sha } : notOnBranch(short, branch);
}

/** What a wait that did not pass adds to its refusal line. */
function detailOf(outcome: Exclude<WaitOutcome, { kind: "passed" }>): string {
  if (outcome.kind === "error") return outcome.detail;

  return outcome.kind === "nothing" ? outcome.line : "";
}

/** `repo release gate <name>@<version>`: the tag matches the package and changelog on the default branch; CI passed. */
export async function gate(argv: readonly string[], io: ReleaseIo): Promise<number> {
  const tag = argv[0] ?? "";
  const parts = argv.length === 1 ? splitSpec(tag) : null;

  if (parts === null) return refuse(io, GATE_PREFIX, WAIT_USAGE);
  const tools: Tools = { cwd: io.cwd, gh: io.gh, git: io.git };
  const target = check(tools, tag, parts);

  if (typeof target === "string") return refuse(io, GATE_PREFIX, target);
  const short = target.sha.slice(0, SHA_SHOWN);
  const printed: string[] = [];
  const outcome = await waitFor({ ...io, stdout: (text) => printed.push(text.trim()), target });

  if (outcome.kind !== "passed") {
    io.stdout(`${printed.join("\n")}\n`);
    const detail = detailOf(outcome);

    return refuse(io, GATE_PREFIX, gateCiLines[outcome.kind](short, detail));
  }

  io.stdout(`${GATE_PREFIX}${[gateOk(tag, short, parts.version), ...printed].join(" · ")}\n`);

  return 0;
}
