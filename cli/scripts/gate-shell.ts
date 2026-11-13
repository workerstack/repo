import { isImplementer } from "./gate-agents.ts";
import type { GateCall, GuardResult } from "./gate-call.ts";
import { SHELL_META, type GateResult } from "./gate-harness.ts";
import { alreadyRtk, isWorkspaceJobScript, jobCommand, quoteQuery } from "./gate-job.ts";
import { bashTargetsDenylist } from "./gate-paths.ts";
/** Shell commands: dumps, searches, test runs and fetches go through `repo job`, so the caller sees a short answer. */
import {
  BASH_DUMP_CMDS,
  BASH_SEARCH,
  BASH_TREE,
  BASH_URL,
  BASH_WEB,
  BUN_NATIVE_TEST,
  BUN_SCRIPT_TEST,
  LOCAL_CI_REPO,
  LOCAL_CI_SCRIPT,
  REASON_DENYLIST,
  REASON_LOCAL_CI,
  TEST_CMD,
} from "./gate.constants.ts";
import { activeReview } from "./strategy.ts";

/** Leading blanks and an `rtk ` prefix, which a job query drops. */
const LEADING_RTK_RE = /^\s*(rtk\s+)?/;

/** The call with its command swapped for `command`. */
function withCommand({ input, field }: GateCall, command: string): GateResult {
  return { type: "rewrite", updatedInput: { ...input, [field]: command } };
}

/** The job command for `job`, with `query` quoted, run from the checkout. */
function jobFor({ roots }: GateCall, job: string, query: string): string {
  return jobCommand(roots.checkout, `--job ${job} --query ${quoteQuery(query)}`);
}

/** True when job and rtk can take the command: it is one plain command and not already rtk's. */
function takesJob(cmd: string): boolean {
  return !alreadyRtk(cmd) && !SHELL_META.test(cmd);
}

export function denylistShellGuard(call: GateCall): GuardResult {
  return bashTargetsDenylist(call.text) ? { reason: REASON_DENYLIST, type: "deny" } : undefined;
}

/** A call to the job command itself runs as it is. */
export function jobScriptGuard(call: GateCall): GuardResult {
  return isWorkspaceJobScript(call.text, call.roots) ? null : undefined;
}

/** A whole-ci run by an agent is denied: GitHub runs ci. `repo ci wait` and the other subcommands pass. */
export function localCiGuard(call: GateCall): GuardResult {
  return call.tool.kind === "bash" && [LOCAL_CI_REPO, LOCAL_CI_SCRIPT].some((re) => re.test(call.text))
    ? { reason: REASON_LOCAL_CI, type: "deny" }
    : undefined;
}

/** Bun's own runner cannot run this repo's vitest suites, so `bun test` runs the `test` script instead. */
function shadowBunTest(text: string): string {
  return text.replace(BUN_NATIVE_TEST, `$1${BUN_SCRIPT_TEST}`);
}

/**
 * A `bun test` runs as `bun run test`, for every caller. A test run's full log then goes to the stash and the caller
 * sees the failing lines: for implementers, and for a parent while its session reviews. job takes one plain command;
 * compound shell passes through.
 */
export function testRunGuard(call: GateCall): GuardResult {
  const { sub, parent, sid, roots } = call;
  const text = shadowBunTest(call.text);
  const shadowed = text === call.text ? undefined : withCommand(call, text);

  if (!TEST_CMD.test(text) || SHELL_META.test(text)) return shadowed;
  const isReviewing = parent && sid !== "" && activeReview(roots.root, sid) !== null;

  return isImplementer(sub) || isReviewing ? withCommand(call, jobFor(call, "test", text.trim())) : shadowed;
}

/** A fetch goes through `job fetch`; one with no URL to fetch is denied. */
export function webGuard(call: GateCall): GuardResult {
  if (!BASH_WEB.test(call.text)) return undefined;
  const url = BASH_URL.exec(call.text)?.[0];

  return url === undefined ? { reason: REASON_DENYLIST, type: "deny" } : withCommand(call, jobFor(call, "fetch", url));
}

/** A plain dump or search runs as `job exec` or `job search`. */
export function dumpGuard(call: GateCall): GuardResult {
  const { text } = call;

  if (!BASH_DUMP_CMDS.test(text) || !takesJob(text)) return undefined;
  const query = text.replace(LEADING_RTK_RE, "").trim();

  return withCommand(call, jobFor(call, BASH_SEARCH.test(text) ? "search" : "exec", query));
}

/** A plain `ls` or `tree` runs behind rtk. */
export function treeGuard(call: GateCall): GuardResult {
  const { text } = call;

  return BASH_TREE.test(text) && takesJob(text) ? withCommand(call, `rtk ${text.trim()}`) : undefined;
}
