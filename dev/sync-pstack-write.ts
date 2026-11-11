import fs from "node:fs";
import path from "node:path";

import { STOCK_SKILLS_REL } from "../cli/scripts/skill-conflicts.ts";
import { runSync } from "../cli/sync.ts";
import { adaptFile } from "./sync-pstack-adapt.ts";
import { parseArgv } from "./sync-pstack-args.ts";
import { fetchText, rawUrl, resolveSkills, type Source, type TextFetch } from "./sync-pstack-fetch.ts";
import {
  STATUS_DRIFT,
  STATUS_OK,
  STATUS_WRITE,
  type PstackSkill,
  type Status,
} from "./sync-pstack-skills.constants.ts";

/** Where lines go: `out` for progress, `err` for misses and failures. */
export type Io = {
  out(line: string): void;
  err(line: string): void;
};

type SyncReport = {
  skill: string;
  rel: string;
  status: string;
};

/** What a sync reports: failure with a reason, or success with per-file status. */
export type SyncResult =
  | { ok: false; error: string; reports?: SyncReport[]; misses?: string[] }
  | { ok: true; reports: SyncReport[]; wrote: number; misses: string[] };

type SyncPstackSkillsOptions = {
  io: Io;
  workspaceRoot?: string;
  argv?: string[];
  fetchImpl?: TextFetch;
  generateFn?: () => unknown | Promise<unknown>;
};

/** What one sync run shares across its files. */
type Plan = {
  root: string;
  check: boolean;
  generate: boolean;
  source: Source;
  fetchImpl: TextFetch;
  io: Io;
};

type Tally = {
  reports: SyncReport[];
  wrote: number;
  drifted: number;
  misses: string[];
};

type Task = {
  skill: PstackSkill;
  rel: string;
};

/** Write `text` to `dest` unless it is already there; under `check` only report the difference. */
function settle(dest: string, text: string, check: boolean): Status {
  const prev = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : null;
  if (prev === text) return STATUS_OK;
  if (check) return STATUS_DRIFT;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
  return STATUS_WRITE;
}

/** Fetch, adapt and settle one file; returns why it failed, else null. */
async function syncOne({ skill, rel }: Task, plan: Plan, tally: Tally): Promise<string | null> {
  const raw = await fetchText(rawUrl(plan.source, skill.name, rel), plan.fetchImpl);
  const adapted = adaptFile(skill, rel, raw);
  if (!adapted.ok) return `${skill.name}/${rel}: ${adapted.error}`;
  for (const id of adapted.misses) tally.misses.push(`${skill.name}/${rel}: ${id}`);
  const status = settle(path.join(plan.root, STOCK_SKILLS_REL, skill.name, rel), adapted.text, plan.check);
  if (status === STATUS_WRITE) tally.wrote += 1;
  if (status === STATUS_DRIFT) tally.drifted += 1;
  tally.reports.push({ rel, skill: skill.name, status });
  plan.io.out(`${status} ${skill.name}/${rel}\n`);
  return null;
}

/** Sync the tasks one after another, stopping at the first failure; returns it, else null. */
async function syncAll(tasks: readonly Task[], plan: Plan, tally: Tally): Promise<string | null> {
  const [head, ...rest] = tasks;
  if (head === undefined) return null;
  return (await syncOne(head, plan, tally)) ?? (await syncAll(rest, plan, tally));
}

/** The trees come from `repo sync`, the one writer of every generated file. */
async function runRepoSync(root: string, io: Io): Promise<void> {
  const code = await runSync([], { cwd: root, stderr: io.err, stdout: io.out });
  if (code !== 0) throw new Error(`repo sync exited ${code}`);
}

/** Run `generate`; returns the failure message, else null. */
async function regenerate(generate: () => unknown): Promise<string | null> {
  try {
    await generate();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The result once every file is settled: regenerate after a write, then judge drift and misses. */
async function finish(plan: Plan, tally: Tally, run: () => unknown): Promise<SyncResult> {
  const { reports, misses } = tally;
  for (const miss of misses) plan.io.err(`miss ${miss}\n`);
  if (!plan.check && plan.generate && tally.wrote > 0) {
    const error = await regenerate(run);
    if (error !== null) return { error, misses, ok: false, reports };
  }
  if (plan.check && tally.drifted > 0) return { error: `${tally.drifted} file(s) drifted`, misses, ok: false, reports };
  if (misses.length) return { error: `${misses.length} adapter miss(es)`, misses, ok: false, reports };
  return { misses: [], ok: true, reports, wrote: tally.wrote };
}

/**
 * Fetch the ported pstack skills, adapt them, and write (or with `--check`, compare) the SSOT.
 * @param options
 */
export async function syncPstackSkills({
  io,
  workspaceRoot,
  argv = [],
  fetchImpl = fetch,
  generateFn,
}: SyncPstackSkillsOptions): Promise<SyncResult> {
  const parsed = parseArgv(argv);
  if (!parsed.ok) return { error: parsed.error, ok: false };
  const { check, generate, repo, ref } = parsed;
  const root = path.resolve(workspaceRoot ?? process.cwd());
  const plan: Plan = { check, fetchImpl, generate, io, root, source: { ref, repo } };
  const tally: Tally = { drifted: 0, misses: [], reports: [], wrote: 0 };
  const tasks = resolveSkills(parsed.skills).flatMap((skill) => skill.files.map((rel) => ({ rel, skill })));
  const failure = await syncAll(tasks, plan, tally);
  if (failure !== null) return { error: failure, ok: false };
  return await finish(plan, tally, generateFn ?? (() => runRepoSync(root, io)));
}
