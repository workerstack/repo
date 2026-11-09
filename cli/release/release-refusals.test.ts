import { afterEach, describe, expect, it } from "vitest";
import { removePlanted, tempDir, write } from "../fixtures/planted-repo.ts";
import { NAME, commit, fakeGh, feat, gitIn, release, snapshot, world, type World } from "../fixtures/release-world.ts";

afterEach(removePlanted);

const USAGE = "usage: bun repo release [--stable | --pre <id>]  |  bun repo release wait <name>@<version>";
/** What a refused release leaves: exit 1, the one line on stderr, nothing on stdout. */
const refusal = (line: string) => ({ code: 1, out: "", err: `repo release: ${line}\n`, wrote: false });

/** Runs a release and reports whether it wrote anything to the checkout or origin. */
async function attempt(w: World, argv: string[] = [], gh = fakeGh()) {
  const before = snapshot(w);
  const got = await release(w, argv, gh);
  return { ...got, wrote: JSON.stringify(snapshot(w)) !== JSON.stringify(before) };
}

describe("repo release refuses the state of the checkout", () => {
  it("a working tree with changes", async () => {
    const w = world();
    feat(w);
    write(w.work, { "stray.txt": "x\n" });
    expect(await attempt(w)).toEqual(refusal("the working tree has changes; commit or stash them first"));
  });

  it("a branch that is not main", async () => {
    const w = world();
    feat(w);
    gitIn(w.work, "checkout", "-q", "-b", "wt/x");
    expect(await attempt(w)).toEqual(refusal("release from main; this checkout is on wt/x"));
  });

  it("a main behind origin/main", async () => {
    const w = world();
    feat(w);
    gitIn(w.work, "reset", "-q", "--hard", "HEAD~1");
    const differ = "main and origin/main differ (1 behind, 0 ahead); pull or push first";
    expect(await attempt(w)).toEqual(refusal(differ));
  });

  it("a main ahead of origin/main", async () => {
    const w = world();
    feat(w, false);
    const differ = "main and origin/main differ (0 behind, 1 ahead); pull or push first";
    expect(await attempt(w)).toEqual(refusal(differ));
  });
});

describe("repo release refuses what the commits and files say", () => {
  it("no feat, fix, perf, revert or breaking commit since the last tag", async () => {
    const w = world();
    commit(w, "docs: words", { "README.md": "x\n" });
    const line = `nothing to release since ${NAME}@0.1.0: no feat, fix, perf, revert or breaking commit`;
    expect(await attempt(w)).toEqual(refusal(line));
  });

  it("an empty Unreleased", async () => {
    const w = world();
    commit(w, "feat: add x", { "src/x.ts": "export const x = 1;\n" });
    const line = "CHANGELOG.md has no entries under ## [Unreleased]; add them first";
    expect(await attempt(w)).toEqual(refusal(line));
  });

  it("--stable on a version that is already 1.x", async () => {
    const w = world({ "package.json": { name: NAME, version: "1.2.0" } }, false);
    gitIn(w.work, "tag", "-a", `${NAME}@1.2.0`, "-m", "x");
    gitIn(w.work, "push", "-q", "origin", "--tags");
    feat(w);
    const line = `--stable moves a 0.x version to 1.0.0; ${NAME} is 1.2.0`;
    expect(await attempt(w, ["--stable"])).toEqual(refusal(line));
  });

  it("a tag the next version already has", async () => {
    const w = world();
    feat(w);
    gitIn(w.work, "tag", "-a", `${NAME}@0.1.1`, "-m", "x");
    gitIn(w.work, "push", "-q", "origin", "--tags");
    const line = `the tag ${NAME}@0.1.1 already exists; a tag is never moved, so release the next version`;
    expect(await attempt(w)).toEqual(refusal(line));
  });
});

describe("repo release refuses the package and its config", () => {
  it("a private package", async () => {
    const w = world({ "package.json": { name: NAME, version: "0.1.0", private: true } });
    feat(w);
    expect(await attempt(w)).toEqual(refusal(`${NAME} is private; set "private": false to publish it`));
  });

  it("a repo without the release pack", async () => {
    const w = world({ "workerstack.config.ts": "export default { packs: [] };\n" });
    feat(w);
    const line = 'the release pack is off; add "release" to packs in workerstack.config.ts';
    expect(await attempt(w)).toEqual(refusal(line));
  });
});

describe("repo release refuses a manifest it cannot use", () => {
  it("a broken config", async () => {
    const w = world({ "workerstack.config.ts": "export default 3;\n" });
    const got = await attempt(w);
    expect(got).toMatchObject({ code: 1, out: "", wrote: false });
    expect(got.err).toMatch(/^repo release: .*default export/);
  });

  it("a manifest that is not JSON", async () => {
    const w = world({ "package.json": "[" });
    expect(await attempt(w)).toEqual(refusal("package.json needs a name and a version"));
  });

  it("a manifest without a version", async () => {
    const w = world({ "package.json": { name: NAME } });
    expect(await attempt(w)).toEqual(refusal("package.json needs a name and a version"));
  });

  it("a version that is not semver", async () => {
    const w = world({ "package.json": { name: NAME, version: "latest" } });
    expect(await attempt(w)).toEqual(refusal(`${NAME} is at latest, which is not semver`));
  });
});

describe("repo release refuses where it runs", () => {
  it("gh that is missing or logged out", async () => {
    const w = world();
    feat(w);
    const line = "gh is not installed or not logged in; run `gh auth login`";
    expect(await attempt(w, [], fakeGh({ auth: false }))).toEqual(refusal(line));
  });

  it("an origin that cannot be fetched", async () => {
    const w = world();
    gitIn(w.work, "remote", "set-url", "origin", "/nonexistent/remote.git");
    const got = await attempt(w);
    expect(got.code).toBe(1);
    expect(got.err).toMatch(/^repo release: git fetch failed: /);
  });

  it("a directory that is not a git checkout", async () => {
    const got = await release({ work: tempDir(), remote: "" }, []);
    expect(got).toEqual({ code: 1, out: "", err: "repo release: run it inside a git checkout\n" });
  });

  it.each([[["--pre"]], [["--pre", "r c"]], [["--stable", "--pre", "rc"]], [["--bogus"]]])(
    "the arguments %j",
    async (argv) => {
      expect(await attempt(world(), argv)).toEqual(refusal(USAGE));
    },
  );
});
