import fs from "node:fs";
import { DEFAULT_COMMIT } from "../config.ts";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { VALID_LESSON } from "../scripts/fixtures/persist-bodies.ts";
import { index, lessons, type Output, type SyncContext } from "./outputs.ts";
import { mapSections, sectionBody } from "./maps.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureWs = path.join(here, "fixtures/maps-ws.tgz");
const goldenIndex = path.join(here, "fixtures/maps/golden/INDEX.md");
const INDEX = "references/INDEX.md";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function put(ws: string, rel: string, text: string) {
  const file = path.join(ws, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function selfWs(prefix: string) {
  const ws = tmpDir(prefix);
  put(ws, "package.json", '{ "name": "@workerstack/repo" }\n');
  fs.mkdirSync(path.join(ws, "references"), { recursive: true });
  return ws;
}

function copyFixtureWs() {
  const dest = tmpDir("maps-ws-");
  // packed, so no skill tree sits live in the repo for an agent to discover
  tar.x({ file: fixtureWs, cwd: dest, sync: true });
  put(dest, "node_modules/@workerstack/repo/agents/skills/beta/SKILL.md", "---\nname: beta\n---\n");
  return dest;
}

/** A context over the real files of `ws`, named like this package or not. */
function context(ws: string, name = "@workerstack/repo"): SyncContext {
  return {
    root: ws,
    config: {
      packs: ["agents", "docs"],
      agents: { hosts: [], skills: [] },
      commit: DEFAULT_COMMIT,
      lint: { skip: [] },
    },
    workspace: { root: ws, manifest: { name }, packages: [] },
    read: (rel) => {
      try {
        return fs.readFileSync(path.join(ws, rel), "utf8");
      } catch {
        return null;
      }
    },
  };
}

function indexText(ws: string): string {
  const result = index(context(ws));
  expect(result.errors).toEqual([]);
  const output: Output | undefined = result.outputs[0];
  if (output?.kind !== "file") throw new Error("no index file");
  return output.content;
}

describe("index maps", () => {
  it("fills repo:skills and repo:refs and keeps the hand text around them byte for byte", () => {
    expect(indexText(copyFixtureWs())).toBe(fs.readFileSync(goldenIndex, "utf8"));
  });

  it("is stable: the written index regenerates to itself", () => {
    const ws = copyFixtureWs();
    put(ws, INDEX, indexText(ws));
    expect(indexText(ws)).toBe(fs.readFileSync(path.join(ws, INDEX), "utf8"));
  });

  it("refs rows name the stock package path and skip INDEX.md", () => {
    const text = indexText(copyFixtureWs());
    expect(text).toContain("| node_modules/@workerstack/repo/references/alpha.md | Alpha |");
    expect(text).toContain("| node_modules/@workerstack/repo/references/nested/beta.md |");
    expect(text).not.toMatch(/references\/INDEX\.md \|/);
    expect(text).not.toMatch(/Body ignored|Beta body|More text ignored/);
  });

  it("creates the sections when INDEX.md is missing", () => {
    const ws = copyFixtureWs();
    fs.rmSync(path.join(ws, INDEX));
    const text = indexText(ws);
    expect(text).toContain("<!-- repo:skills -->");
    expect(text).toContain("<!-- repo:refs -->");
  });

  it("another package gets no skills or refs map", () => {
    const ws = copyFixtureWs();
    const result = index(context(ws, "consumer"));
    const output = result.outputs[0];
    expect(output?.kind === "file" && output.content).not.toContain("alpha-work");
  });

  it("includes extra refs next to the fixture refs", () => {
    const ws = copyFixtureWs();
    put(ws, "references/stripe.md", "---\ntags: [stripe]\n---\n# Stripe\n\nConsumer payments ref.\n");
    const text = indexText(ws);
    expect(text).toMatch(/references\/stripe\.md \| Stripe \| stripe \| Consumer payments ref/);
    expect(text).toMatch(/alpha\.md/);
  });
});

describe("mapSections skills", () => {
  const rowOf = (ws: string, name: string) =>
    mapSections(ws)
      .skills.split("\n")
      .find((line) => line.startsWith(`| ${name} |`));

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
    put(
      ws,
      "agents/skills/yaml/SKILL.md",
      [
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
      ].join("\n"),
    );
    expect(rowOf(ws, "yaml")).toBe("| yaml | local | a \\| b |  |  |  |");
  });
});

describe("mapSections refs", () => {
  const rowOf = (ws: string, file: string) =>
    mapSections(ws)
      .refs.split("\n")
      .find((line) => line.includes(`references/${file} |`));

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
    expect(rowOf(ws, "d.md")).toBe("| node_modules/@workerstack/repo/references/d.md | D | r, s |  |");
  });

  it("is empty for a repo with no references or skills", () => {
    const ws = tmpDir("maps-empty-");
    expect(mapSections(ws).refs.split("\n")).toHaveLength(2);
    expect(mapSections(ws).skills.split("\n")).toHaveLength(2);
  });
});

describe("lessons generator", () => {
  function withLesson() {
    const ws = copyFixtureWs();
    put(ws, "src/a.ts", "x\n");
    put(ws, ".repo/lessons/plan-forks.md", VALID_LESSON);
    return ws;
  }

  it("writes the lessons index, tracked, from the lesson files", () => {
    const result = lessons(context(withLesson()));
    expect(result.errors).toEqual([]);
    expect(result.outputs).toEqual([
      {
        kind: "file",
        path: ".repo/lessons/INDEX.md",
        content: expect.stringContaining(".repo/lessons/plan-forks.md"),
        tracked: true,
        managed: "whole",
      },
    ]);
  });

  it("reports a lesson whose paths match nothing, and still writes the index", () => {
    const ws = withLesson();
    fs.rmSync(path.join(ws, "src"), { recursive: true });
    const result = lessons(context(ws));
    expect(result.errors).toEqual([expect.stringMatching(/src\/\*\* matches no file/)]);
    expect(result.outputs).toHaveLength(1);
  });

  it("writes nothing in a repo without lessons", () => {
    expect(lessons(context(copyFixtureWs()))).toEqual({ outputs: [], errors: [] });
  });
});

describe("sectionBody", () => {
  it("returns the trimmed lines between a marker pair", () => {
    expect(sectionBody("a\n<!-- repo:x -->  \none \r\ntwo\n<!-- /repo:x -->\nb", "x")).toEqual(["one", "two"]);
  });

  it("is null when the pair is missing or unclosed", () => {
    expect(sectionBody("a\n", "x")).toBeNull();
    expect(sectionBody("<!-- repo:x -->\nrest", "x")).toBeNull();
    expect(sectionBody("<!-- /repo:x -->\n<!-- repo:x -->\n", "x")).toBeNull();
  });
});
