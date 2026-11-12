import fs from "node:fs";
import path from "node:path";

import { HEADER, isBreaking } from "../conventional.ts";
import type { Result } from "../result.ts";
import { apiDiff, sideOf } from "./api-diff.ts";
import type { Change, Side } from "./api-diff.ts";
import { rustApi } from "./api-rust.ts";
import type { RustIo } from "./api-rust.ts";
import {
  AGAINST_ARGS,
  AGAINST_FLAG,
  API_ARGS,
  API_PREFIX,
  ARROW,
  CARGO_MANIFEST,
  breakingLine,
  countsPart,
  FEAT_TYPE,
  featLine,
  featsPart,
  installFailed,
  noTagYet,
  noTarballAt,
  PART_SEPARATOR,
  THIS_CHECKOUT,
} from "./api.constants.ts";
import type { OldSource } from "./api.constants.ts";
import { OLD_ALIAS, PROJECT_DIR_PREFIX } from "./consumer.constants.ts";
import { commitsSince, releaseTag } from "./git.ts";
import type { Tools } from "./git.ts";
import { addedName, addPeers, addSpecs, initProject, installedIn, installOld, renameOld } from "./install.ts";
import type { OldSpec } from "./install.ts";
import { readManifest } from "./manifest.ts";
import { packTarball } from "./pack.ts";
import type { PackIo } from "./pack.ts";
import { refuse } from "./refuse.ts";
import { addFailed, NO_MANIFEST } from "./release-messages.constants.ts";
import { TAG_OF } from "./release.constants.ts";

/** Where `repo release api` runs and prints, and the git, bun and tar it works through. */
export type ApiIo = Tools &
  Pick<PackIo, "stdout" | "stderr" | "bun" | "tar" | "tmp" | "mkdtemp" | "list"> &
  Pick<RustIo, "fetch" | "cargo"> & {
    /** Removes a directory and what is in it. */
    rm: (dir: string) => void;
    /** The registry the old version is installed from. */
    registry: string;
  };

/** The old version and the new one installed side by side in a project. */
type Pair = { old: Side; next: Side };

/** The old version's source, or the exit code of the run that has nothing to compare or refused. */
type Source = { source: OldSource; spec: OldSpec } | { done: number };

/** The old version to install, what it is called in a failure, and the tools to install it with. */
type Old = { spec: OldSpec; what: string; io: ApiIo };

/** What the old version is installed from: a registry at the manifest's version, or the tarball given. */
function sourceOf(against: string | undefined, io: ApiIo): Source {
  const manifest = readManifest(io.cwd);

  if (manifest === null) return { done: refuse(io, API_PREFIX, NO_MANIFEST) };
  const { name, version } = manifest;
  const tag = TAG_OF(name, version);
  const since = releaseTag(io, name, version);

  if (against !== undefined) {
    const tarball = path.resolve(io.cwd, against);

    if (!fs.existsSync(tarball)) return { done: refuse(io, API_PREFIX, noTarballAt(tarball)) };
    const source = { feats: false, label: against, since, tag, title: against, what: against };

    return { source, spec: { tarball } };
  }

  if (since === null) return { done: (io.stdout(`${API_PREFIX}${noTagYet(tag)}\n`), 0) };
  const what = `${name}@${version} from ${io.registry}`;
  const source = { feats: true, label: version, since, tag, title: `${name} ${version}`, what };

  return { source, spec: { name, registry: io.registry, version } };
}

/** Installs the new tarball and the old version into a project; the pair of sides, or the failure line. */
function installPair(project: string, tarball: string, old: Old): Result<Pair, string> {
  const { io } = old;
  initProject(project);
  const added = addSpecs(project, [tarball], io);

  if (added !== null) return { error: addFailed(added), ok: false };
  const next = installedIn(project, addedName(project));
  const peers = addPeers(project, next, io);

  if (peers !== null) return { error: addFailed(peers), ok: false };
  const failed = installOld(project, old.spec, io);

  if (failed !== null) return { error: installFailed(old.what, failed), ok: false };
  renameOld(project);

  return { ok: true, value: { next: sideOf(next), old: sideOf(installedIn(project, OLD_ALIAS)) } };
}

/** What the commits since the last tag say: whether one is breaking, and how many are feats. */
type History = { breaking: boolean; feats: number };

