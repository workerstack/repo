import path from "node:path";

import { expect, it } from "vitest";

import type { CargoResult, CargoRun } from "../rust/clippy.ts";
import { crateLine, type SemverDeps } from "./semver-checks.ts";
import type { Commit } from "./version.ts";

const MANIFEST = "/repo/a/Cargo.toml";
const crate = (version: string) => ({ manifest_path: MANIFEST, name: "a", version });
const row = (vers: string) => JSON.stringify({ deps: [], pubtime: "2026-01-01T00:00:00Z", vers, yanked: false });
const bare = JSON.stringify({ vers: "1.0.2", yanked: false });

type Setup = { index?: Response; commits?: Commit[]; result?: Partial<CargoResult> };
/** The injected edges: an index answer, the crate's commits, a cargo result; and what they were asked. */
function deps({ index, commits = [], result = {} }: Setup = {}) {
  const runs: (readonly string[])[] = [];
  const asked: { since: string; dir: string }[] = [];
  const run: CargoRun = (_root, args) => {
    runs.push(args);
    return { missing: false, status: 0, stderr: "", stdout: "", ...result };
  };
  const all: SemverDeps = {
    fetch: () => Promise.resolve(index ?? new Response(row("1.0.2"))),
    git: (after) => {
      asked.push(after);
      return commits;
    },
    run,
  };
  return { all, asked, runs };
}
const commit = (subject: string, body = ""): Commit => ({ body, subject });
const PREFIX = [
  "--locked",
  "semver-checks",
  "check-release",
  "--manifest-path",
  path.join("/repo", "Cargo.toml"),
  "-p",
  "a",
];

const BREAKING = [
  "--- failure function_missing: pub fn removed or renamed ---",
  "",
  "Description:",
  "A publicly-visible function cannot be imported by its prior path.",
  "",
  "Failed in:",
  "  function adler::adler32_slice, previously in file /home/x/adler-1.0.2/src/lib.rs:170",
  "  function adler::other, previously in file /home/x/adler-1.0.2/src/lib.rs:180",
  "",
  "--- failure struct_missing: pub struct removed ---",
  "Description:",
  "A struct was removed.",
  "Failed in:",
  "  struct adler::S, previously in file /home/x/src/lib.rs:1",
].join("\n");
const PROGRESS =
  "    Finished [ 0.690s] a\n     Summary semver requires new major version: 2 major and 0 minor checks failed";

it("passes a version above the baseline without a release type", async () => {
  const { all, runs, asked } = deps();
  const line = await crateLine("/repo", crate("2.0.0"), all);
  expect(line).toStrictEqual({ ok: true, text: "crate a 1.0.2 → this checkout · 2.0.0 in Cargo.toml · ok" });
  expect(runs).toStrictEqual([[...PREFIX, "--baseline-version", "1.0.2"]]);
  expect(asked).toStrictEqual([]);
});

it("maps commits since the baseline's publish time, in the crate's directory, to a release type", async () => {
  const cases: [string, Commit[], string][] = [
    ["1.0.2", [commit("feat!: drop")], "major"],
    ["1.0.2", [commit("fix: x", "BREAKING CHANGE: y")], "major"],
    ["1.0.2", [commit("fix: x"), commit("feat: y")], "minor"],
    ["1.0.2", [commit("fix: x"), commit("docs: y")], "patch"],
    ["1.0.2", [], "patch"],
  ];
  await Promise.all(
    cases.map(async ([version, commits, type]) => {
      const { all, runs, asked } = deps({ commits });
      const line = await crateLine("/repo", crate(version), all);
      expect(line).toStrictEqual({ ok: true, text: `crate a 1.0.2 from crates.io → this checkout · ${type} · ok` });
      expect(runs).toStrictEqual([[...PREFIX, "--baseline-version", "1.0.2", "--release-type", type]]);
      expect(asked).toStrictEqual([{ dir: "/repo/a", since: "2026-01-01T00:00:00Z" }]);
    }),
  );
});

