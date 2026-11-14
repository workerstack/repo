import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { WorkflowRead } from "../workflow.ts";
import { usePushRepos, type PushRepo } from "./__fixtures__/push-repo.ts";
import { pushDeny, STRICT } from "./__fixtures__/workflow-guards.ts";
import type { RecordFs } from "./ci-wait-record.ts";
import type { Runner } from "./ci-wait-run.ts";
import { main, type PushDeps } from "./push.ts";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const { repo } = usePushRepos();

function done(stdout: string) {
  return { code: 0, stderr: "", stdout };
}

const RUNS = ["main", "feat"].map((headBranch, i) => ({
  createdAt: "2026-11-12T11:00:00Z",
  databaseId: i + 1,
  headBranch,
}));

const PASSED = { conclusion: "success", jobs: [{ conclusion: "success", name: "test" }], status: "completed" };

/** A gh that is logged in and has one successful ci run on main and on feat for any commit. */
function gh(args: string[]): ReturnType<Runner> {
  const [verb, sub, mode, flag] = args;

  if (verb === "auth") return done("");

  if (sub === "list") return done(JSON.stringify(mode === "--commit" ? RUNS : []));

  if (flag !== "--json") return { code: 1, stderr: "", stdout: "" };

  return done(JSON.stringify(PASSED));
}

function ignore(): void {
  // A dropped record: nothing is written.
}

const noRecords: RecordFs = { mkdirSync: ignore, renameSync: ignore, rmSync: ignore, writeFileSync: ignore };

/** Runs `repo push <argv>` from `cwd` with gh faked, and reports its exit code and what it printed. */
async function push(cwd: string, argv: string[], deps: PushDeps = {}) {
  const out: string[] = [];

  const code = await main(argv, {
    cwd,
    fs: noRecords,
    gh,
    now: () => NOW,
    sleep: () => Promise.resolve(),
    stderr: (s) => out.push(s),
    stdout: (s) => out.push(s),
    ...deps,
  });

  return { code, out: out.join("") };
}

function deny(read: WorkflowRead): string {
  return `repo push: ${pushDeny(read)}\n`;
}

/** A push repo with a commit on main that origin does not hold, and a managed worktree `x` on `wt/x`. */
type Ahead = { r: PushRepo; tree: string; pushed: string | null };

function ahead(): Ahead {
  const r = repo({ now: NOW });
  const pushed = r.originSha("main");
  r.commitOn("main", 0);
  const tree = path.join(r.dir, ".worktrees", "x");
  r.git(["worktree", "add", "-q", tree, "-b", "wt/x"]);

  return { pushed, r, tree };
}

describe("repo push main under a pull-request workflow", () => {
  it.each(STRICT)("refuses main under %s from the root and a worktree", async (read) => {
    const { pushed, r, tree } = ahead();
    const workflow = vi.fn<(root: string) => WorkflowRead>(() => read);
    const refused = { code: 1, out: deny(read) };
    expect(await push(r.dir, ["main"], { workflow })).toStrictEqual(refused);
    expect(await push(tree, ["main"], { workflow })).toStrictEqual(refused);
    expect(workflow.mock.calls).toStrictEqual([[fs.realpathSync(r.dir)], [fs.realpathSync(r.dir)]]);
    expect(r.originSha("main")).toBe(pushed);
  });

  it("reads the mode from the main root's repo.config.ts, never the worktree's own", async () => {
    const { pushed, r, tree } = ahead();
    fs.writeFileSync(path.join(r.dir, "repo.config.ts"), 'export default { workflow: "pull-request" };\n');
    fs.writeFileSync(path.join(tree, "repo.config.ts"), 'export default { workflow: "main" };\n');
    expect(await push(tree, ["main"])).toStrictEqual({ code: 1, out: deny("pull-request") });
    expect(r.originSha("main")).toBe(pushed);
  });
});

describe("repo push of what a workflow lets through", () => {
  it("pushes a branch other than the default under pull-request", async () => {
    const { r } = ahead();
    const tip = r.commitOn("feat", 0);
    const result = await push(r.dir, ["feat"], { workflow: () => "pull-request" });
    expect(result.code).toBe(0);
    expect(r.originSha("feat")).toBe(tip);
  });

  it.each(["worktree", "main"] as const)("pushes main under %s", async (read) => {
    const { r } = ahead();
    const tip = r.git(["rev-parse", "main"]);
    const result = await push(r.dir, ["main"], { workflow: () => read });
    expect(result.code).toBe(0);
    expect(r.originSha("main")).toBe(tip);
  });
});

describe("repo push of a managed worktree's branch", () => {
  const finishing =
    "repo push: wt/x is a managed worktree; run bun repo worktree finish x: " +
    "it pushes the branch and opens its pull request\n";

  it("sends it to finish under pull-request, named or picked in the worktree", async () => {
    const { r, tree } = ahead();
    const workflow = vi.fn<(root: string) => WorkflowRead>(() => "pull-request");
    expect(await push(r.dir, ["wt/x"], { workflow })).toStrictEqual({ code: 1, out: finishing });
    expect(await push(tree, [], { workflow })).toStrictEqual({ code: 1, out: finishing });
    expect(workflow.mock.calls).toStrictEqual([[fs.realpathSync(r.dir)], [fs.realpathSync(r.dir)]]);
    expect(r.originSha("wt/x")).toBeNull();
  });

  it.each(["worktree", "main", "unreadable"] as const)("keeps the push-from-the-root text under %s", async (read) => {
    const { r } = ahead();

    const text =
      "repo push: wt/x is a managed worktree; " +
      "run `bun repo worktree finish x` from the root, then `bun repo push` there\n";

    expect(await push(r.dir, ["wt/x"], { workflow: () => read })).toStrictEqual({ code: 1, out: text });
  });
});
