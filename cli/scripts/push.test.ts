import { describe, expect, it, vi } from "vitest";

import { DAY, usePushRepos, type PushRepo } from "./__fixtures__/push-repo.ts";
import type { RecordFs } from "./ci-wait-record.ts";
import { spawnRunner, type Runner } from "./ci-wait-run.ts";
import { pickTarget } from "./push-target.ts";
import { main } from "./push.ts";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const { repo } = usePushRepos();

/** How the faked ci run ends: `repo ci wait` exits 0, 1 and 2 on these. */
type Conclusion = "success" | "failure" | "cancelled";

const BRANCHES = ["main", "feat-a", "feat-b", "old"];

function done(stdout: string) {
  return { code: 0, stderr: "", stdout };
}

/**
 * A gh that is logged in, has one ci run per branch of BRANCHES for any commit, each ending in `conclusion` (a
 * cancelled one superseded by a newer run), and notes the branch of each run it is asked to view.
 */
function fakeGh(conclusion: Conclusion, viewed: string[]): Runner {
  return (args) => {
    const [verb, sub, id, flag] = args;

    if (verb === "auth") return done("");

    if (sub === "list" && id === "--commit") {
      const runs = BRANCHES.map((headBranch, i) => ({
        createdAt: "2026-11-12T11:00:00Z",
        databaseId: i + 1,
        headBranch,
      }));

      return done(JSON.stringify(runs));
    }

    if (sub === "list") return done(JSON.stringify([{ createdAt: "2026-11-12T11:30:00Z", databaseId: 99 }]));

    if (flag !== "--json") return { code: 1, stderr: "", stdout: "" };
    viewed.push(String(BRANCHES[Number(id) - 1]));

    return done(JSON.stringify({ conclusion, jobs: [{ conclusion, name: "test" }], status: "completed" }));
  };
}

/** An fs that drops the ci outcome records. */
function ignore(): void {
  // A dropped record: nothing is written.
}

const noRecords = {
  mkdirSync: ignore,
  renameSync: ignore,
  rmSync: ignore,
  writeFileSync: ignore,
} as unknown /* a record calls only these four, and their results are not read */ as RecordFs;

/** Runs `repo push <argv>` in `r` with gh faked so the ci run ends in `conclusion`, and reports what it did. */
async function push(r: PushRepo, argv: string[] = [], conclusion: Conclusion = "success") {
  const out: string[] = [];
  const waits: string[] = [];

  const code = await main(argv, {
    cwd: r.dir,
    fs: noRecords,
    gh: fakeGh(conclusion, waits),
    now: () => NOW,
    sleep: () => Promise.resolve(),
    stderr: (s) => out.push(s),
    stdout: (s) => out.push(s),
  });

  return { code, out: out.join(""), waits };
}

/** A repo on main with feat-b (2 days old) and feat-a (1 day old) touched this week. */
function twoRecent(): PushRepo {
  const r = repo({ now: NOW });
  r.commitOn("feat-b", 2);
  r.commitOn("feat-a", 1);
  r.git(["checkout", "-q", "main"]);

  return r;
}

const ASK =
  "repo push: main has 2 recent branches (feat-a, feat-b); run `bun repo push <branch>` with the one to push\n";

const WORKTREE =
  "repo push: wt/124-x is a managed worktree; " +
  "run `bun repo worktree finish 124-x` from the root, then `bun repo push` there\n";

const USAGE = "usage: repo push [<branch>]\n";

describe("repo push from the default branch", () => {
  it("pushes the default branch when no other branch is recent, and returns ci wait's code", async () => {
    const r = repo({ now: NOW });
    r.commitOn("old", 10);
    r.git(["checkout", "-q", "main"]);
    const tip = r.commitOn("main", 0);
    const result = await push(r, [], "failure");
    expect(result.code).toBe(1);
    expect(result.waits).toStrictEqual(["main"]);
    expect(r.originSha("main")).toBe(tip);
    expect(r.originSha("old")).toBeNull();
  });

  it("pushes the one recent branch, skipping stale and wt/ branches, with -u origin", async () => {
    const r = repo({ now: NOW });
    r.commitOn("old", 8);
    r.git(["checkout", "-q", "main"]);
    r.commitOn("wt/9-y", 0);
    r.git(["checkout", "-q", "main"]);
    const tip = r.commitOn("feat-a", 6);
    r.git(["checkout", "-q", "main"]);
    const result = await push(r, [], "cancelled");
    expect(result.code).toBe(2);
    expect(result.waits).toStrictEqual(["feat-a"]);
    expect(r.originSha("feat-a")).toBe(tip);
    expect(r.upstream("feat-a")).toBe("origin/feat-a");
  });
});