function historyOf(io: ApiIo, since: string | null): History {
  const commits = commitsSince(io, since);

  return {
    breaking: commits.some((commit) => isBreaking(commit.subject, commit.body.split("\n"))),
    feats: commits.filter((commit) => HEADER.exec(commit.subject)?.groups?.["type"] === FEAT_TYPE).length,
  };
}

function isKind(change: Change, ...kinds: string[]): boolean {
  return kinds.includes(change.kind);
}

/** The lines the changes earn: a removed or narrowed one needs a breaking commit, an added or widened one a feat. */
function refusals(changes: readonly Change[], history: History, source: OldSource): string[] {
  if (history.breaking) return [];

  const lines = changes
    .filter((c) => isKind(c, "removed", "narrowed"))
    .map((c) => breakingLine(c, source.label, source.tag));

  const grows = changes.filter((c) => isKind(c, "added", "widened"));

  return grows.length > 0 && history.feats === 0 ? [...lines, featLine(grows, source.label, source.tag)] : lines;
}

/** The ok line: the versions, the counts, and the feat commits when the old version is a tag. */
function okLine(source: OldSource, found: { pair: Pair; changes: readonly Change[]; feats: number }): string {
  const { pair, changes, feats } = found;

  function count(...kinds: string[]): number {
    return changes.filter((c) => isKind(c, ...kinds)).length;
  }

  const counts = {
    added: count("added"),
    breaking: count("removed", "narrowed"),
    subpaths: pair.next.subpaths.filter((subpath) => subpath.kind === "code").length,
    widened: count("widened"),
  };

  const feat = source.feats ? [featsPart(feats)] : [];

  return [`${source.title}${ARROW}${THIS_CHECKOUT}`, countsPart(counts), ...feat, "ok"].join(PART_SEPARATOR);
}

/** Diffs the pair and prints the refusals or the ok line; the exit code. */
function report(source: OldSource, pair: Pair & { project: string }, io: ApiIo): number {
  let changes: Change[];

  try {
    changes = apiDiff(pair.project, pair.old, pair.next);
  } catch (error) {
    return refuse(io, API_PREFIX, (error /* apiDiff throws Errors only */ as Error).message);
  }

  const history = historyOf(io, source.since);
  const lines = refusals(changes, history, source);

  for (const line of lines) io.stderr(`${API_PREFIX}${line}\n`);

  if (lines.length > 0) return 1;
  io.stdout(`${API_PREFIX}${okLine(source, { changes, feats: history.feats, pair })}\n`);

  return 0;
}

/** Packs this checkout, installs it beside the old version, and checks the diff against the commits. */
function runApi(against: string | undefined, io: ApiIo): number {
  const found = sourceOf(against, io);

  if ("done" in found) return found.done;
  const packed = packTarball({ ...io, stderr: () => {} });

  if (!packed.ok) return refuse(io, API_PREFIX, packed.error);
  const project = io.mkdtemp(path.join(io.tmp, PROJECT_DIR_PREFIX));
  const pair = installPair(project, packed.value.tarball, { io, spec: found.spec, what: found.source.what });

  if (!pair.ok) return refuse(io, API_PREFIX, pair.error);

  return report(found.source, { ...pair.value, project }, io);
}

/** The TypeScript check, with the temp directories it made removed afterwards. */
function typescriptApi(against: string | undefined, io: ApiIo): number {
  const dirs: string[] = [];

  const tracked = {
    ...io,
    mkdtemp: (prefix: string): string => {
      const dir = io.mkdtemp(prefix);
      dirs.push(dir);

      return dir;
    },
  };

  try {
    return runApi(against, tracked);
  } finally {
    for (const dir of dirs) io.rm(dir);
  }
}

/**
 * `repo release api [--against <tarball>]`: the public types against the last release's and the commits since; with a
 * root Cargo.toml, each publishable crate's api too.
 */
export function releaseApi(argv: readonly string[], io: ApiIo): Promise<number> {
  const usage = argv.length === 0 || (argv.length === AGAINST_ARGS && argv[0] === AGAINST_FLAG);

  if (!usage) return Promise.resolve(refuse(io, API_PREFIX, API_ARGS));

  if (fs.existsSync(path.join(io.cwd, CARGO_MANIFEST))) return rustApi(argv[1], io, (a) => typescriptApi(a, io));

  return Promise.resolve(typescriptApi(argv[1], io));
}
