import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";
import { z } from "zod";

import { file } from "./__fixtures__/outputs-kit.ts";
import { tempDir, useTempDirs } from "./__fixtures__/temp-dirs.ts";
import type { Output } from "./outputs.ts";
import { validateOutputs } from "./validate-outputs.ts";
import { OXFMT_CONFIG, OXLINT_CONFIG } from "./validate-schemas.ts";

useTempDirs();

function tmpRoot(): string {
  return tempDir("workerstack-validate-");
}

it("checks agent frontmatter against its schema", () => {
  const lines = validateOutputs(tmpRoot(), [
    file(".cursor/agents/a.md", "---\nname: a\n---\nBody\n"),
    file(".grok/agents/b.md", "No frontmatter at all\n"),
  ]);

  expect(lines).toStrictEqual([
    ".cursor/agents/a.md: description: Invalid input: expected string, received undefined",
    ".grok/agents/b.md: description: Invalid input: expected string, received undefined",
    ".grok/agents/b.md: name: Invalid input: expected string, received undefined",
  ]);
});

it("reports a schema miss with its dotted path and zod's message", () => {
  const settings = JSON.stringify({ hooks: { PreToolUse: "x" } });
  expect(validateOutputs(tmpRoot(), [file(".claude/settings.json", settings)])).toStrictEqual([
    ".claude/settings.json: hooks.PreToolUse: Invalid input: expected array, received string",
  ]);
});

it("reports a schema miss at the top level without a dotted path", () => {
  expect(validateOutputs(tmpRoot(), [file(".agents/mcp_config.json", "[]")])).toStrictEqual([
    ".agents/mcp_config.json: Invalid input: expected object, received array",
  ]);
});

it("reports indexes in a dotted path", () => {
  const settings = JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 1 }] }] } });
  const lines = validateOutputs(tmpRoot(), [file(".claude/settings.json", settings)]);
  expect(lines).toContain(
    ".claude/settings.json: hooks.Stop.0.hooks.0.type: Invalid input: expected string, received undefined",
  );
});

it("accepts keys the host may add", () => {
  const hooks = {
    hooks: { Stop: [{ future: 1, hooks: [{ extra: true, prompt: "x", timeout: 5, type: "prompt" }] }] },
    other: 1,
  };

  const outputs = [
    file(".claude/settings.json", JSON.stringify({ ...hooks, permissions: { allow: [], deny: ["x"] } })),
    file(".codex/hooks.json", JSON.stringify(hooks)),
    file(
      ".cursor/hooks.json",
      JSON.stringify({ hooks: { stop: [{ command: "x", extra: 1, matcher: "y", type: "command" }] }, version: 1 }),
    ),
    file(
      ".agents/hooks.json",
      JSON.stringify({ rulesync: { Stop: [{ command: "x" }, { hooks: [{ type: "command" }], matcher: "m" }] } }),
    ),
    file(".agents/mcp_config.json", JSON.stringify({ mcpServers: { a: { command: "x" } } })),
    file(".grok/hooks/rtk.json", JSON.stringify(hooks)),
  ];

  expect(validateOutputs(tmpRoot(), outputs)).toStrictEqual([]);
});

it("accepts the empty hook files the generators emit", () => {
  const outputs = [
    file(".agents/hooks.json", "{}"),
    file(".grok/hooks/rulesync.json", '{"hooks":{}}'),
    file(".agents/mcp_config.json", '{"mcpServers":{}}'),
  ];

  expect(validateOutputs(tmpRoot(), outputs)).toStrictEqual([]);
});

it("refuses a file path with no registered format, .mcp.json and a package CLAUDE.md among them", () => {
  expect(validateOutputs(tmpRoot(), [file("docs/x.yaml", "a: 1\n")])).toStrictEqual([
    "docs/x.yaml: no output format registered; add it to cli/sync/validate.ts",
  ]);
  expect(validateOutputs(tmpRoot(), [file(".mcp.json", "{}"), file("packages/web/CLAUDE.md", "x\n")])).toStrictEqual([
    ".mcp.json: no output format registered; add it to cli/sync/validate.ts",
    "packages/web/CLAUDE.md: no output format registered; add it to cli/sync/validate.ts",
  ]);
});

