import { describe, expect, it } from "vitest";
import { parseNeed } from "./parse-need.mjs";

describe("parseNeed", () => {
  it("parses one job", () => {
    expect(parseNeed('need: [{"job":"search","query":"DEFAULT_GREP_HEAD_LIMIT"}]')).toEqual({
      ok: true,
      jobs: [{ job: "search", query: "DEFAULT_GREP_HEAD_LIMIT" }],
    });
  });

  it("parses many jobs", () => {
    const text =
      'need: [{"job":"search","query":"foo"},{"job":"exec","query":"true"},{"job":"web","query":"https://example.com"},{"job":"test","query":"npm test"}]';
    expect(parseNeed(text)).toEqual({
      ok: true,
      jobs: [
        { job: "search", query: "foo" },
        { job: "exec", query: "true" },
        { job: "web", query: "https://example.com" },
        { job: "test", query: "npm test" },
      ],
    });
  });

  it("keeps optional path glob cwd", () => {
    expect(
      parseNeed(
        'need: [{"job":"search","query":"foo","path":"src","glob":"*.ts","cwd":"."}]',
      ),
    ).toEqual({
      ok: true,
      jobs: [{ job: "search", query: "foo", path: "src", glob: ["*.ts"], cwd: "." }],
    });
    expect(
      parseNeed(
        'need: [{"job":"search","query":"bar","glob":["*.md","*.txt"],"path":"docs"}]',
      ),
    ).toEqual({
      ok: true,
      jobs: [
        { job: "search", query: "bar", path: "docs", glob: ["*.md", "*.txt"] },
      ],
    });
  });

  it("parses slice with stash and optional from to path", () => {
    expect(
      parseNeed(
        'need: [{"job":"slice","stash":"g7k","path":"AgentChatInterface","from":180,"to":200}]',
      ),
    ).toEqual({
      ok: true,
      jobs: [
        {
          job: "slice",
          query: "",
          stash: "g7k",
          path: "AgentChatInterface",
          from: "180",
          to: "200",
        },
      ],
    });
  });

  it("rejects markdown prose and old need grammar", () => {
    expect(parseNeed("need: grunt job: search query: foo").ok).toBe(false);
    expect(
      parseNeed(
        "I still need a dump:\n\n```\nneed: grunt job: search query: foo\n```\n",
      ).ok,
    ).toBe(false);
    expect(parseNeed("please search for foo").ok).toBe(false);
    expect(parseNeed("need: []").ok).toBe(false);
  });
});
