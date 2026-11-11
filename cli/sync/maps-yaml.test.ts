import { expect, it } from "vitest";

import { selfWs } from "./fixtures/maps-kit.ts";
import { put, useTempDirs } from "./fixtures/temp-dirs.ts";
import { mapSections } from "./maps.ts";

useTempDirs();

const rowOf = (ws: string, name: string) =>
  mapSections(ws)
    .skills.split("\n")
    .find((line) => line.startsWith(`| ${name} |`));

/** A skill frontmatter with every scalar form the small YAML reader meets. */
const EVERY_FORM = [
  "---",
  "name: yaml",
  "# a comment",
  "",
  "description: a | b",
  "tags: [x, 'y', \"z\"]",
  "block:",
  "  inner: value",
  "  list:",
  "    - one",
  "  deeper:",
  "    k: v",
  "  tilted: 1",
  "    over: 2",
  "other: |",
  "  literal text",
  "emptyflow: []",
  "bare:",
  "not a key line",
  "---",
  "",
].join("\n");

it("skips a map.task that is an object or a list and keeps a string", () => {
  const ws = selfWs("maps-task-");
  put(ws, "agents/skills/obj/SKILL.md", "---\nname: obj\nmap:\n  task:\n    nested: yes\n---\n");
  put(ws, "agents/skills/arr/SKILL.md", "---\nname: arr\nmap:\n  task:\n    - a\n    - b\n---\n");
  put(ws, "agents/skills/str/SKILL.md", "---\nname: str\nmap:\n  task: keep-me\n---\n");
  const { skills } = mapSections(ws);
  expect(skills).toMatch(/\| str \| local \|  \| keep-me \|/);
  expect(skills).not.toMatch(/\[object Object\]|nested/);
  expect(rowOf(ws, "obj")).toBe("| obj | local |  |  |  |  |");
  expect(rowOf(ws, "arr")).toBe("| arr | local |  |  |  |  |");
});

it("reads dotted map keys, map.refs lists and strings, and commandPath", () => {
  const ws = selfWs("maps-keys-");
  put(
    ws,
    "agents/skills/dotted/SKILL.md",
    "---\nname: dotted\nmap.task: do it\nmap.refs:\n  - a.md\n  - b.md\ncommandPath: bun repo x\n---\n",
  );
  put(ws, "agents/skills/dotstr/SKILL.md", "---\nname: dotstr\nmap.refs: one.md\n---\n");
  put(ws, "agents/skills/nested/SKILL.md", "---\nname: nested\nmap:\n  refs:\n    - c.md\n---\n");
  put(ws, "agents/skills/nestedstr/SKILL.md", "---\nname: nestedstr\nmap:\n  refs: two.md\n---\n");
  expect(rowOf(ws, "dotted")).toBe("| dotted | local |  | do it | bun repo x | a.md, b.md |");
  expect(rowOf(ws, "dotstr")).toBe("| dotstr | local |  |  |  | one.md |");
  expect(rowOf(ws, "nested")).toBe("| nested | local |  |  |  | c.md |");
  expect(rowOf(ws, "nestedstr")).toBe("| nestedstr | local |  |  |  | two.md |");
});

it("falls back to the dir name and the first body line, and reads quoted and folded values", () => {
  const ws = selfWs("maps-fallback-");
  put(ws, "agents/skills/plain/SKILL.md", "# Plain\n\n## Sub\n<!-- note -->\n---\nThe summary line.\n");
  put(ws, "agents/skills/fenced/SKILL.md", "# Fenced\n\n```\n");
  put(ws, "agents/skills/noname/SKILL.md", "---\ndescription: from frontmatter\n---\n");
  put(
    ws,
    "agents/skills/folded/SKILL.md",
    "---\nname: 'it''s'\ndescription: >\n  one\n\n  two\ncommandPath: \"a b\"\n---\n",
  );
  put(ws, "agents/skills/badquote/SKILL.md", '---\nname: "a\\qb"\ndescription: # comment\n---\n');
  put(ws, "agents/skills/empty/SKILL.md", "");
  put(ws, "agents/skills/hidden/.x", "");
  put(ws, "agents/skills/.dot/SKILL.md", "---\nname: dot\n---\n");
  put(ws, "agents/skills/nofile/README.md", "x");
  expect(rowOf(ws, "plain")).toBe("| plain | local | The summary line. |  |  |  |");
  expect(rowOf(ws, "fenced")).toBe("| fenced | local |  |  |  |  |");
  expect(rowOf(ws, "noname")).toBe("| noname | local | from frontmatter |  |  |  |");
  expect(rowOf(ws, "it's")).toBe("| it's | local | one two |  | a b |  |");
  expect(mapSections(ws).skills).not.toMatch(/dot|hidden|nofile/);
  expect(mapSections(ws).skills).toContain("| empty | local |");
});

it("marks a skill the stock package ships as repo, and truncates long descriptions", () => {
  const ws = selfWs("maps-long-");
  put(ws, "agents/skills/long/SKILL.md", `---\nname: long\ndescription: ${"word ".repeat(80).trim()}\n---\n`);
  put(ws, "node_modules/@workerstack/repo/agents/skills/long/SKILL.md", "x");
  const row = rowOf(ws, "long") ?? "";
  expect(row).toMatch(/^\| long \| repo \| word .*…/);
  expect(row.length).toBeLessThan(200);
});

it("escapes pipes inside a cell and handles every scalar form of the small YAML reader", () => {
  const ws = selfWs("maps-yaml-");
  put(ws, "agents/skills/yaml/SKILL.md", EVERY_FORM);
  expect(rowOf(ws, "yaml")).toBe("| yaml | local | a \\| b |  |  |  |");
});