it("reports every problem, in output order", () => {
  const lines = validateOutputs(tmpRoot(), [file("b.yaml", ""), file(".vscode/tasks.json", "{"), file("a.yaml", "")]);
  expect(lines.map((line) => line.split(":")[0])).toStrictEqual(["b.yaml", ".vscode/tasks.json", "a.yaml"]);
});

/** The top-level keys the JSON schema at `schema` allows. */
function schemaKeys(schema: string): string[] {
  const text = fs.readFileSync(schema, "utf8");
  const { properties } = z.object({ properties: z.record(z.string(), z.unknown()) }).parse(JSON.parse(text));

  return Object.keys(properties).toSorted();
}

/** The schema oxlint ships with the pinned package. */
const OXLINT_SCHEMA = path.join(
  path.dirname(Bun.resolveSync("oxlint/package.json", import.meta.dirname)),
  "configuration_schema.json",
);

/** The oxfmt config schema 0.77.0 shipped, vendored: bun fmt reads the same config and installs no schema. */
const OXFMT_SCHEMA = path.join(import.meta.dirname, "__fixtures__", "oxfmt-configuration-schema.json");

it("checks each config against every top-level key its tool allows, and only those", () => {
  expect(Object.keys(OXLINT_CONFIG.shape).toSorted()).toStrictEqual(schemaKeys(OXLINT_SCHEMA));
  expect(Object.keys(OXFMT_CONFIG.shape).toSorted()).toStrictEqual(schemaKeys(OXFMT_SCHEMA));
});

it("accepts a commented oxfmt config and a plain oxlint config", () => {
  const outputs = [
    file(".oxlintrc.json", JSON.stringify({ plugins: ["eslint"], rules: { "eslint/no-console": ["error", {}] } })),
    file(".oxfmtrc.jsonc", '// generated\n{ "printWidth": 120, "ignorePatterns": ["/a"], }\n'),
  ];

  expect(validateOutputs(tmpRoot(), outputs)).toStrictEqual([]);
});

it("refuses a key neither tool knows", () => {
  const lines = validateOutputs(tmpRoot(), [
    file(".oxlintrc.json", '{ "rulez": {} }'),
    file(".oxfmtrc.jsonc", '{ "width": 120 }'),
  ]);

  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^\.oxlintrc\.json: .*"rulez"/);
  expect(lines[1]).toMatch(/^\.oxfmtrc\.jsonc: .*"width"/);
});

function turboFile(content: string): Output {
  return file("turbo.json", content);
}

it("accepts a turbo.json with tasks, and the keys turbo adds", () => {
  const body = { $schema: "x", globalDependencies: ["bun.lock"], tasks: { a: { cache: false } }, ui: "tui" };
  expect(validateOutputs(tmpRoot(), [turboFile(JSON.stringify(body))])).toStrictEqual([]);
});

it("rejects one that is not JSON", () => {
  const [problem] = validateOutputs(tmpRoot(), [turboFile('{ "tasks": ')]);
  expect(problem).toMatch(/^turbo\.json: invalid JSON: /);
});

it("rejects one without tasks, or whose tasks are not an object of objects", () => {
  expect(validateOutputs(tmpRoot(), [turboFile("{}")])).toStrictEqual([expect.stringMatching(/^turbo\.json: tasks: /)]);
  expect(validateOutputs(tmpRoot(), [turboFile('{ "tasks": { "a": 1 } }')])).toStrictEqual([
    expect.stringMatching(/^turbo\.json: tasks\.a: /),
  ]);
  expect(validateOutputs(tmpRoot(), [turboFile('{ "tasks": {}, "globalDependencies": "x" }')])).toStrictEqual([
    expect.stringMatching(/^turbo\.json: globalDependencies: /),
  ]);
});