describe("repo push picks the branch", () => {
  it("pushes the checked-out branch when it is not the default", async () => {
    const r = twoRecent();
    const tip = r.commitOn("feat-b", 0);
    const result = await push(r);
    expect(result.code).toBe(0);
    expect(result.waits).toStrictEqual(["feat-b"]);
    expect(r.originSha("feat-b")).toBe(tip);
    expect(r.originSha("feat-a")).toBeNull();
  });

  it("asks with exit 5 when the default has more than one recent branch, and pushes nothing", async () => {
    const r = twoRecent();
    const result = await push(r);
    expect(result).toStrictEqual({ code: 5, out: ASK, waits: [] });
    expect(r.originSha("feat-a")).toBeNull();
    expect(r.originSha("feat-b")).toBeNull();
  });
});

describe("repo push <branch>", () => {
  it("pushes the named branch with -u origin when it has no upstream", async () => {
    const r = twoRecent();
    const result = await push(r, ["feat-b"], "failure");
    expect(result.code).toBe(1);
    expect(result.waits).toStrictEqual(["feat-b"]);
    expect(r.originSha("feat-b")).toBe(r.git(["rev-parse", "feat-b"]));
    expect(r.upstream("feat-b")).toBe("origin/feat-b");
    expect(r.originSha("feat-a")).toBeNull();
  });

  it("exits 1 without waiting when pre-push refuses the push", async () => {
    const r = twoRecent();
    r.refusePushes();
    expect(await push(r, ["feat-b"])).toStrictEqual({
      code: 1,
      out: "repo push: git push failed (exit 1); fix what the pre-push lines above name and run it again\n",
      waits: [],
    });
    expect(r.originSha("feat-b")).toBeNull();
  });
});

describe("repo push sends a managed worktree to finish", () => {
  it("refuses a checked-out wt/ branch with exit 1", async () => {
    const r = repo({ now: NOW });
    r.commitOn("wt/124-x", 0);
    expect(await push(r)).toStrictEqual({ code: 1, out: WORKTREE, waits: [] });
    expect(r.originSha("wt/124-x")).toBeNull();
  });

  it("refuses a named wt/ branch with exit 1", async () => {
    const r = repo({ now: NOW });
    r.commitOn("wt/124-x", 0);
    r.git(["checkout", "-q", "main"]);
    expect(await push(r, ["wt/124-x"])).toStrictEqual({ code: 1, out: WORKTREE, waits: [] });
    expect(r.originSha("wt/124-x")).toBeNull();
  });
});

describe("repo push usage", () => {
  it.each([[["feat-a", "feat-b"]], [["--force"]], [["-f", "feat-a"]]])(
    "prints usage with exit 4 for %j, and pushes nothing",
    async (argv) => {
      const r = twoRecent();
      expect(await push(r, argv)).toStrictEqual({ code: 4, out: USAGE, waits: [] });
      expect(r.originSha("feat-a")).toBeNull();
      expect(r.originSha("feat-b")).toBeNull();
    },
  );

  it("prints usage to the process's stderr when given no deps", async () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      expect(await main(["--help"])).toBe(4);
      expect(err.mock.calls.map((c) => String(c[0])).join("")).toBe(USAGE);
    } finally {
      err.mockRestore();
    }
  });
});

describe("repo push with nothing to push", () => {
  it("exits 4 on a detached HEAD", async () => {
    const r = repo({ now: NOW });
    r.git(["checkout", "-q", "--detach"]);
    expect(await push(r)).toStrictEqual({
      code: 4,
      out: "repo push: HEAD is detached; check out the branch to push, or run `bun repo push <branch>`\n",
      waits: [],
    });
  });

  it("exits 4 when origin has no default branch", async () => {
    const r = repo({ now: NOW, setHead: false });
    expect(await push(r)).toStrictEqual({
      code: 4,
      out: "repo push: origin has no default branch; run `git remote set-head origin --auto`\n",
      waits: [],
    });
  });
});

describe("pickTarget", () => {
  const git = spawnRunner("git");

  it("names the branch to push, or why there is none", () => {
    const r = twoRecent();
    expect(pickTarget(git, r.dir, NOW)).toStrictEqual({ base: "main", branches: ["feat-a", "feat-b"], kind: "ask" });
    // feat-b is 7.5 days old and feat-a 6.5 days at this clock, so only feat-a is recent.
    expect(pickTarget(git, r.dir, NOW + 5.5 * DAY)).toStrictEqual({ branch: "feat-a", kind: "branch" });
    r.git(["checkout", "-q", "feat-b"]);
    expect(pickTarget(git, r.dir, NOW)).toStrictEqual({ branch: "feat-b", kind: "branch" });
    r.git(["checkout", "-q", "--detach"]);
    expect(pickTarget(git, r.dir, NOW)).toStrictEqual({ kind: "detached" });
  });
});
