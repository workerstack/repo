import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "../config.ts";
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

/** The refusal for the config and manifest, or the manifest. */
async function readRepo(t: Tools): Promise<Manifest | string> {
  const manifest = readManifest(t.cwd);
  if (manifest === null) return NO_MANIFEST;
  const loaded = await loadConfig(t.cwd);
  if (!loaded.ok) return loaded.errors.join(PREFIX_SEPARATOR);
  if (!loaded.config.packs.includes(RELEASE_PACK)) return PACK_OFF;
  return manifest.private ? isPrivate(manifest.name) : manifest;
}

/** What the pending-release and new-version steps read: the checkout, its manifest, the last tag and the mode. */
type Release = { t: Tools; manifest: Manifest; lastTag: string | null; mode: Mode };

/** The new version, or the refusal; checks the changelog and the tag it would make. */
function newVersion({ t, manifest: m, lastTag, mode }: Release): { version: string } | string {
  const first = lastTag === null && m.version === ZERO_VERSION;
  const got = nextVersion({ commits: commitsSince(t, lastTag), current: m.version, first, mode });
  if (!got.ok) {
    const lines = {
      nothing: nothing(lastTag),
      stable: stableOnly(m.name, m.version),
      version: notSemver(m.name, m.version),
    };
    return lines[got.reason];
  }
  if (!unreleased(t)) return EMPTY_UNRELEASED;
  const taken = releaseTag(t, m.name, got.version);
  return taken === null ? { version: got.version } : tagExists(taken);
}

/** Where the checkout stands: the branch to release from, commits not pushed, the pending commit, the last tag. */
type State = { branch: string; ahead: number; pending: string | null; lastTag: string | null };

/** The state, or the refusal for a dirty tree, another branch, an origin that differs or a gh that is not logged in. */
function readState(t: Tools, { name, version }: Manifest): State | string {
  if (read(t, GIT_STATUS) !== "") return DIRTY;
  const branch = defaultBranch(t);
  const current = read(t, GIT_BRANCH);
  if (current !== branch) return notMain(branch, current);
  must(t, GIT_FETCH);
  const lastTag = releaseTag(t, name, version);
  const pending = lastTag === null ? commitWithSubject(t, RELEASE_SUBJECT(TAG_OF(name, version))) : null;
  const { ahead, behind } = divergence(t, branch);
  if (behind > 0 || (ahead > 0 && pending === null)) return differs(branch, behind, ahead);
  return t.gh(GH_AUTH.slice(), t.cwd).code === 0 ? { ahead, branch, lastTag, pending } : GH_MISSING;
}

/**
 * The plan for the checkout at `t.cwd`, or the one-line reason it refuses; nothing is written. A version whose release
 * commit is in history without a tag is pending: a rerun finishes it instead of computing a new one.
 */
export async function makePlan(t: Tools, mode: Mode): Promise<Plan | string> {
  const manifest = await readRepo(t);
  if (typeof manifest === "string") return manifest;
  const state = readState(t, manifest);
  if (typeof state === "string") return state;
  const { name, version: from } = manifest;
  const { branch, ahead } = state;
  if (state.pending !== null) {
    const action = state.pending !== read(t, GIT_HEAD) && unreleased(t) ? "fold" : "none";
    return { action, ahead, branch, from, name, tag: TAG_OF(name, from), version: from };
  }
  const next = newVersion({ lastTag: state.lastTag, manifest, mode, t });
  const tag = typeof next === "string" ? "" : TAG_OF(name, next.version);
  return typeof next === "string" ? next : { action: "bump", ahead, branch, from, name, tag, version: next.version };
}
