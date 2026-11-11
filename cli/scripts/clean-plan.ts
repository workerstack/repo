/** The pure half of `repo clean`: which paths under .tmp/repo to remove and what to keep, by each dir's policy. */
import fs from "node:fs";
import path from "node:path";
import { AGE, DAY, DONE_STATUS, HOUR, NESTED_KIND, OLD_KIND, PLANS_DIR, POLICY } from "./clean.constants.ts";
import {
  keeperOf,
  leadingSerial,
  list,
  nestedHolds,
  newest,
  roadmapLocations,
  serialOf,
  stats,
  statusOf,
} from "./clean-scan.ts";
import type { AgedEntry, CleanPlan, Decision, PlanInput, PlanState, Policy } from "./clean.types.ts";
import { FILENAME_RE, TMP_DIR, TMP_RESERVED_DIRS } from "./persist-tmp.ts";

/** One dir's planner: what to do with `p`, the entry `name` of .tmp/repo. */
type Planner = (state: PlanState, name: string, p: string) => void;

function recent(state: PlanState, p: string, window: number = HOUR): boolean {
  return newest(p) >= state.now - window;
}

function old(state: PlanState, p: string): boolean {
  return newest(p) < state.now - AGE;
}

function decide(state: PlanState, d: Decision): void {
  if (d.gone) state.remove.push({ path: d.path, kind: d.kind });
  else state.keep.push({ path: d.path, kind: d.keptAs });
}

function keepDir(state: PlanState, name: string, p: string): void {
  state.keep.push({ path: p, kind: name });
}

/** True when an entry of an aged dir goes: a serial file, not the newest, old, done when the policy asks, not pinned. */
function agedOut(state: PlanState, a: AgedEntry): boolean {
  if (a.entry === a.keeper || serialOf(a.name, a.entry) === null || !old(state, a.child)) return false;
  if (POLICY[a.name] === "age-done" && statusOf(a.child) !== DONE_STATUS) return false;
  return !(a.name === PLANS_DIR && state.pinned.has(path.resolve(a.child)));
}

function ageEntries(state: PlanState, name: string, p: string): void {
  const entries = list(p);
  const keeper = keeperOf(entries, (n) => serialOf(name, n));
  state.keep.push({ path: p, kind: name });
  for (const entry of entries) {
    const child = path.join(p, entry);
    if (!agedOut(state, { name, entry, child, keeper })) continue;
    // only plans, roadmaps, handoffs and implementations reach age policies
    state.remove.push({ path: child, kind: OLD_KIND[name] /* every aged dir has an old kind */ as string });
  }
}

function sessionDirs(state: PlanState, _name: string, p: string): void {
  for (const sid of list(p)) {
    const child = path.join(p, sid);
    const live = state.liveSessions.has(sid);
    const gone = !live && !recent(state, child);
    decide(state, { path: child, gone, kind: "dead session", keptAs: live ? "live session" : "recent" });
  }
}

function stampFiles(state: PlanState, _name: string, p: string): void {
  for (const stamp of list(p)) {
    const child = path.join(p, stamp);
    const live = [...state.liveSessions].some((sid) => stamp.endsWith(`-${sid}`));
    const gone = !live && !recent(state, child);
    decide(state, { path: child, gone, kind: "stale stamp", keptAs: live ? "live session" : "recent" });
  }
}

function stashReceipts(state: PlanState, _name: string, p: string): void {
  for (const receipt of list(p)) {
    const child = path.join(p, receipt);
    decide(state, { path: child, gone: !recent(state, child, DAY), kind: "stash receipt", keptAs: "recent" });
  }
}

const PLANNERS: Readonly<Record<Policy, Planner>> = {
  keep: keepDir,
  age: ageEntries,
  "age-done": ageEntries,
  "per-session": sessionDirs,
  "per-stamp": stampFiles,
  "per-receipt": stashReceipts,
};

function isArtifact(name: string, p: string): boolean {
  return FILENAME_RE.test(name) && !fs.lstatSync(p).isDirectory();
}

/** An entry no policy owns: a tmp artifact ages out unless it holds the top serial; anything else goes once stale. */
function looseEntry(state: PlanState, name: string, p: string): void {
  if (isArtifact(name, p)) {
    const gone = name !== state.artifactKeeper && old(state, p);
    decide(state, { path: p, gone, kind: "old tmp artifact", keptAs: "tmp artifact" });
  } else {
    decide(state, { path: p, gone: !recent(state, p), kind: stats(p).dir ? "dir" : "file", keptAs: "recent" });
  }
}

function plannerOf(name: string): Planner {
  const policy = TMP_RESERVED_DIRS.has(name) ? POLICY[name] : undefined;
  return policy === undefined ? looseEntry : PLANNERS[policy];
}

/** Pure decision: which paths to remove and what was kept, by kind. */
export function cleanPlan({ root, now, liveSessions, nested = [] }: PlanInput): CleanPlan {
  const tmp = path.join(root, TMP_DIR);
  const names = list(tmp);
  const artifacts = names.filter((n) => isArtifact(n, path.join(tmp, n)));
  // names were filtered by FILENAME_RE, which starts with the serial
  const artifactKeeper = keeperOf(artifacts, leadingSerial);
  const state: PlanState = { now, liveSessions, pinned: roadmapLocations(tmp), artifactKeeper, remove: [], keep: [] };
  for (const name of names) plannerOf(name)(state, name, path.join(tmp, name));
  for (const dir of nested) {
    const held = nestedHolds(dir);
    if (held) state.keep.push({ path: dir, kind: NESTED_KIND, holds: held });
    else state.remove.push({ path: dir, kind: "nested dir" });
  }
  return { remove: state.remove, keep: state.keep };
}
