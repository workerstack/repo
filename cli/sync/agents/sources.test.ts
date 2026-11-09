import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSources } from "./sources.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
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

const doc = (name: string) => `---\nname: ${name}\n---\n${name} body\n`;
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
    const sources = loadSources({ stockRoot: stock(), consumerRoot: null });
    expect(sources.rules.map((d) => [d.rel, d.file, d.data, d.body])).toEqual([
      ["agents/rules/foo.md", "foo.md", { name: "foo" }, "foo body"],
      ["agents/rules/overview.md", "overview.md", { name: "overview" }, "overview body"],
    ]);
    expect(sources.subagents.map((d) => d.rel)).toEqual(["agents/subagents/scout.md", "agents/subagents/worker.md"]);
    expect(sources.hooks).toEqual({ rel: "agents/hooks.jsonc", value: { version: 1, hooks: {} } });
  });

  it("replaces a stock file in place, case-folded, and appends new files sorted", () => {
    const consumer = tree({
      ".repo/rules/zeta.md": doc("zeta"),
      ".repo/rules/Foo.md": doc("consumer-foo"),
      ".repo/rules/alpha.md": doc("alpha"),
      ".repo/subagents/scout.md": doc("consumer-scout"),
    });
    const sources = loadSources({ stockRoot: stock(), consumerRoot: consumer });
    expect(sources.rules.map((d) => [d.rel, d.file, d.body])).toEqual([
      [".repo/rules/Foo.md", "Foo.md", "consumer-foo body"],
      ["agents/rules/overview.md", "overview.md", "overview body"],
      [".repo/rules/alpha.md", "alpha.md", "alpha body"],
      [".repo/rules/zeta.md", "zeta.md", "zeta body"],
    ]);
    expect(sources.subagents.map((d) => [d.rel, d.body])).toEqual([
      [".repo/subagents/scout.md", "consumer-scout body"],
      ["agents/subagents/worker.md", "worker body"],
    ]);
  });

  it("keeps nested paths POSIX and sorts them as plain strings", () => {
    const sources = loadSources({
      stockRoot: stock({ "agents/rules/a/b.md": doc("ab"), "agents/rules/a.md": doc("a") }),
      consumerRoot: tree({ ".repo/subagents/team/lead.md": doc("lead") }),
    });
    expect(sources.rules.map((d) => d.file)).toEqual(["a.md", "a/b.md", "foo.md", "overview.md"]);
    expect(sources.subagents.at(-1)).toMatchObject({ rel: ".repo/subagents/team/lead.md", file: "team/lead.md" });
    for (const d of [...sources.rules, ...sources.subagents]) expect(d.rel).not.toContain("\\");
  });

  it("skips non-markdown files and dot entries", () => {
    const sources = loadSources({
      stockRoot: stock({ "agents/rules/notes.txt": "x", "agents/rules/.curated/c.md": doc("c") }),
      consumerRoot: tree({ ".repo/rules/.hidden.md": "no frontmatter" }),
    });
    expect(sources.rules.map((d) => d.file)).toEqual(["foo.md", "overview.md"]);
  });

  it("takes .repo/hooks.jsonc whole over the stock one", () => {
    const consumer = tree({ ".repo/hooks.jsonc": '{ "hooks": { "Stop": [] } /* consumer */ }' });
    expect(loadSources({ stockRoot: stock(), consumerRoot: consumer }).hooks).toEqual({
      rel: ".repo/hooks.jsonc",
      value: { hooks: { Stop: [] } },
    });
  });

  it("uses the stock hooks when the consumer has none", () => {
    expect(loadSources({ stockRoot: stock(), consumerRoot: tree({}) }).hooks.rel).toBe("agents/hooks.jsonc");
  });

  it.each([
    ["broken JSONC", '{ "hooks": ', /^\.repo\/hooks\.jsonc: invalid JSONC: /],
    ["trailing commas, which are unsupported", '{ "hooks": {}, }', /^\.repo\/hooks\.jsonc: invalid JSONC: /],
    ["a non-object", "[]", /^\.repo\/hooks\.jsonc: invalid JSONC: expected an object$/],
  ])("rejects %s in hooks", (_label, text, message) => {
    const consumer = tree({ ".repo/hooks.jsonc": text });
    expect(() => loadSources({ stockRoot: stock(), consumerRoot: consumer })).toThrow(message);
  });

  it("names the consumer file in a frontmatter error", () => {
    const consumer = tree({ ".repo/rules/nofm.md": "no fence\n" });
    expect(() => loadSources({ stockRoot: stock(), consumerRoot: consumer })).toThrow(
      new Error(".repo/rules/nofm.md: missing frontmatter (start the file with a --- block)"),
    );
  });

  it("does not parse a stock file the consumer replaces", () => {
    const sources = loadSources({
      stockRoot: stock({ "agents/rules/broken.md": "no fence\n" }),
      consumerRoot: tree({ ".repo/rules/BROKEN.md": doc("fixed") }),
    });
    expect(sources.rules[0]!.rel).toBe(".repo/rules/BROKEN.md");
  });
});
