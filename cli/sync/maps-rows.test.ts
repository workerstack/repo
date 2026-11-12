import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { selfWs } from "./__fixtures__/maps-kit.ts";
import { put, tempDir, useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { mapSections } from "./maps.ts";

useTempDirs();

function rowOf(ws: string, file: string) {
  return mapSections(ws)
    .refs.split("\n")
    .find((line) => line.includes(`references/${file} |`));
}

function skillOf(ws: string, name: string) {
  return mapSections(ws)
    .skills.split("\n")
    .find((line) => line.startsWith(`| ${name} |`));
}

it("keeps a bare row for huge, binary and unreadable refs, and skips dotfiles and non-markdown", () => {
  const ws = selfWs("maps-huge-");
  put(ws, "references/huge.md", `# Huge\n\n${"x".repeat(512 * 1024 + 1)}`);
  put(ws, "references/bin.md", "# Bin\0\n");
  put(ws, "references/.hidden.md", "# Hidden\n");
  put(ws, "references/notes.txt", "x");
  put(ws, "references/.dir/skipped.md", "# Skipped\n");
  fs.symlinkSync(path.join(ws, "references", "huge.md"), path.join(ws, "references", "link.md"));
  const { refs } = mapSections(ws);
  expect(rowOf(ws, "huge.md")).toBe("| node_modules/@workerstack/repo/references/huge.md | huge |  |  |");
  expect(rowOf(ws, "bin.md")).toBe("| node_modules/@workerstack/repo/references/bin.md | bin |  |  |");
  expect(refs).not.toMatch(/hidden|notes|skipped|link\.md/i);
  expect(refs).not.toMatch(/^x{100,}/m);
});

it("titles a ref from its first heading, falling back to its file name", () => {
  const ws = selfWs("maps-title-");
  put(ws, "references/a.md", "---\ntags: lone\n---\n# Title ##\n\nSummary here.\n");
  put(ws, "references/b.md", "no heading\n");
  put(ws, "references/c.md", "---\ntags: [p, q]\n---\n# C\n");
  put(ws, "references/d.md", '---\ntags: "[r, s]"\n---\n# D\n');
  expect(rowOf(ws, "a.md")).toBe("| node_modules/@workerstack/repo/references/a.md | Title | lone | Summary here. |");
  expect(rowOf(ws, "b.md")).toBe("| node_modules/@workerstack/repo/references/b.md | b |  |  |");
  expect(rowOf(ws, "c.md")).toBe("| node_modules/@workerstack/repo/references/c.md | C | p, q |  |");
  expect(rowOf(ws, "d.md")).toBe("| node_modules/@workerstack/repo/references/d.md | D | [r, s] |  |");
});

it("is empty for a repo with no references or skills", () => {
  const ws = tempDir("maps-empty-");
  expect(mapSections(ws).refs.split("\n")).toHaveLength(2);
  expect(mapSections(ws).skills.split("\n")).toHaveLength(2);
});

it("joins a folded description over its lines and reads literal, quoted and flow values", () => {
  const ws = selfWs("maps-forms-");
  put(
    ws,
    "agents/skills/strip/SKILL.md",
    "---\nname: strip\ndescription: >-\n  Session flag. Default.\n  Work it through.\n---\n",
  );
  put(ws, "agents/skills/lit/SKILL.md", "---\nname: lit\ndescription: |\n  one\n  two\n---\n");
  put(ws, "agents/skills/quoted/SKILL.md", "---\nname: 'it''s'\ndescription: \"a | b\"\ncommandPath: \"x y\"\n---\n");
  put(ws, "references/flow.md", "---\ntags: [a, b]\n---\n# Flow\n");
  expect(skillOf(ws, "strip")).toBe("| strip | local | Session flag. Default. Work it through. |  |  |  |");
  expect(skillOf(ws, "lit")).toBe("| lit | local | one two |  |  |  |");
  expect(skillOf(ws, "it's")).toBe("| it's | local | a \\| b |  | x y |  |");
  expect(rowOf(ws, "flow.md")).toBe("| node_modules/@workerstack/repo/references/flow.md | Flow | a, b |  |");
});

it("gives a frontmatter block YAML cannot parse an empty description and no tags, and keeps the other rows", () => {
  const ws = selfWs("maps-broken-");
  put(ws, "agents/skills/broken/SKILL.md", "---\nname: broken\ndescription: one: two\n---\n");
  put(ws, "agents/skills/fine/SKILL.md", "---\nname: fine\ndescription: ok\n---\n");
  put(ws, "references/bad.md", "---\ntags: [x]\ntitle: a: b\n---\n# Bad\n");
  put(ws, "references/good.md", "---\ntags: [y]\n---\n# Good\n");
  expect(skillOf(ws, "broken")).toBe("| broken | local |  |  |  |  |");
  expect(skillOf(ws, "fine")).toBe("| fine | local | ok |  |  |  |");
  expect(rowOf(ws, "bad.md")).toBe("| node_modules/@workerstack/repo/references/bad.md | Bad |  |  |");
  expect(rowOf(ws, "good.md")).toBe("| node_modules/@workerstack/repo/references/good.md | Good | y |  |");
});

it("reads a frontmatter that is not a mapping as empty", () => {
  const ws = selfWs("maps-scalar-");
  put(ws, "agents/skills/scalar/SKILL.md", "---\njust text\n---\n");
  put(ws, "agents/skills/list/SKILL.md", "---\n- a\n- b\n---\n");
  expect(skillOf(ws, "scalar")).toBe("| scalar | local |  |  |  |  |");
  expect(skillOf(ws, "list")).toBe("| list | local |  |  |  |  |");
});

it("skips a map.task that is an object or a list and keeps a string", () => {
  const ws = selfWs("maps-task-");
  put(ws, "agents/skills/obj/SKILL.md", "---\nname: obj\nmap:\n  task:\n    nested: yes\n---\n");
  put(ws, "agents/skills/arr/SKILL.md", "---\nname: arr\nmap:\n  task:\n    - a\n    - b\n---\n");
  put(ws, "agents/skills/str/SKILL.md", "---\nname: str\nmap:\n  task: keep-me\n---\n");
  const { skills } = mapSections(ws);
  expect(skills).toMatch(/\| str \| local \|  \| keep-me \|/);
  expect(skills).not.toMatch(/\[object Object\]|nested/);
  expect(skillOf(ws, "obj")).toBe("| obj | local |  |  |  |  |");
  expect(skillOf(ws, "arr")).toBe("| arr | local |  |  |  |  |");
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
  expect(skillOf(ws, "dotted")).toBe("| dotted | local |  | do it | bun repo x | a.md, b.md |");
  expect(skillOf(ws, "dotstr")).toBe("| dotstr | local |  |  |  | one.md |");
  expect(skillOf(ws, "nested")).toBe("| nested | local |  |  |  | c.md |");
  expect(skillOf(ws, "nestedstr")).toBe("| nestedstr | local |  |  |  | two.md |");
});

it("falls back to the dir name and the first body line", () => {
  const ws = selfWs("maps-fallback-");
  put(ws, "agents/skills/plain/SKILL.md", "# Plain\n\n## Sub\n<!-- note -->\n---\nThe summary line.\n");
  put(ws, "agents/skills/fenced/SKILL.md", "# Fenced\n\n```\n");
  put(ws, "agents/skills/noname/SKILL.md", "---\ndescription: from frontmatter\n---\n");
  put(ws, "agents/skills/folded/SKILL.md", "---\nname: folded\ndescription: >\n  one\n\n  two\n---\n");
  put(ws, "agents/skills/nulldesc/SKILL.md", "---\nname: nulldesc\ndescription: # comment\n---\n");
  put(ws, "agents/skills/empty/SKILL.md", "");
  put(ws, "agents/skills/hidden/.x", "");
  put(ws, "agents/skills/.dot/SKILL.md", "---\nname: dot\n---\n");
  put(ws, "agents/skills/nofile/README.md", "x");
  expect(skillOf(ws, "plain")).toBe("| plain | local | The summary line. |  |  |  |");
  expect(skillOf(ws, "fenced")).toBe("| fenced | local |  |  |  |  |");
  expect(skillOf(ws, "noname")).toBe("| noname | local | from frontmatter |  |  |  |");
  expect(skillOf(ws, "folded")).toBe("| folded | local | one two |  |  |  |");
  expect(skillOf(ws, "nulldesc")).toBe("| nulldesc | local |  |  |  |  |");
  expect(mapSections(ws).skills).not.toMatch(/dot|hidden|nofile/);
  expect(mapSections(ws).skills).toContain("| empty | local |");
});

it("marks a skill the stock package ships as repo, and truncates long descriptions", () => {
  const ws = selfWs("maps-long-");
  put(ws, "agents/skills/long/SKILL.md", `---\nname: long\ndescription: ${"word ".repeat(80).trim()}\n---\n`);
  put(ws, "node_modules/@workerstack/repo/agents/skills/long/SKILL.md", "x");
  const row = skillOf(ws, "long") ?? "";
  expect(row).toMatch(/^\| long \| repo \| word .*…/);
  expect(row.length).toBeLessThan(200);
});
