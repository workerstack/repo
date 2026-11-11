import { describe, expect, it } from "vitest";

import { parseNeed } from "./parse-need.ts";

function need(rows: unknown) {
  return parseNeed(`need: ${JSON.stringify(rows)}`);
}

describe("parseNeed rejections", () => {
  it("rejects input that is not text with a need array", () => {
    expect(parseNeed(undefined)).toStrictEqual({ error: "no json need array", ok: false });
    expect(parseNeed(null)).toStrictEqual({ error: "no json need array", ok: false });
  });

  it("rejects json that does not parse", () => {
    expect(parseNeed("need: [{job: search}]")).toStrictEqual({ error: "invalid json", ok: false });
  });

  it("rejects a row that is not an object", () => {
    for (const row of [null, "search", 3, [1]])
      expect(need([row])).toStrictEqual({ error: "invalid job item", ok: false });
  });

  it("rejects an unknown job, a missing job and a missing query", () => {
    const bad = { error: "invalid job or query", ok: false };
    expect(need([{ job: "rm", query: "x" }])).toStrictEqual(bad);
    expect(need([{ query: "x" }])).toStrictEqual(bad);
    expect(need([{ job: "search" }])).toStrictEqual(bad);
    expect(need([{ job: "exec", query: "  " }])).toStrictEqual(bad);
    expect(need([{ job: "exec", query: { text: "x" } }])).toStrictEqual(bad);
  });

  it("rejects a slice with neither stash nor query", () => {
    expect(need([{ job: "slice", stash: "  " }])).toStrictEqual({ error: "invalid job or query", ok: false });
  });
});

describe("parseNeed fields", () => {
  it("trims job, query and stash", () => {
    expect(need([{ job: " exec ", query: " true ", stash: " s1 " }])).toStrictEqual({
      jobs: [{ job: "exec", query: "true", stash: "s1" }],
      ok: true,
    });
  });

  it("uses the query as the stash of a slice without one", () => {
    expect(need([{ job: "slice", query: "g7k" }])).toStrictEqual({
      jobs: [{ job: "slice", query: "g7k", stash: "g7k" }],
      ok: true,
    });
  });

  it("keeps a slice stash over its query", () => {
    expect(need([{ job: "slice", query: "q", stash: "s" }])).toStrictEqual({
      jobs: [{ job: "slice", query: "q", stash: "s" }],
      ok: true,
    });
  });
});

describe("parseNeed optional fields", () => {
  it("drops blank optional fields and an empty glob", () => {
    expect(need([{ cwd: "", from: " ", glob: "", job: "search", path: " ", query: "x", to: null }])).toStrictEqual({
      jobs: [{ job: "search", query: "x" }],
      ok: true,
    });
  });

  it("trims path, cwd, from and to and stringifies glob entries", () => {
    expect(
      need([{ cwd: " b ", from: " 1 ", glob: [1, "*.ts"], job: "search", path: " a ", query: "x", to: 2 }]),
    ).toStrictEqual({
      jobs: [{ cwd: "b", from: "1", glob: ["1", "*.ts"], job: "search", path: "a", query: "x", to: "2" }],
      ok: true,
    });
    expect(need([{ glob: [true, null], job: "search", query: "x" }])).toStrictEqual({
      jobs: [{ glob: ["true", ""], job: "search", query: "x" }],
      ok: true,
    });
  });
});
