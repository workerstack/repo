import { expect, it } from "vitest";

import type { Doc } from "./agents/sources.types.ts";
import { check, repo, rule } from "./fixtures/repo-dir-kit.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();

it("resolves from the repo root, not from the rules folder", () => {
  const root = repo({ ".repo/rules/b.md": "x", "references/a.md": "x" });
  expect(check(root, [rule("r", "[a](references/a.md) and [a](./references/a.md#sec)")])).toStrictEqual([]);
  expect(check(root, [rule("r", "[b](b.md)")])).toStrictEqual([".repo/rules/r.md: link b.md does not exist"]);
});

it("flags a dead link", () => {
  expect(check(repo(), [rule("r", "[gone](references/gone.md)")])).toStrictEqual([
    ".repo/rules/r.md: link references/gone.md does not exist",
  ]);
});

it("skips external links, anchors, absolute paths and code", () => {
  const body = [
    "[a](https://example.com/x) [b](http://example.com) [c](mailto:me@example.com) [d](#top) [e](/abs/path)",
    "`[f](nope.md)`",
    "```",
    "[g](nope.md)",
    "```",
  ].join("\n");
  expect(check(repo(), [rule("r", body)])).toStrictEqual([]);
});

it("does not check a stock rule", () => {
  const stock: Doc = {
    body: "[x](nope.md)",
    data: { description: "d" },
    file: "s.md",
    origin: "stock",
    rel: "agents/rules/s.md",
    scope: "",
  };
  expect(check(repo(), [stock])).toStrictEqual([]);
});
