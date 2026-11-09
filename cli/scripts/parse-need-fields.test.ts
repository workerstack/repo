import { describe, expect, it } from "vitest";
import { parseNeed } from "./parse-need.ts";

const need = (rows: unknown) => parseNeed(`need: ${JSON.stringify(rows)}`);

describe("parseNeed rejections", () => {
  it("rejects input that is not text with a need array", () => {
    expect(parseNeed(undefined)).toEqual({ ok: false, error: "no json need array" });
    expect(parseNeed(null)).toEqual({ ok: false, error: "no json need array" });
  });

  it("rejects json that does not parse", () => {
    expect(parseNeed("need: [{job: search}]")).toEqual({ ok: false, error: "invalid json" });
  });

  it("rejects a row that is not an object", () => {
    for (const row of [null, "search", 3, [1]]) {
      expect(need([row])).toEqual({ ok: false, error: "invalid job item" });
    }
  });

  it("rejects an unknown job, a missing job and a missing query", () => {
    const bad = { ok: false, error: "invalid job or query" };
    expect(need([{ job: "rm", query: "x" }])).toEqual(bad);
    expect(need([{ query: "x" }])).toEqual(bad);
    expect(need([{ job: "search" }])).toEqual(bad);
    expect(need([{ job: "exec", query: "  " }])).toEqual(bad);
  });

  it("rejects a slice with neither stash nor query", () => {
    expect(need([{ job: "slice", stash: "  " }])).toEqual({ ok: false, error: "invalid job or query" });
  });
});

describe("parseNeed fields", () => {
  it("trims job, query and stash", () => {
    expect(need([{ job: " exec ", query: " true ", stash: " s1 " }])).toEqual({
      ok: true,
      jobs: [{ job: "exec", query: "true", stash: "s1" }],
    });
  });

  it("uses the query as the stash of a slice without one", () => {
    expect(need([{ job: "slice", query: "g7k" }])).toEqual({
      ok: true,
      jobs: [{ job: "slice", query: "g7k", stash: "g7k" }],
    });
  });

  it("keeps a slice stash over its query", () => {
    expect(need([{ job: "slice", query: "q", stash: "s" }])).toEqual({
      ok: true,
      jobs: [{ job: "slice", query: "q", stash: "s" }],
    });
  });
});

describe("parseNeed optional fields", () => {
  it("drops blank optional fields and an empty glob", () => {
    expect(need([{ job: "search", query: "x", path: " ", cwd: "", glob: "", from: " ", to: null }])).toEqual({
      ok: true,
      jobs: [{ job: "search", query: "x" }],
    });
  });

  it("trims path, cwd, from and to and stringifies glob entries", () => {
    expect(
      need([{ job: "search", query: "x", path: " a ", cwd: " b ", from: " 1 ", to: 2, glob: [1, "*.ts"] }]),
    ).toEqual({
      ok: true,
      jobs: [{ job: "search", query: "x", path: "a", cwd: "b", from: "1", to: "2", glob: ["1", "*.ts"] }],
    });
  });
});
