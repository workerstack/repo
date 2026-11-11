import { expect, it } from "vitest";

import { doc, loaded, problems, stock, tree } from "../__fixtures__/sources-kit.ts";
import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { loadSources } from "./load-sources.ts";

useTempDirs();

function packageTree() {
  return tree({
    ".repo/rules/root.md": doc("root"),
    "packages/api/.repo/rules/core.md": doc("core"),
    "packages/web/.repo/rules/api.md": doc("api", "paths:\n  - src/**\n"),
    "packages/web/.repo/rules/ui/button.md": doc("button"),
    "packages/web/.repo/subagents/x.md": doc("x"),
  });
}

it("gives every doc an origin and a scope: stock and root are scope empty, a package rule carries its dir", () => {
  const consumer = packageTree();
  const sources = loaded({ consumerRoot: consumer, packages: ["packages/web", "packages/api"], stockRoot: stock() });
  expect(sources.rules.map((d) => [d.rel, d.file, d.origin, d.scope])).toStrictEqual([
    ["agents/rules/foo.md", "foo.md", "stock", ""],
    ["agents/rules/overview.md", "overview.md", "stock", ""],
    [".repo/rules/root.md", "root.md", "repo", ""],
    ["packages/web/.repo/rules/api.md", "api.md", "repo", "packages/web"],
    ["packages/web/.repo/rules/ui/button.md", "ui/button.md", "repo", "packages/web"],
    ["packages/api/.repo/rules/core.md", "core.md", "repo", "packages/api"],
  ]);
  expect(sources.subagents.map((d) => [d.origin, d.scope])).toStrictEqual([
    ["stock", ""],
    ["stock", ""],
  ]);
});

it("never merges a package rule with a root or stock rule of the same name", () => {
  const consumer = tree({ "packages/web/.repo/rules/foo.md": doc("pkg-foo") });
  const sources = loaded({ consumerRoot: consumer, packages: ["packages/web"], stockRoot: stock() });
  expect(sources.rules.map((d) => [d.rel, d.body])).toStrictEqual([
    ["agents/rules/foo.md", "foo body"],
    ["agents/rules/overview.md", "overview body"],
    ["packages/web/.repo/rules/foo.md", "pkg-foo body"],
  ]);
});

it("reads packages from the stock root when there is no consumer root", () => {
  const root = stock({ "packages/web/.repo/rules/p.md": doc("p") });
  const sources = loaded({ consumerRoot: null, packages: ["packages/web"], stockRoot: root });
  expect(sources.rules.map((d) => d.scope)).toStrictEqual(["", "", "packages/web"]);
});

it("refuses overrides in a package rule and leaves that rule out", () => {
  const consumer = tree({
    "packages/web/.repo/rules/y.md": doc("y", "overrides: foo\n"),
    "packages/web/.repo/rules/z.md": doc("z"),
  });
  const result = loadSources({ consumerRoot: consumer, packages: ["packages/web"], stockRoot: stock() });
  expect(result.problems).toStrictEqual([
    "packages/web/.repo/rules/y.md: overrides has no meaning in a package rule; remove it",
  ]);
  expect(result.sources.rules.map((d) => d.file)).toStrictEqual(["foo.md", "overview.md", "z.md"]);
});

it("reports a package rule with bad frontmatter", () => {
  const consumer = tree({ "packages/web/.repo/rules/bad.md": "no fence\n" });
  expect(problems({ consumerRoot: consumer, packages: ["packages/web"], stockRoot: stock() })).toStrictEqual([
    "packages/web/.repo/rules/bad.md: missing frontmatter (start the file with a --- block)",
  ]);
});
