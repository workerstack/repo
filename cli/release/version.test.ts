import { describe, expect, it } from "vitest";

import { nextVersion, type Mode } from "./version.ts";

function commit(subject: string, body = "") {
  return { body, subject };
}

const AUTO: Mode = { kind: "auto" };

type Options = { mode?: Mode; first?: boolean };

function next(current: string, subjects: string[], { mode = AUTO, first = false }: Options = {}) {
  return nextVersion({ commits: subjects.map((subject) => commit(subject)), current, first, mode });
}

describe("below 1.0", () => {
  it("makes a breaking commit a minor and everything else a patch", () => {
    expect(next("0.1.0", ["feat!: drop x"])).toStrictEqual({ ok: true, version: "0.2.0" });
    expect(next("0.1.3", ["fix(cli)!: rename y"])).toStrictEqual({ ok: true, version: "0.2.0" });
    expect(next("0.1.0", ["feat: add x"])).toStrictEqual({ ok: true, version: "0.1.1" });
    expect(next("0.1.0", ["fix: x"])).toStrictEqual({ ok: true, version: "0.1.1" });
    expect(next("0.1.0", ["perf: x"])).toStrictEqual({ ok: true, version: "0.1.1" });
    expect(next("0.1.0", ["revert: x"])).toStrictEqual({ ok: true, version: "0.1.1" });
  });

  it("reads a BREAKING CHANGE footer as breaking", () => {
    const got = nextVersion({
      commits: [commit("feat: x", "why\n\nBREAKING CHANGE: the flag is gone")],
      current: "0.4.2",
      first: false,
      mode: AUTO,
    });

    expect(got).toStrictEqual({ ok: true, version: "0.5.0" });
  });
});

describe("from 1.0", () => {
  it("bumps major for breaking, minor for feat and patch for fix, perf and revert", () => {
    expect(next("1.2.3", ["feat!: x"])).toStrictEqual({ ok: true, version: "2.0.0" });
    expect(next("1.2.3", ["feat: x"])).toStrictEqual({ ok: true, version: "1.3.0" });
    expect(next("1.2.3", ["fix: x"])).toStrictEqual({ ok: true, version: "1.2.4" });
    expect(next("1.2.3", ["perf(a): x"])).toStrictEqual({ ok: true, version: "1.2.4" });
    expect(next("1.2.3", ["revert: x"])).toStrictEqual({ ok: true, version: "1.2.4" });
  });

  it("reads the footer and lets the highest commit win", () => {
    const footer = commit("fix: x", "BREAKING-CHANGE: gone");
    expect(nextVersion({ commits: [footer], current: "1.2.3", first: false, mode: AUTO })).toStrictEqual({
      ok: true,
      version: "2.0.0",
    });
    expect(next("1.2.3", ["fix: a", "feat: b", "docs: c"])).toStrictEqual({ ok: true, version: "1.3.0" });
  });

  it("ignores a body line that only mentions the footer", () => {
    const mention = commit("fix: x", "see BREAKING CHANGE: in the docs");
    expect(nextVersion({ commits: [mention], current: "1.2.3", first: false, mode: AUTO })).toStrictEqual({
      ok: true,
      version: "1.2.4",
    });
  });

  it("finds nothing to release in chore, docs, refactor, test and unparsable subjects", () => {
    const none = { ok: false, reason: "nothing" };
    expect(next("1.2.3", ["chore: x", "docs: y", "refactor: z", "test: w", "not conventional"])).toStrictEqual(none);
    expect(next("1.2.3", [])).toStrictEqual(none);
  });
});

describe("first release", () => {
  it("releases 0.1.0 from 0.0.0 with no tag, whatever the commits", () => {
    expect(next("0.0.0", ["chore: x"], { first: true })).toStrictEqual({ ok: true, version: "0.1.0" });
    expect(next("0.0.0", [], { first: true, mode: { id: "rc", kind: "pre" } })).toStrictEqual({
      ok: true,
      version: "0.1.0-rc.0",
    });
    expect(next("0.0.0", [], { first: true, mode: { kind: "stable" } })).toStrictEqual({ ok: true, version: "1.0.0" });
  });
});

describe("--stable", () => {
  it("moves a 0.x version to 1.0.0 even with nothing else to release", () => {
    expect(next("0.4.2", ["fix: x"], { mode: { kind: "stable" } })).toStrictEqual({ ok: true, version: "1.0.0" });
    expect(next("0.4.2", [], { mode: { kind: "stable" } })).toStrictEqual({ ok: true, version: "1.0.0" });
    expect(next("0.9.0-rc.1", [], { mode: { kind: "stable" } })).toStrictEqual({ ok: true, version: "1.0.0" });
  });

  it("refuses a 1.x version", () => {
    expect(next("1.2.0", ["feat: x"], { mode: { kind: "stable" } })).toStrictEqual({ ok: false, reason: "stable" });
  });
});

describe("--pre", () => {
  const rc: Mode = { id: "rc", kind: "pre" };

  it("starts a prerelease on the computed version", () => {
    expect(next("1.0.0", ["feat: x"], { mode: rc })).toStrictEqual({ ok: true, version: "1.1.0-rc.0" });
  });

  it("counts up on the same base and id, and starts again on a new id", () => {
    expect(next("1.1.0-rc.0", ["fix: x"], { mode: rc })).toStrictEqual({ ok: true, version: "1.1.0-rc.1" });
    expect(next("1.1.0-rc.1", ["fix: x"], { mode: { id: "beta", kind: "pre" } })).toStrictEqual({
      ok: true,
      version: "1.1.0-beta.0",
    });
  });

  it("finds nothing to release without a releasable commit", () => {
    expect(next("1.1.0-rc.0", ["chore: x"], { mode: rc })).toStrictEqual({ ok: false, reason: "nothing" });
  });
});

describe("graduation", () => {
  it("releases the base of a prerelease with a plain release, whatever the commits", () => {
    expect(next("1.1.0-rc.1", [])).toStrictEqual({ ok: true, version: "1.1.0" });
    expect(next("0.2.0-rc.0", ["chore: x"])).toStrictEqual({ ok: true, version: "0.2.0" });
  });
});

describe("a version that is not semver", () => {
  it("is nothing to bump from", () => {
    expect(next("latest", ["feat: x"])).toStrictEqual({ ok: false, reason: "version" });
  });
});
