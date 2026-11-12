import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { HOSTS } from "../../config.ts";
import { loaded, problems, tree } from "../__fixtures__/sources-kit.ts";
import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { byCodeUnit } from "../by-code-unit.ts";
import { loadSources } from "./load-sources.ts";
import { renderSubagents } from "./subagents.ts";
import { isVariantList } from "./variants.ts";

useTempDirs();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const GOLDEN = path.join(ROOT, "cli/sync/__fixtures__/golden");
const HOOKS = '{ "version": 1, "hooks": {} }\n';
/** A rendered implementer-deep or implementer-fast file of any host. */
const IMPLEMENTER_FILE = /\/implementer-(?:deep|fast)\./;

/** The implementer-deep and implementer-fast files every host got before `variants:`, by rendered path. */
function goldens(): Map<string, string> {
  const files = fs.readdirSync(GOLDEN, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  const rels = files.map((entry) => path.relative(GOLDEN, path.join(entry.parentPath, entry.name)).split(path.sep));
  const implementers = rels.filter((parts) => IMPLEMENTER_FILE.test(parts.join("/")));
  return new Map(implementers.map((parts) => [parts.join("/"), fs.readFileSync(path.join(GOLDEN, ...parts), "utf8")]));
}

/** A stock root whose only subagent is this repo's `implementer.md`, carrying both variants. */
function variantsStock(): string {
  return tree({
    "agents/hooks.jsonc": HOOKS,
    "agents/subagents/implementer.md": fs.readFileSync(path.join(ROOT, "agents/subagents/implementer.md"), "utf8"),
  });
}

function implementerFiles(out: Map<string, string>): Map<string, string> {
  return new Map([...out].filter(([rel]) => IMPLEMENTER_FILE.test(rel)));
}

it("renders this repo's implementer pair equal to the goldens for every host", () => {
  const out = renderSubagents(loaded({ consumerRoot: null, packages: [], stockRoot: ROOT }), HOSTS);
  expect(implementerFiles(out)).toStrictEqual(goldens());
});

it("renders one source with two variants as two agents equal to the goldens", () => {
  const out = renderSubagents(loaded({ consumerRoot: null, packages: [], stockRoot: variantsStock() }), HOSTS);
  const expected = goldens();
  expect([...out.keys()].toSorted(byCodeUnit)).toStrictEqual([...expected.keys()].toSorted(byCodeUnit));
  for (const [rel, text] of expected) expect(out.get(rel), rel).toBe(text);
});

it("lets a consumer implementer-fast replace the stock variant of that name", () => {
  const consumer = tree({
    ".repo/subagents/implementer-fast.md":
      "---\nname: implementer-fast\ndescription: mine\noverrides: implementer-fast\n---\nconsumer body\n",
  });
  const out = renderSubagents(loaded({ consumerRoot: consumer, packages: [], stockRoot: variantsStock() }), ["claude"]);
  expect(out).toStrictEqual(
    new Map([
      [".claude/agents/implementer-deep.md", goldens().get(".claude/agents/implementer-deep.md")],
      [".claude/agents/implementer-fast.md", "---\nname: implementer-fast\ndescription: mine\n---\nconsumer body\n"],
    ]),
  );
});

it.each([
  ["an entry without a name", "variants:\n  - description: no name\n"],
  ["an entry with an empty name", "variants:\n  - name: ' '\n"],
  ["a scalar entry", "variants:\n  - implementer-deep\n"],
  ["a map, not a list", "variants:\n  name: implementer-deep\n"],
])("reports variants holding %s and loads nothing from that file", (_label, variants) => {
  const stockRoot = tree({ "agents/hooks.jsonc": HOOKS, "agents/subagents/x.md": `---\n${variants}---\nbody\n` });
  expect(loadSources({ consumerRoot: null, packages: [], stockRoot })).toStrictEqual({
    problems: ["agents/subagents/x.md: invalid frontmatter: variants must be a list of mappings, each with a name"],
    sources: { hooks: { rel: "agents/hooks.jsonc", value: { hooks: {}, version: 1 } }, rules: [], subagents: [] },
  });
});

it("names each variant's file after it beside the source, keeping the source's rel", () => {
  const stockRoot = tree({
    "agents/hooks.jsonc": HOOKS,
    "agents/subagents/team/x.md": "---\nvariants:\n  - name: a\n  - name: b\n    tier: deep\ntier: base\n---\nbody\n",
  });
  const { subagents } = loaded({ consumerRoot: null, packages: [], stockRoot });
  expect(subagents.map(({ file, rel, data }) => ({ data, file, rel }))).toStrictEqual([
    { data: { name: "a", tier: "base" }, file: "team/a.md", rel: "agents/subagents/team/x.md" },
    { data: { name: "b", tier: "deep" }, file: "team/b.md", rel: "agents/subagents/team/x.md" },
  ]);
});

it("reports a variant's unknown key against the source file", () => {
  const stockRoot = tree({
    "agents/hooks.jsonc": HOOKS,
    "agents/subagents/x.md": "---\nvariants:\n  - name: a\n    colour: red\n---\nbody\n",
  });
  const [problem] = problems({ consumerRoot: null, packages: [], stockRoot });
  expect(problem).toMatch(/^agents\/subagents\/x\.md: unknown frontmatter key "colour"; /);
  expect(problem).toContain("use name, description, targets, overrides, tier, exec, variants, ");
});

it.each([
  ["a name that climbs out of its folder", [{ name: "../x" }]],
  ["a name holding a slash", [{ name: "a/b" }]],
  ["a list holding null", [null]],
])("refuses variants holding %s", (_label, variants) => {
  expect(isVariantList(variants)).toBe(false);
});

it("accepts variants each naming a file", () => {
  expect(isVariantList([{ name: "implementer-deep" }, { name: "a.b_c" }])).toBe(true);
});
