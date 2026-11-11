/**
 * The record `repo ci wait` leaves for each commit it waited on: one file per sha, so concurrent sessions never share
 * a writer.
 */
import nodeFs from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { Runner } from "./ci-wait-run.ts";
import { RECORD_DIR, RECORD_TEMP_SUFFIX } from "./ci-wait.constants.ts";

const OUTCOMES = ["passed", "failed", "superseded", "nothing", "error"] as const;
type RecordOutcome = (typeof OUTCOMES)[number];
/** What happened to the `ci` run of a commit, and when it was known. */
export type WaitRecord = { branch: string; outcome: RecordOutcome; failed: string[]; at: string };
/** The file operations a record needs; node's by default. */
export type RecordFs = Pick<typeof nodeFs, "mkdirSync" | "writeFileSync" | "renameSync" | "rmSync">;

export function recordSchema(): z.ZodType<WaitRecord> {
  return z.object({
    at: z.string(),
    branch: z.string(),
    failed: z.array(z.string()),
    outcome: z.enum(OUTCOMES),
  });
}

const COMMON_DIR = ["rev-parse", "--path-format=absolute", "--git-common-dir"];

/** The main checkout's root, so a worktree and the root meet at one record directory; `cwd` outside git. */
export function recordRoot(git: Runner, cwd: string): string {
  const got = git(COMMON_DIR, cwd);
  const common = got.stdout.trim();
  return got.code === 0 && common !== "" ? path.dirname(common) : cwd;
}

/** Where the record of `sha` lives under `root`. */
export function recordPath(root: string, sha: string): string {
  return path.join(root, RECORD_DIR, `${sha}.json`);
}

/**
 * Writes the record of `sha` through a temp file and a rename, so a reader sees all of it or none; false when it
 * cannot.
 */
export function writeRecord(target: { root: string; sha: string }, record: WaitRecord, fs: RecordFs = nodeFs): boolean {
  const file = recordPath(target.root, target.sha);
  const temp = `${file}.${process.pid}${RECORD_TEMP_SUFFIX}`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, `${JSON.stringify(record)}\n`);
    fs.renameSync(temp, file);
    return true;
  } catch {
    fs.rmSync(temp, { force: true });
    return false;
  }
}
