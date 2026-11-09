import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONSUMER_DIR, STOCK_DIR, readGoldens } from "../../../dev/capture-tree-goldens.ts";
import { HOSTS } from "../../config.ts";
import { loadSources } from "./sources.ts";
import { renderSubagents } from "./subagents.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const AGENT_DIRS = [".claude/agents/", ".codex/agents/", ".agents/agents/", ".grok/agents/", ".cursor/agents/"];
const isAgentFile = (rel: string) => AGENT_DIRS.some((dir) => rel.startsWith(dir));

/** Frontmatter block (fences included) and the body after it. */
function split(text: string): { head: string; body: string } {
  const close = text.indexOf("\n---\n", 4);
  return { head: text.slice(0, close + 5), body: text.slice(close + 5) };
}

describe("renderSubagents", () => {
  it("matches the consumer goldens byte for byte, path set included", () => {
    const sources = loadSources({ stockRoot: STOCK_DIR, consumerRoot: CONSUMER_DIR });
    const out = renderSubagents(sources, HOSTS);
    const goldens = new Map([...readGoldens()].filter(([rel]) => isAgentFile(rel)));
    expect([...out.keys()].sort()).toEqual([...goldens.keys()].sort());
    for (const [rel, text] of goldens) {
      // emitAgentShellTools later swaps the claude scout body for the stock one; ours is the pre-emit text:
      // the overlay frontmatter (equal to the golden's) plus the overlay body.
      if (rel === ".claude/agents/scout.md") continue;
      expect(out.get(rel), rel).toBe(text);
    }
    const scout = split(out.get(".claude/agents/scout.md")!);
    expect(scout.head).toBe(split(goldens.get(".claude/agents/scout.md")!).head);
    const overlay = split(fs.readFileSync(path.join(CONSUMER_DIR, ".repo/subagents/scout.md"), "utf8"));
    expect(scout.body).toBe(`${overlay.body.trim()}\n`);
  });

  it("matches this repo's committed agent files on stock alone", () => {
    const out = renderSubagents(loadSources({ stockRoot: ROOT, consumerRoot: null }), HOSTS);
    const committed = AGENT_DIRS.flatMap((dir) => fs.readdirSync(path.join(ROOT, dir)).map((name) => `${dir}${name}`));
    expect([...out.keys()].sort()).toEqual(committed.sort());
    for (const rel of committed) expect(out.get(rel), rel).toBe(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  });

  it("emits only the enabled hosts' files", () => {
    const sources = loadSources({ stockRoot: STOCK_DIR, consumerRoot: CONSUMER_DIR });
    expect(renderSubagents(sources, []).size).toBe(0);
    const grok = [...renderSubagents(sources, ["grok"]).keys()];
    expect(grok.length).toBeGreaterThan(0);
    expect(grok.every((rel) => rel.startsWith(".grok/agents/"))).toBe(true);
    // orchestrator targets grok and antigravity only.
    expect(renderSubagents(sources, ["claude", "codex", "cursor"]).keys()).not.toContain(".claude/agents/orchestrator.md");
    expect([...renderSubagents(sources, ["antigravity"]).keys()]).toContain(".agents/agents/orchestrator.md");
  });

  it("covers the edge shapes: nested paths, default descriptions, codex quirks", () => {
    const doc = (rel: string, data: Record<string, unknown>, body: string) => ({ rel: `.repo/subagents/${rel}`, file: rel, data, body });
    const sources = {
      rules: [],
      hooks: { rel: ".rulesync/hooks.jsonc", value: {} },
      subagents: [
        doc("x/deep.md", { name: "deep" }, "deep body"),
        doc("nobody.md", { name: "nobody", codexcli: { nested: { a: 1 } } }, "one\ntwo"),
        doc("single.md", { name: "single", description: "d", "antigravity-ide": { model: "a", x: "1" }, "antigravity-cli": { model: "b" } }, "one line"),
      ],
    };
    const out = renderSubagents(sources, HOSTS);
    expect(out.get(".claude/agents/x/deep.md")).toBe("---\nname: deep\n---\ndeep body\n");
    expect([...out.keys()].filter((rel) => rel.includes("deep")).length).toBe(1);
    expect(out.get(".cursor/agents/nobody.md")).toBe("---\nname: nobody\n---\none\ntwo\n");
    expect(out.get(".agents/agents/nobody.md")).toBe("---\nname: nobody\ndescription: nobody subagent\n---\none\ntwo\n");
    expect(out.get(".codex/agents/nobody.toml")).toBe("name = \"nobody\"\n\n[nested]\na = 1\ndeveloper_instructions = '''\none\ntwo\n'''\n");
    expect(out.get(".codex/agents/single.toml")).toBe('name = "single"\ndescription = "d"\ndeveloper_instructions = "one line"\n');
    expect(out.get(".agents/agents/single.md")).toBe("---\nname: single\ndescription: d\nmodel: b\nx: '1'\n---\none line\n");
  });

  it("writes shallowest paths first, honours a scalar target and omits an empty codex body", () => {
    const doc = (file: string, data: Record<string, unknown>) => ({ rel: `.repo/subagents/${file}`, file, data, body: "" });
    const sources = {
      rules: [],
      hooks: { rel: ".rulesync/hooks.jsonc", value: {} },
      subagents: [doc("z.md", { name: "z" }), doc("a/b.md", { name: "b" }), doc("m.md", { name: "m", targets: "codexcli" }), doc("c.md", { name: "c" })],
    };
    expect([...renderSubagents(sources, ["claude"]).keys()]).toEqual([".claude/agents/c.md", ".claude/agents/z.md", ".claude/agents/a/b.md"]);
    expect(renderSubagents(sources, ["codex"]).get(".codex/agents/m.toml")).toBe('name = "m"\n');
  });

  it("fails on a subagent without a string name", () => {
    const sources = {
      rules: [],
      hooks: { rel: ".rulesync/hooks.jsonc", value: {} },
      subagents: [{ rel: ".repo/subagents/bad.md", file: "bad.md", data: { name: 3 }, body: "" }],
    };
    expect(() => renderSubagents(sources, ["claude"])).toThrow(".repo/subagents/bad.md: invalid frontmatter: name must be a string");
  });
});
