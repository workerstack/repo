/** A world for the push gate: a fake git, a temp main checkout, and helpers to plant and read its files. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { removeTemps } from "../../__fixtures__/remove-temps.ts";
import { pushStopBlock, recordPush, type GateDeps } from "../ci-push-gate.ts";
import { recordPath, type WaitRecord } from "../ci-wait-record.ts";
import type { Runner } from "../ci-wait-run.ts";

export const AT = "2026-11-10T10:00:00.000Z";
export const A = "a".repeat(40);
export const B = "b".repeat(40);
export const C = "c".repeat(40);
export const D = "d".repeat(40);
export const WIN = "C:\\work\\repo";
export type Row = { branch: string; sha: string; at: string };

/** How the gate asks for a wait on `branch`. */
export function wait(branch: string) {
  return `\`bun repo ci wait ${branch}\``;
}

const HINT =
  "; if only the user can fix a job, run bun repo backlog add 'blocked: `<job>` <why>' " +
  "and name that line in your reply";

/** The Stop line for a failed run on main at `sha` naming `jobs`. */
export function failedLine(sha: string, jobs: string) {
  return (
    `Stop: ci failed on ${sha.slice(0, 7)} on main (${jobs}); ` +
    `fix it in a new worktree, push, and run ${wait("main")} in the background${HINT}`
  );
}
export const row = (branch: string, sha: string): Row[] => [{ branch, sha, at: AT }];

export type World = {
  /** Branch and tip of each directory git is asked in. */
  tips: Record<string, { branch: string; sha: string }>;
  /** Commits a named ref resolves to. */
  refs: Record<string, string>;
  /** Commits that reached origin/<branch>. */
  landed: Record<string, string[]>;
};

const ok = (stdout: string) => ({ code: 0, stdout: `${stdout}\n`, stderr: "" });
const no = { code: 1, stdout: "", stderr: "fatal" };

/** A git that answers from `world`; its common dir is always `main`'s, as a worktree's is. */
export function fakeGit(main: string, world: World, asked: string[]): Runner {
  return (args, cwd) => {
    asked.push(`${cwd}: ${args.join(" ")}`);
    const tip = world.tips[cwd];
    if (args.includes("--git-common-dir")) return ok(path.join(main, ".git"));
    if (args[0] === "merge-base") {
      return world.landed[String(args[3]).replace("origin/", "")]?.includes(String(args[2])) ? ok("") : no;
    }
    if (args.includes("--abbrev-ref")) return tip ? ok(tip.branch) : no;
    const ref = String(args.at(-1));
    const sha = ref === "HEAD" ? tip?.sha : world.refs[ref];
    return sha ? ok(sha) : no;
  };
}

/** The files a session leaves under `main`. */
function files(main: string) {
  const file = (session: string) => path.join(main, ".repo/tmp/sessions", session, "pushed.json");
  const read = (session: string) => JSON.parse(fs.readFileSync(file(session), "utf8")) /* rows the gate wrote */ as Row[] & Record<string, unknown>[];
  return {
    raw: (session = "s1"): Record<string, unknown>[] => (fs.existsSync(file(session)) ? read(session) : []),
    pushed: (session = "s1"): Row[] =>
      (fs.existsSync(file(session)) ? read(session) : []).map(({ branch, sha, at }) => ({ branch, sha, at })),
    plant: (session: string, rows: [string, string][]) => {
      fs.mkdirSync(path.dirname(file(session)), { recursive: true });
      fs.writeFileSync(file(session), JSON.stringify(rows.map(([branch, sha]) => ({ branch, sha, at: AT }))));
    },
    result: (sha: string, outcome: WaitRecord["outcome"], failed: string[] = []) => {
      fs.mkdirSync(path.dirname(recordPath(main, sha)), { recursive: true });
      fs.writeFileSync(recordPath(main, sha), JSON.stringify({ branch: "main", outcome, failed, at: AT }));
    },
    stamp: (session = "s1") => path.join(main, ".repo/tmp/orchestrator-logs", `push-block-${session}`),
    backlog: (text: string, dir = main) => {
      fs.mkdirSync(path.join(dir, ".repo"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".repo/backlog.md"), text);
    },
  };
}

const dirs: string[] = [];
export const cleanRigs = () => {
  removeTemps(dirs.splice(0));
};

export function rig(over: Partial<World> = {}) {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), "push-gate-"));
  dirs.push(main);
  const asked: string[] = [];
  const tips = { [main]: { branch: "main", sha: A }, [WIN]: { branch: "feat", sha: B } };
  const world: World = { tips, refs: { main: A, x: C }, landed: { main: [A, B, C, D], x: [C], feat: [B] }, ...over };
  const deps: GateDeps = { git: fakeGit(main, world, asked), fs, now: () => new Date(AT) };
  return {
    main,
    deps,
    asked,
    world,
    ...files(main),
    note: (command: string, cwd = main, session = "s1") => recordPush({ command, cwd, session }, deps),
    gate: (session = "s1", active = false) => pushStopBlock({ root: main, cwd: main, session, active }, deps),
  };
}
