import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { fixtureDirs, readGoldens } from "../../../dev/capture-tree-goldens.ts";
import { HOSTS } from "../../config.ts";
import type { JsonObject } from "../../json.ts";
import { byCodeUnit } from "../by-code-unit.ts";
import { stamp } from "../header.ts";
import { loadSources } from "./load-sources.ts";
import type { Doc } from "./sources.types.ts";
import { renderSubagents } from "./subagents.ts";

const { consumer: consumerDir, stock: stockDir } = fixtureDirs();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const AGENT_DIRS = [".claude/agents/", ".codex/agents/", ".agents/agents/", ".grok/agents/", ".cursor/agents/"];

function isAgentFile(rel: string) {
  return AGENT_DIRS.some((dir) => rel.startsWith(dir));
}

/** Frontmatter block (fences included) and the body after it. */
function split(text: string): { head: string; body: string } {
  const close = text.indexOf("\n---\n", 4);

  return { body: text.slice(close + 5), head: text.slice(0, close + 5) };
}

it("matches the consumer goldens byte for byte, path set included", () => {
  const sources = loadSources({ consumerRoot: consumerDir, packages: [], stockRoot: stockDir }).sources;
  const out = renderSubagents(sources, HOSTS);
  const goldens = new Map([...readGoldens()].filter(([rel]) => isAgentFile(rel)));
  expect([...out.keys()].toSorted(byCodeUnit)).toStrictEqual([...goldens.keys()].toSorted(byCodeUnit));

  for (const [rel, text] of goldens) {
    // emitAgentShellTools later swaps the claude scout body for the stock one; ours is the pre-emit text:
    // the overlay frontmatter (equal to the golden's) plus the overlay body.
    if (rel === ".claude/agents/scout.md") continue;
    expect(out.get(rel), rel).toBe(text);
  }

  const scout = split(out.get(".claude/agents/scout.md") ?? "");
  expect(scout.head).toBe(split(goldens.get(".claude/agents/scout.md") ?? "").head);
  const overlay = split(fs.readFileSync(path.join(consumerDir, ".repo/subagents/scout.md"), "utf8"));
  expect(scout.body).toBe(`${overlay.body.trim()}\n`);
});

it("matches this repo's committed agent files on stock alone, as sync stamps them", () => {
  const out = renderSubagents(loadSources({ consumerRoot: null, packages: [], stockRoot: ROOT }).sources, HOSTS);
  const committed = AGENT_DIRS.flatMap((dir) => fs.readdirSync(path.join(ROOT, dir)).map((name) => `${dir}${name}`));
  expect([...out.keys()].toSorted(byCodeUnit)).toStrictEqual(committed.toSorted(byCodeUnit));

  for (const rel of committed)
    expect(stamp(rel, out.get(rel) ?? ""), rel).toBe(fs.readFileSync(path.join(ROOT, rel), "utf8"));
});

it("emits only the enabled hosts' files", () => {
  const sources = loadSources({ consumerRoot: consumerDir, packages: [], stockRoot: stockDir }).sources;
  expect(renderSubagents(sources, []).size).toBe(0);
  const grok = [...renderSubagents(sources, ["grok"]).keys()];
  expect(grok.length).toBeGreaterThan(0);
  expect(grok.every((rel) => rel.startsWith(".grok/agents/"))).toBe(true);
  // orchestrator targets grok and antigravity only.
  expect(renderSubagents(sources, ["claude", "codex", "cursor"]).keys()).not.toContain(
    ".claude/agents/orchestrator.md",
  );
  expect([...renderSubagents(sources, ["antigravity"]).keys()]).toContain(".agents/agents/orchestrator.md");
});

/** A consumer subagent at `rel` under `.repo/subagents/`. */
function agentDoc(rel: string, data: JsonObject, body = ""): Doc {
  return { body, data, file: rel, origin: "repo", rel: `.repo/subagents/${rel}`, scope: "" };
}

const EDGE_SOURCES = {
  hooks: { rel: "agents/hooks.jsonc", value: {} },
  rules: [],
  subagents: [
    agentDoc("x/deep.md", { name: "deep" }, "deep body"),
    agentDoc("nobody.md", { codexcli: { nested: { a: 1 } }, name: "nobody" }, "one\ntwo"),
    agentDoc(
      "single.md",
      {
        "antigravity-cli": { model: "b" },
        "antigravity-ide": { model: "a", x: "1" },
        description: "d",
        name: "single",
      },
      "one line",
    ),
  ],
};

it("covers the edge shapes: nested paths, default descriptions, codex quirks", () => {
  const out = renderSubagents(EDGE_SOURCES, HOSTS);
  expect(out.get(".claude/agents/x/deep.md")).toBe("---\nname: deep\n---\ndeep body\n");
  expect([...out.keys()].filter((rel) => rel.includes("deep")).length).toBe(1);
  expect(out.get(".cursor/agents/nobody.md")).toBe("---\nname: nobody\n---\none\ntwo\n");
  expect(out.get(".agents/agents/nobody.md")).toBe("---\nname: nobody\ndescription: nobody subagent\n---\none\ntwo\n");
  expect(out.get(".codex/agents/nobody.toml")).toBe(
    "name = \"nobody\"\n\n[nested]\na = 1\ndeveloper_instructions = '''\none\ntwo\n'''\n",
  );
  expect(out.get(".codex/agents/single.toml")).toBe(
    'name = "single"\ndescription = "d"\ndeveloper_instructions = "one line"\n',
  );
  expect(out.get(".agents/agents/single.md")).toBe(
    "---\nname: single\ndescription: d\nmodel: b\nx: '1'\n---\none line\n",
  );
});

it("writes a nested map's strings on one line for the flat hosts", () => {
  const sources = {
    hooks: { rel: "agents/hooks.jsonc", value: {} },
    rules: [],
    subagents: [agentDoc("nest.md", { cursor: { opts: { note: "a\n\nb" } }, name: "nest" }, "body")],
  };

  expect(renderSubagents(sources, ["cursor"]).get(".cursor/agents/nest.md")).toBe(
    "---\nname: nest\nopts:\n  note: a b\n---\nbody\n",
  );
});

it("writes shallowest paths first, honours a scalar target and omits an empty codex body", () => {
  const sources = {
    hooks: { rel: "agents/hooks.jsonc", value: {} },
    rules: [],
    subagents: [
      agentDoc("z.md", { name: "z" }),
      agentDoc("a/b.md", { name: "b" }),
      agentDoc("m.md", { name: "m", targets: "codexcli" }),
      agentDoc("c.md", { name: "c" }),
    ],
  };

  expect([...renderSubagents(sources, ["claude"]).keys()]).toStrictEqual([
    ".claude/agents/c.md",
    ".claude/agents/z.md",
    ".claude/agents/a/b.md",
  ]);
  expect(renderSubagents(sources, ["codex"]).get(".codex/agents/m.toml")).toBe('name = "m"\n');
});

it("fails on a subagent without a string name", () => {
  const sources = {
    hooks: { rel: "agents/hooks.jsonc", value: {} },
    rules: [],
    subagents: [
      {
        body: "",
        data: { name: 3 },
        file: "bad.md",
        origin: "repo" as const,
        rel: ".repo/subagents/bad.md",
        scope: "",
      },
    ],
  };

  expect(() => renderSubagents(sources, ["claude"])).toThrow(
    ".repo/subagents/bad.md: invalid frontmatter: name must be a string",
  );
});
