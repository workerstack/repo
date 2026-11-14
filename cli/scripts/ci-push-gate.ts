/**
 * The push gate: notes each `git push` a session runs, and holds its Stop until the newest pushed commit of every
 * branch has a ci result.
 */
import nodeFs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { isString, type JsonObject, tryJson } from "../json.ts";
import { REPO, STATE } from "../repo-dirs.ts";
import { repoEnv } from "../repo-env.ts";
import { BACKLOG_REL } from "./backlog.constants.ts";
import { type GateDeps, lineFor } from "./ci-push-gate-line.ts";
import { BLOCKED_LINE_RE, DECIMAL } from "./ci-push-parse.constants.ts";
import { pushedRefs } from "./ci-push-parse.ts";
import { recordRoot } from "./ci-wait-record.ts";
import { spawnRunner } from "./ci-wait-run.ts";
import type { HookInput } from "./hook-input.ts";
import { resolveRoots } from "./workspace-root.ts";

/** The stamp counting this turn's blocks, apart from `stop-block`, which ask and away share. */
const PUSH_BLOCK_STAMP = "push-block";
export const MAX_PUSH_BLOCK = 6;
const LOGS_DIR = `${REPO}/${STATE}/orchestrator-logs`;
const SESSIONS_DIR = `${REPO}/${STATE}/sessions`;
const PUSHED_FILE = "pushed.json";

function realDeps(): GateDeps {
  return {
    fs: nodeFs,
    git: spawnRunner("git"),
    now: () => new Date(),
    p: path,
  };
}

function pushedSchema() {
  return z.array(
    z.object({
      at: z.string(),
      branch: z.string(),
      dir: z.string().optional(),
      pending: z.boolean().optional(),
      sha: z.string(),
      src: z.string().optional(),
    }),
  );
}

type Pushed = z.infer<ReturnType<typeof pushedSchema>>[number];

function sessionFile(root: string, session: string): string {
  return path.join(root, SESSIONS_DIR, session, PUSHED_FILE);
}

function parsePushed(deps: GateDeps, file: string): Pushed[] {
  try {
    return tryJson(pushedSchema(), deps.fs.readFileSync(file, "utf8")) ?? [];
  } catch {
    return [];
  }
}

function save(deps: GateDeps, file: string, rows: Pushed[]): void {
  deps.fs.mkdirSync(path.dirname(file), { recursive: true });
  deps.fs.writeFileSync(file, `${JSON.stringify(rows)}\n`);
}

/**
 * The commit a push sent: its ref as it is now when that landed on origin (the command committed first), else the
 * commit it had before the command.
 */
function settleEntry(deps: GateDeps, row: Pushed): Pushed {
  const dir = String(row.dir);
  const now = deps.git(["rev-parse", "--verify", String(row.src)], dir);
  const sha = now.stdout.trim();
  const isLanded = deps.git(["merge-base", "--is-ancestor", sha, `origin/${row.branch}`], dir).code === 0;

  return { at: row.at, branch: row.branch, sha: now.code === 0 && isLanded ? sha : row.sha };
}

/**
 * The session's pushes, each still waiting on its command now settled to the commit it sent; the file is written back
 * only when one was.
 */
function loadPushed(deps: GateDeps, file: string): Pushed[] {
  const rows = parsePushed(deps, file);

  if (!rows.some((r) => r.pending === true)) return rows;
  const settled = rows.map((r) => (r.pending === true ? settleEntry(deps, r) : r));
  save(deps, file, settled);

  return settled;
}

/**
 * Settles the session's earlier pushes, then notes the `git push` forms in a command, under the main checkout; never
 * throws.
 */
export function recordPush(input: { command: string; cwd: string; session: string }, deps: GateDeps): void {
  if (input.session === "") return;

  try {
    const file = sessionFile(recordRoot(deps.git, input.cwd), input.session);
    const rows = loadPushed(deps, file);
    const at = deps.now().toISOString();
    const noted = pushedRefs(deps, input.command, input.cwd).map((r) => ({ ...r, at, pending: true }));

    if (noted.length > 0) save(deps, file, [...rows, ...noted]);
  } catch {
    // The check at Stop still sees the push land; a failed note must not stop the command.
  }
}

/** The jobs open `blocked:` lines in the root's backlog name; none when it is missing or unreadable. */
function blockedJobs(deps: GateDeps, root: string): ReadonlySet<string> {
  try {
    const text = deps.fs.readFileSync(path.join(root, BACKLOG_REL), "utf8");

    return new Set(Array.from(text.matchAll(BLOCKED_LINE_RE), (m) => String(m[1])));
  } catch {
    return new Set();
  }
}

function readCount(deps: GateDeps, stamp: string): number {
  try {
    const n = parseInt(deps.fs.readFileSync(stamp, "utf8"), DECIMAL);

    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * The block text for a parent's Stop while a pushed branch's newest commit lacks a ci result, capped at 6 blocks a
 * turn; null to let the stop go on.
 */
export function pushStopBlock(
  input: { root: string; cwd: string; session: string; active: boolean },
  deps: GateDeps,
): string | null {
  if (input.session === "") return null;
  const root = recordRoot(deps.git, input.cwd);
  const pushed = loadPushed(deps, sessionFile(root, input.session));
  const byBranch = Map.groupBy(pushed, (p) => p.branch);
  const ctx = { active: input.active, blocked: blockedJobs(deps, root), root };
  const lines = [...byBranch.values()].flatMap((rows) => lineFor(deps, ctx, rows) ?? []);
  const stamp = path.join(input.root, LOGS_DIR, `${PUSH_BLOCK_STAMP}-${input.session}`);
  const n = readCount(deps, stamp);

  if (lines.length === 0 || n >= MAX_PUSH_BLOCK) return null;

  try {
    deps.fs.mkdirSync(path.dirname(stamp), { recursive: true });
    deps.fs.writeFileSync(stamp, String(n + 1));
  } catch {
    // An unwritable stamp costs the cap, not the block.
  }

  return lines.join("\n");
}

function sessionOf(data: HookInput): string {
  const ids = [repoEnv.process.GROK_SESSION_ID, data.sessionId, data.session_id];

  return ids.find((id) => id !== undefined && id !== "") ?? "";
}

/**
 * For every tool call: settles the session's earlier pushes and notes the push in a Bash `command`, if there is one.
 */
export function notePush(data: HookInput, toolInput: JsonObject | undefined, deps: GateDeps = realDeps()): void {
  const command = toolInput?.command;
  const session = sessionOf(data);
  recordPush({ command: isString(command) ? command : "", cwd: resolveRoots(data).cwd, session }, deps);
}

/** The block text for a parent's Stop from the hook payload; null to let the stop go on. */
export function pushHold(data: HookInput, deps: GateDeps = realDeps()): string | null {
  const { root, cwd } = resolveRoots(data);
  const active = data.stopHookActive === true || data.stop_hook_active === true;

  return pushStopBlock({ active, cwd, root, session: sessionOf(data) }, deps);
}