it("maps a 0.y crate's breaking commit to minor and everything else to patch", async () => {
  const types = async (commits: Commit[]) => {
    const { all, runs } = deps({ commits, index: new Response(row("0.3.1")) });
    await crateLine("/repo", crate("0.3.1"), all);
    return runs[0]?.at(-1);
  };
  expect(await types([commit("feat!: drop")])).toBe("minor");
  expect(await types([commit("feat: add")])).toBe("patch");
});

it("takes patch when the baseline has no publish time", async () => {
  const { all, runs, asked } = deps({ commits: [commit("feat!: drop")], index: new Response(bare) });
  await crateLine("/repo", crate("1.0.2"), all);
  expect(runs[0]?.at(-1)).toBe("patch");
  expect(asked).toStrictEqual([]);
});

it("skips a crate crates.io does not have", async () => {
  const { all, runs } = deps({ index: new Response("", { status: 404 }) });
  expect(await crateLine("/repo", crate("0.1.0"), all)).toStrictEqual({
    ok: true,
    text: "crate a is not on crates.io yet; nothing to compare",
  });
  expect(runs).toStrictEqual([]);
});

it("says why the index could not answer", async () => {
  const { all } = deps({ index: new Response("", { status: 503 }) });
  expect(await crateLine("/repo", crate("1.0.2"), all)).toStrictEqual({
    ok: false,
    text: "crates.io index for a answered 503; try again",
  });
});

it("fails one line per failed lint with its items, and the release it needs", async () => {
  const { all } = deps({ result: { status: 100, stderr: PROGRESS, stdout: BREAKING } });
  const line = await crateLine("/repo", crate("1.0.2"), all);
  const from = "crate a 1.0.2 → this checkout needs a major release";
  const advice = "restore it, bump a's version, or mark a commit breaking with `!`";
  expect(line).toStrictEqual({
    ok: false,
    text: [
      `${from}: function adler::adler32_slice; function adler::other (function_missing: pub fn removed or renamed); ${advice}`,
      `${from}: struct adler::S (struct_missing: pub struct removed); ${advice}`,
    ].join("\n"),
  });
});

it("does not suggest a commit mark when the version was already bumped", async () => {
  const stdout = "--- failure f: g ---\nFailed in:\n  fn x\nSummary semver requires new minor version: 1";
  const { all } = deps({ result: { status: 100, stdout } });
  expect(await crateLine("/repo", crate("1.0.3"), all)).toStrictEqual({
    ok: false,
    text: "crate a 1.0.2 → this checkout needs a minor release: fn x (f: g); restore it or bump a's version further",
  });
});

it("names a release as newer when the tool did not say which", async () => {
  const { all } = deps({ result: { status: 100, stderr: "--- failure f: g ---\nFailed in:\n  fn x" } });
  expect(await crateLine("/repo", crate("1.0.2"), all)).toStrictEqual({
    ok: false,
    text: "crate a 1.0.2 → this checkout needs a newer release: fn x (f: g); restore it, bump a's version, or mark a commit breaking with `!`",
  });
});

it("quotes the error line of any other exit", async () => {
  const stderr = "Updating crates.io index\nerror: failed to retrieve index\nCaused by:\n  x";
  const { all } = deps({ result: { status: 101, stderr } });
  expect(await crateLine("/repo", crate("1.0.2"), all)).toStrictEqual({
    ok: false,
    text: "cargo semver-checks exited 101 for a: error: failed to retrieve index",
  });
});

it("quotes the first line when no line says error, and reports a signal or an empty stderr", async () => {
  const first = deps({ result: { status: null, stderr: "boom\nmore" } });
  expect(await crateLine("/repo", crate("1.0.2"), first.all)).toMatchObject({
    text: "cargo semver-checks exited by signal for a: boom",
  });
  const none = deps({ result: { status: 100, stderr: "" } });
  expect(await crateLine("/repo", crate("1.0.2"), none.all)).toMatchObject({
    text: "cargo semver-checks exited 100 for a: no output",
  });
});

it("quotes the output when exit 100 has items but no lint header", async () => {
  const { all } = deps({ result: { status: 100, stderr: "Failed in:\n\n  fn x" } });
  expect(await crateLine("/repo", crate("1.0.2"), all)).toStrictEqual({
    ok: false,
    text: "cargo semver-checks exited 100 for a: Failed in:",
  });
});
