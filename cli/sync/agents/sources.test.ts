import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadSources } from "./sources.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
});

/** A temp root holding `files` (POSIX relative path → text). */
function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-sources-"));
  temps.push(root);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const doc = (name: string, extra = "") => `---\ndescription: ${name} desc\n${extra}---\n${name} body\n`;

type Roots = Parameters<typeof loadSources>[0];

/** The docs that loaded; any problem fails the test, so a case about sources cannot pass on a half load. */
function loaded(roots: Roots) {
  const result = loadSources(roots);
  expect(result.problems).toStrictEqual([]);
  return result.sources;
}

function problems(roots: Roots): string[] {
  const result = loadSources(roots);
  expect(result.problems).not.toStrictEqual([]);
  return result.problems;
}
const HOOKS = '{\n  // stock\n  "version": 1, "hooks": {}\n}\n';

function stock(extra: Record<string, string> = {}): string {
  return tree({
    "agents/hooks.jsonc": HOOKS,
    "agents/rules/foo.md": doc("foo"),
    "agents/rules/overview.md": doc("overview"),
    "agents/subagents/scout.md": doc("scout"),
    "agents/subagents/worker.md": doc("worker"),
    ...extra,
  });
}

describe("loadSources", () => {
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
    expect(sources.rules[0]!.rel).toBe(".repo/rules/BROKEN.md");
  });

  describe("frontmatter keys and body size", () => {
    const rule = (extra = "", body = "body\n") => `---\ndescription: d\n${extra}---\n${body}`;
    const agent = (extra = "", body = "body\n") => `---\ndescription: d\n${extra}---\n${body}`;
    const withConsumer = (files: Record<string, string>) =>
      problems({ consumerRoot: tree(files), packages: [], stockRoot: stock() });

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
      expect(problem).toMatch(
        /^\.repo\/subagents\/x\.md: unknown frontmatter key "colour"; use name, description, targets, overrides, tier, exec, antigravity-cli, claudecode, /,
      );
      expect(problem).toContain("cursor");
    });

    it("accepts the subagent keys and every host block, nested too", () => {
      const extra =
        "name: x\ntargets: [claude]\ntier: deep\nexec: fast\nclaudecode:\n  model: opus\ncodexcli:\n  a: b\n";
      const consumer = tree({ ".repo/subagents/team/x.md": agent(extra) });
      expect(
        loaded({ consumerRoot: consumer, packages: [], stockRoot: stock() }).subagents.some(
          (d) => d.file === "team/x.md",
        ),
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
  });

  describe("a load with problems", () => {
    it("returns the docs that loaded beside the problems, leaving out a doc whose frontmatter failed and the hooks that did not parse", () => {
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
    });
  });
});

describe("package sources", () => {
  const packageTree = () =>
    tree({
      ".repo/rules/root.md": doc("root"),
      "packages/api/.repo/rules/core.md": doc("core"),
      "packages/web/.repo/rules/api.md": doc("api", "paths:\n  - src/**\n"),
      "packages/web/.repo/rules/ui/button.md": doc("button"),
      "packages/web/.repo/subagents/x.md": doc("x"),
    });

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
});
