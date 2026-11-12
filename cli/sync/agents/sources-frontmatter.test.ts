import { expect, it } from "vitest";

import { doc, loaded, problems, stock, tree } from "../__fixtures__/sources-kit.ts";
import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { loadSources } from "./load-sources.ts";

useTempDirs();

it("collects every problem across files, rules and hooks instead of stopping at the first", () => {
  const consumer = tree({
    ".repo/hooks.jsonc": "[]",
    ".repo/rules/Foo.md": doc("foo"),
    ".repo/rules/nofm.md": "no fence\n",
    ".repo/rules/x.md": doc("x", "overrides: nope\n"),
  });
  expect(problems({ consumerRoot: consumer, packages: [], stockRoot: stock() })).toStrictEqual([
    ".repo/rules/nofm.md: missing frontmatter (start the file with a --- block)",
    ".repo/rules/Foo.md: a stock rule has this name; add `overrides: Foo` or rename it",
    '.repo/rules/x.md: overrides "nope" but no stock rule has that name',
    ".repo/hooks.jsonc: invalid JSONC: expected an object",
  ]);
});

it("reports a broken stock file too", () => {
  expect(
    problems({ consumerRoot: null, packages: [], stockRoot: stock({ "agents/rules/broken.md": "no fence\n" }) }),
  ).toStrictEqual(["agents/rules/broken.md: missing frontmatter (start the file with a --- block)"]);
});

it("requires a description on a rule but not on a subagent", () => {
  const bare = "---\npaths: []\n---\nbody\n";
  const consumer = tree({ ".repo/rules/bare.md": bare, ".repo/subagents/bare.md": "---\nname: bare\n---\nbody\n" });
  expect(problems({ consumerRoot: consumer, packages: [], stockRoot: stock() })).toStrictEqual([
    ".repo/rules/bare.md: invalid frontmatter: description is required",
  ]);
});

it.each([
  ["a string", "paths: src/**\n"],
  ["a map", "paths:\n  a: b\n"],
  ["a list holding a non-string", "paths:\n  - 3\n"],
])("rejects paths that are %s", (_label, extra) => {
  const consumer = tree({ ".repo/rules/p.md": doc("p", extra) });
  expect(problems({ consumerRoot: consumer, packages: [], stockRoot: stock() })).toStrictEqual([
    ".repo/rules/p.md: invalid frontmatter: paths must be a list of strings",
  ]);
});

it("accepts paths as a list of strings", () => {
  const consumer = tree({ ".repo/rules/p.md": doc("p", "paths:\n  - src/**\n  - lib/**\n") });
  const sources = loaded({ consumerRoot: consumer, packages: [], stockRoot: stock() });
  expect(sources.rules.find((d) => d.file === "p.md")?.data["paths"]).toStrictEqual(["src/**", "lib/**"]);
});

it("does not parse a stock file the consumer replaces", () => {
  const sources = loaded({
    consumerRoot: tree({ ".repo/rules/BROKEN.md": doc("fixed", "overrides: broken\n") }),
    packages: [],
    stockRoot: stock({ "agents/rules/broken.md": "no fence\n" }),
  });
  expect(sources.rules[0]?.rel).toBe(".repo/rules/BROKEN.md");
});

function rule(extra = "", body = "body\n") {
  return `---\ndescription: d\n${extra}---\n${body}`;
}
function agent(extra = "", body = "body\n") {
  return `---\ndescription: d\n${extra}---\n${body}`;
}
function withConsumer(files: Record<string, string>) {
  return problems({ consumerRoot: tree(files), packages: [], stockRoot: stock() });
}

it("rejects a rule key outside description, paths and overrides, naming the keys to use", () => {
  expect(withConsumer({ ".repo/rules/x.md": rule("glob: src/**\n") })).toStrictEqual([
    '.repo/rules/x.md: unknown frontmatter key "glob"; use description, paths, overrides',
  ]);
});

it("rejects a name on a rule", () => {
  expect(withConsumer({ ".repo/rules/x.md": rule("name: x\n") })).toStrictEqual([
    '.repo/rules/x.md: unknown frontmatter key "name"; use description, paths, overrides',
  ]);
});

it("rejects an unknown subagent key and lists the known ones", () => {
  const [problem] = withConsumer({ ".repo/subagents/x.md": agent("colour: red\n") });
  const known = "name, description, targets, overrides, tier, exec, variants, antigravity-cli, claudecode, ";
  expect(problem).toMatch(new RegExp(`^\\.repo/subagents/x\\.md: unknown frontmatter key "colour"; use ${known}`));
  expect(problem).toContain("cursor");
});

it("accepts the subagent keys and every host block, nested too", () => {
  const extra = "name: x\ntargets: [claude]\ntier: deep\nexec: fast\nclaudecode:\n  model: opus\ncodexcli:\n  a: b\n";
  const consumer = tree({ ".repo/subagents/team/x.md": agent(extra) });
  expect(
    loaded({ consumerRoot: consumer, packages: [], stockRoot: stock() }).subagents.some((d) => d.file === "team/x.md"),
  ).toBe(true);
});

it("reports a missing description on a rule", () => {
  expect(withConsumer({ ".repo/rules/x.md": "---\npaths: []\n---\nbody\n" })).toStrictEqual([
    ".repo/rules/x.md: invalid frontmatter: description is required",
  ]);
});

it.each([
  ["rule", ".repo/rules/x.md"],
  ["subagent", ".repo/subagents/x.md"],
])("rejects an empty %s body", (_kind, rel) => {
  expect(withConsumer({ [rel]: rule("", "  \n") })).toStrictEqual([
    `${rel}: body is empty; write the instructions below the frontmatter`,
  ]);
});

it.each([
  ["rule", ".repo/rules/x.md"],
  ["subagent", ".repo/subagents/x.md"],
])("rejects a %s body over 8 KiB and accepts exactly 8 KiB", (_kind, rel) => {
  expect(withConsumer({ [rel]: rule("", `${"a".repeat(8193)}\n`) })).toStrictEqual([
    `${rel}: body is 8193 bytes, over the 8 KiB (8192 byte) limit; move detail into a skill or a reference`,
  ]);
  const ok = loaded({
    consumerRoot: tree({ [rel]: rule("", "a".repeat(8192)) }),
    packages: [],
    stockRoot: stock(),
  });
  expect(ok.rules.length + ok.subagents.length).toBeGreaterThan(0);
});

it(
  "returns the docs that loaded beside the problems, " +
    "leaving out a doc whose frontmatter failed and the hooks that did not parse",
  () => {
    const consumer = tree({
      ".repo/hooks.jsonc": "{ nope",
      ".repo/rules/bad.md": "---\ncolour: red\n---\nbody\n",
      ".repo/rules/good.md": doc("good"),
    });
    const result = loadSources({ consumerRoot: consumer, packages: [], stockRoot: stock() });
    expect(result.sources.rules.map((d) => d.file)).toStrictEqual(["foo.md", "overview.md", "good.md"]);
    expect(result.sources.hooks).toStrictEqual({ rel: ".repo/hooks.jsonc", value: {} });
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toMatch(/^\.repo\/rules\/bad\.md: unknown frontmatter key "colour"/);
    expect(result.problems[1]).toMatch(/^\.repo\/hooks\.jsonc: invalid JSONC/);
  },
);
