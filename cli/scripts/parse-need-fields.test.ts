import { describe, expect, it } from "vitest";
import { parseNeed } from "./parse-need.ts";

const need = (rows: unknown) => parseNeed(`need: ${JSON.stringify(rows)}`);

describe("parseNeed rejections", () => {
  it("rejects input that is not text with a need array", () => {
    expect(parseNeed(undefined)).toStrictEqual({ ok: false, error: "no json need array" });
    expect(parseNeed(null)).toStrictEqual({ ok: false, error: "no json need array" });
  });

  it("rejects json that does not parse", () => {
    expect(parseNeed("need: [{job: search}]")).toStrictEqual({ ok: false, error: "invalid json" });
  });

  it("rejects a row that is not an object", () => {
    for (const row of [null, "search", 3, [1]]) {
      expect(need([row])).toStrictEqual({ ok: false, error: "invalid job item" });
    }
  });

  it("rejects an unknown job, a missing job and a missing query", () => {
    const bad = { ok: false, error: "invalid job or query" };
    expect(need([{ job: "rm", query: "x" }])).toStrictEqual(bad);
    expect(need([{ query: "x" }])).toStrictEqual(bad);
    expect(need([{ job: "search" }])).toStrictEqual(bad);
    expect(need([{ job: "exec", query: "  " }])).toStrictEqual(bad);
  });

  it("rejects a slice with neither stash nor query", () => {
    expect(need([{ job: "slice", stash: "  " }])).toStrictEqual({ ok: false, error: "invalid job or query" });
  });
});

describe("parseNeed fields", () => {
  it("trims job, query and stash", () => {
    expect(need([{ job: " exec ", query: " true ", stash: " s1 " }])).toStrictEqual({
      ok: true,
      jobs: [{ job: "exec", query: "true", stash: "s1" }],
    });
  });

  it("uses the query as the stash of a slice without one", () => {
    expect(need([{ job: "slice", query: "g7k" }])).toStrictEqual({
      ok: true,
      jobs: [{ job: "slice", query: "g7k", stash: "g7k" }],
    });
  });

  it("keeps a slice stash over its query", () => {
    expect(need([{ job: "slice", query: "q", stash: "s" }])).toStrictEqual({
      ok: true,
      jobs: [{ job: "slice", query: "q", stash: "s" }],
    });
  });
});

describe("parseNeed optional fields", () => {
  it("drops blank optional fields and an empty glob", () => {
    expect(need([{ job: "search", query: "x", path: " ", cwd: "", glob: "", from: " ", to: null }])).toStrictEqual({
      ok: true,
      jobs: [{ job: "search", query: "x" }],
    });
  });

  it("trims path, cwd, from and to and stringifies glob entries", () => {
    expect(
      need([{ job: "search", query: "x", path: " a ", cwd: " b ", from: " 1 ", to: 2, glob: [1, "*.ts"] }]),
    ).toStrictEqual({
      ok: true,
      jobs: [{ job: "search", query: "x", path: "a", cwd: "b", from: "1", to: "2", glob: ["1", "*.ts"] }],
    });
  });
});
