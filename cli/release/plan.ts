import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "../config.ts";
import type { Result } from "../result.ts";
import { GH_AUTH } from "../scripts/ci-wait.constants.ts";
import { hasUnreleased } from "./changelog.ts";
import {
  commitsSince,
  commitWithSubject,
  defaultBranch,
  divergence,
  must,
  read,
  releaseTag,
  type Tools,
} from "./git.ts";
import { readManifest, type Manifest } from "./manifest.ts";
import {
  DIRTY,
  EMPTY_UNRELEASED,
  GH_MISSING,
  NO_MANIFEST,
  PACK_OFF,
  differs,
  isPrivate,
  notMain,
  notSemver,
  nothing,
  stableOnly,
  tagExists,
} from "./release-messages.constants.ts";
import {
  CHANGELOG_FILE,
  GIT_BRANCH,
  GIT_FETCH,
  GIT_HEAD,
  GIT_STATUS,
  PREFIX_SEPARATOR,
  RELEASE_PACK,
  RELEASE_SUBJECT,
  TAG_OF,
  ZERO_VERSION,
} from "./release.constants.ts";
import { nextVersion, type Mode } from "./version.ts";

/**
 * What a release will do: which version, and whether it writes a commit (`bump`: new version; `fold`: into a pending
 * one).
 */
export type Plan = {
  name: string;
  from: string;
  version: string;
  tag: string;
  branch: string;
  action: "bump" | "fold" | "none";
  /** Commits on the branch origin does not have yet. */
  ahead: number;
};

function unreleased(t: Tools): boolean {
  const file = path.join(t.cwd, CHANGELOG_FILE);

  return fs.existsSync(file) && hasUnreleased(fs.readFileSync(file, "utf8"));
}

function refusal<T>(line: string): Result<T, string> {
  return { error: line, ok: false };
}

/** The refusal for the config and manifest, or the manifest. */
async function readRepo(t: Tools): Promise<Result<Manifest, string>> {
  const manifest = readManifest(t.cwd);

  if (manifest === null) return refusal(NO_MANIFEST);
  const loaded = await loadConfig(t.cwd);

  if (!loaded.ok) return refusal(loaded.errors.join(PREFIX_SEPARATOR));

  if (!loaded.config.packs.includes(RELEASE_PACK)) return refusal(PACK_OFF);

  return manifest.private ? refusal(isPrivate(manifest.name)) : { ok: true, value: manifest };
}

/** What the pending-release and new-version steps read: the checkout, its manifest, the last tag and the mode. */
type Release = { t: Tools; manifest: Manifest; lastTag: string | null; mode: Mode };

/** The new version, or the refusal; checks the changelog and the tag it would make. */
function newVersion({ t, manifest: m, lastTag, mode }: Release): Result<string, string> {
  const first = lastTag === null && m.version === ZERO_VERSION;
  const got = nextVersion({ commits: commitsSince(t, lastTag), current: m.version, first, mode });

  if (!got.ok) {
    const lines = {
      nothing: nothing(lastTag),
      stable: stableOnly(m.name, m.version),
      version: notSemver(m.name, m.version),
    };

    return refusal(lines[got.reason]);
  }

  if (!unreleased(t)) return refusal(EMPTY_UNRELEASED);
  const taken = releaseTag(t, m.name, got.version);

  return taken === null ? { ok: true, value: got.version } : refusal(tagExists(taken));
}

/** Where the checkout stands: the branch to release from, commits not pushed, the pending commit, the last tag. */
type State = { branch: string; ahead: number; pending: string | null; lastTag: string | null };

/** The state, or the refusal for a dirty tree, another branch, an origin that differs or a gh that is not logged in. */
function readState(t: Tools, { name, version }: Manifest): Result<State, string> {
  if (read(t, GIT_STATUS) !== "") return refusal(DIRTY);
  const branch = defaultBranch(t);
  const current = read(t, GIT_BRANCH);

  if (current !== branch) return refusal(notMain(branch, current));
  must(t, GIT_FETCH);
  const lastTag = releaseTag(t, name, version);
  const pending = lastTag === null ? commitWithSubject(t, RELEASE_SUBJECT(TAG_OF(name, version))) : null;
  const { ahead, behind } = divergence(t, branch);

  if (behind > 0 || (ahead > 0 && pending === null)) return refusal(differs(branch, behind, ahead));
  const isAuthed = t.gh(GH_AUTH.slice(), t.cwd).code === 0;

  return isAuthed ? { ok: true, value: { ahead, branch, lastTag, pending } } : refusal(GH_MISSING);
}

/**
 * The plan for the checkout at `t.cwd`, or the one-line reason it refuses; nothing is written. A version whose release
 * commit is in history without a tag is pending: a rerun finishes it instead of computing a new one.
 */
export async function makePlan(t: Tools, mode: Mode): Promise<Result<Plan, string>> {
  const repo = await readRepo(t);

  if (!repo.ok) return repo;
  const manifest = repo.value;
  const stood = readState(t, manifest);

  if (!stood.ok) return stood;
  const state = stood.value;
  const { name, version: from } = manifest;
  const { branch, ahead } = state;

  if (state.pending !== null) {
    const action = state.pending !== read(t, GIT_HEAD) && unreleased(t) ? "fold" : "none";

    return { ok: true, value: { action, ahead, branch, from, name, tag: TAG_OF(name, from), version: from } };
  }

  const next = newVersion({ lastTag: state.lastTag, manifest, mode, t });

  if (!next.ok) return next;
  const version = next.value;

  return { ok: true, value: { action: "bump", ahead, branch, from, name, tag: TAG_OF(name, version), version } };
}
