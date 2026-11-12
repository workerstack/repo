import { expect, it } from "vitest";

import { doc, loaded, problems, stock, tree } from "../__fixtures__/sources-kit.ts";
import { useTempDirs } from "../__fixtures__/temp-dirs.ts";

useTempDirs();

it("reads stock alone when there is no consumer", () => {
  const sources = loaded({ consumerRoot: null, packages: [], stockRoot: stock() });
  expect(sources.rules.map((d) => [d.rel, d.file, d.data, d.body])).toStrictEqual([
    ["agents/rules/foo.md", "foo.md", { description: "foo desc" }, "foo body"],
    ["agents/rules/overview.md", "overview.md", { description: "overview desc" }, "overview body"],
  ]);
  expect(sources.subagents.map((d) => d.rel)).toStrictEqual([
    "agents/subagents/scout.md",
    "agents/subagents/worker.md",
  ]);
  expect(sources.hooks).toStrictEqual({ rel: "agents/hooks.jsonc", value: { hooks: {}, version: 1 } });
});

it("replaces a stock file in place when it says overrides, case-folded, and appends new files sorted", () => {
  const consumer = tree({
    ".repo/rules/Foo.md": doc("consumer-foo", "overrides: foo\n"),
    ".repo/rules/alpha.md": doc("alpha"),
    ".repo/rules/zeta.md": doc("zeta"),
    ".repo/subagents/scout.md": doc("consumer-scout", "overrides: scout\n"),
  });

  const sources = loaded({ consumerRoot: consumer, packages: [], stockRoot: stock() });
  expect(sources.rules.map((d) => [d.rel, d.file, d.body])).toStrictEqual([
    [".repo/rules/Foo.md", "Foo.md", "consumer-foo body"],
    ["agents/rules/overview.md", "overview.md", "overview body"],
    [".repo/rules/alpha.md", "alpha.md", "alpha body"],
    [".repo/rules/zeta.md", "zeta.md", "zeta body"],
  ]);
  expect(sources.subagents.map((d) => [d.rel, d.body])).toStrictEqual([
    [".repo/subagents/scout.md", "consumer-scout body"],
    ["agents/subagents/worker.md", "worker body"],
  ]);
});

it("fails a same-name rule or subagent that does not say overrides", () => {
  const consumer = tree({
    ".repo/rules/Foo.md": doc("a"),
    ".repo/rules/fresh.md": doc("fresh"),
    ".repo/subagents/worker.md": doc("b"),
  });

  expect(problems({ consumerRoot: consumer, packages: [], stockRoot: stock() })).toStrictEqual([
    ".repo/rules/Foo.md: a stock rule has this name; add `overrides: Foo` or rename it",
    ".repo/subagents/worker.md: a stock subagent has this name; add `overrides: worker` or rename it",
  ]);
});

it("names the nested path in the same-name error", () => {
  const roots = {
    consumerRoot: tree({ ".repo/rules/a/b.md": doc("x") }),
    packages: [],
    stockRoot: stock({ "agents/rules/a/b.md": doc("ab") }),
  };

  expect(problems(roots)).toStrictEqual([
    ".repo/rules/a/b.md: a stock rule has this name; add `overrides: a/b` or rename it",
  ]);
});

it("fails an overrides that names nothing", () => {
  const consumer = tree({
    ".repo/rules/x.md": doc("x", "overrides: nope\n"),
    ".repo/subagents/y.md": doc("y", "overrides: nada\n"),
  });

  expect(problems({ consumerRoot: consumer, packages: [], stockRoot: stock() })).toStrictEqual([
    '.repo/rules/x.md: overrides "nope" but no stock rule has that name',
    '.repo/subagents/y.md: overrides "nada" but no stock subagent has that name',
  ]);
});

it("fails an overrides that is not a string", () => {
  const consumer = tree({ ".repo/rules/x.md": doc("x", "overrides: [a]\n") });
  expect(problems({ consumerRoot: consumer, packages: [], stockRoot: stock() })).toStrictEqual([
    ".repo/rules/x.md: invalid frontmatter: overrides must be a string",
  ]);
});

it("keeps nested paths POSIX and sorts them as plain strings", () => {
  const sources = loaded({
    consumerRoot: tree({ ".repo/subagents/team/lead.md": doc("lead") }),
    packages: [],
    stockRoot: stock({ "agents/rules/a.md": doc("a"), "agents/rules/a/b.md": doc("ab") }),
  });

  expect(sources.rules.map((d) => d.file)).toStrictEqual(["a.md", "a/b.md", "foo.md", "overview.md"]);
  expect(sources.subagents.at(-1)).toMatchObject({ file: "team/lead.md", rel: ".repo/subagents/team/lead.md" });

  for (const d of [...sources.rules, ...sources.subagents]) expect(d.rel).not.toContain("\\");
});

it("skips non-markdown files and dot entries", () => {
  const sources = loaded({
    consumerRoot: tree({ ".repo/rules/.hidden.md": "no frontmatter" }),
    packages: [],
    stockRoot: stock({ "agents/rules/.curated/c.md": doc("c"), "agents/rules/notes.txt": "x" }),
  });

  expect(sources.rules.map((d) => d.file)).toStrictEqual(["foo.md", "overview.md"]);
});

it("takes .repo/hooks.jsonc whole over the stock one", () => {
  const consumer = tree({ ".repo/hooks.jsonc": '{ "hooks": { "Stop": [] } /* consumer */ }' });
  expect(loaded({ consumerRoot: consumer, packages: [], stockRoot: stock() }).hooks).toStrictEqual({
    rel: ".repo/hooks.jsonc",
    value: { hooks: { Stop: [] } },
  });
});

it("uses the stock hooks when the consumer has none", () => {
  expect(loaded({ consumerRoot: tree({}), packages: [], stockRoot: stock() }).hooks.rel).toBe("agents/hooks.jsonc");
});

it.each([
  ["broken JSONC", '{ "hooks": ', /^\.repo\/hooks\.jsonc: invalid JSONC: /],
  ["trailing commas, which are unsupported", '{ "hooks": {}, }', /^\.repo\/hooks\.jsonc: invalid JSONC: /],
  ["a non-object", "[]", /^\.repo\/hooks\.jsonc: invalid JSONC: expected an object$/],
])("rejects %s in hooks", (_label, text, message) => {
  const consumer = tree({ ".repo/hooks.jsonc": text });
  const [first, ...rest] = problems({ consumerRoot: consumer, packages: [], stockRoot: stock() });
  expect(first).toMatch(message);
  expect(rest).toStrictEqual([]);
});

it("names the consumer file in a frontmatter error", () => {
  const consumer = tree({ ".repo/rules/nofm.md": "no fence\n" });
  expect(problems({ consumerRoot: consumer, packages: [], stockRoot: stock() })).toStrictEqual([
    ".repo/rules/nofm.md: missing frontmatter (start the file with a --- block)",
  ]);
});
