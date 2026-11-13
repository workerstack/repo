// The registered output formats: which path parses how, which header comment it takes, and which schema checks it.
import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { readJson } from "../json.ts";
import { errorMessage } from "../sync-errors.ts";
import type { CommentSyntax } from "./header.ts";
import { HOST_SCHEMAS, OXFMT_CONFIG, OXLINT_CONFIG } from "./validate-schemas.ts";

/**
 * How an output's text is read: `text` is not parsed; `markdown` parses its YAML frontmatter when it has one;
 * `jsonc` is JSON with comments and trailing commas, as an editor's settings file.
 */
export type OutputFormat = "json" | "jsonc" | "toml" | "markdown" | "text";

/**
 * One registered output path pattern. `comment` is the line comment sync's header is written in, or null where the
 * format takes none (strict JSON, frontmatter markdown) or the user writes the file too (a block-managed one).
 * `schema` checks the parsed JSON or TOML, or a markdown file's frontmatter (an empty mapping when it has none).
 */
export type FormatEntry = {
  match: (path: string) => boolean;
  format: OutputFormat;
  comment: CommentSyntax | null;
  schema?: z.ZodType;
};

function exact(rel: string) {
  return (candidate: string) => candidate === rel;
}

/** Matches `rel` at the root and under any workspace package dir: `AGENTS.md`, `packages/web/AGENTS.md`. */
function named(rel: string) {
  return (candidate: string) => candidate === rel || candidate.endsWith(`/${rel}`);
}

/** Matches `<dir>/<one name><ext>` for a dir with no slash at its end. */
function inDir(dir: string, ext: string) {
  return (candidate: string) =>
    candidate.startsWith(`${dir}/`) && candidate.endsWith(ext) && !candidate.slice(dir.length + 1).includes("/");
}

/** Matches `<dir>/<any depth><ext>`: a rule may sit in a subfolder. */
function under(dir: string, ext: string) {
  return (candidate: string) => candidate.startsWith(`${dir}/`) && candidate.endsWith(ext);
}

/** The host files: hooks, MCP servers, editor settings, subagents and rules. */
function hostFormats(): FormatEntry[] {
  const { agentFrontmatter, agentsHooks, claudeRuleFrontmatter, claudeSettings, codexHooks, cursorHooks, mcpServers } =
    HOST_SCHEMAS;

  return [
    { comment: null, format: "json", match: exact(".claude/settings.json"), schema: claudeSettings },
    { comment: null, format: "json", match: exact(".agents/mcp_config.json"), schema: mcpServers },
    { comment: null, format: "json", match: exact(".cursor/hooks.json"), schema: cursorHooks },
    { comment: null, format: "json", match: exact(".codex/hooks.json"), schema: codexHooks },
    { comment: null, format: "json", match: exact(".agents/hooks.json"), schema: agentsHooks },
    { comment: null, format: "json", match: inDir(".grok/hooks", ".json"), schema: codexHooks },
    { comment: "//", format: "jsonc", match: exact(".vscode/tasks.json") },
    { comment: null, format: "jsonc", match: exact(".vscode/settings.json") },
    { comment: null, format: "markdown", match: inDir(".claude/agents", ".md"), schema: agentFrontmatter },
    { comment: null, format: "markdown", match: inDir(".cursor/agents", ".md"), schema: agentFrontmatter },
    { comment: null, format: "markdown", match: inDir(".grok/agents", ".md"), schema: agentFrontmatter },
    { comment: null, format: "markdown", match: inDir(".agents/agents", ".md"), schema: agentFrontmatter },
    { comment: null, format: "markdown", match: under(".agents/rules", ".md") },
    { comment: null, format: "markdown", match: under(".claude/rules", ".md"), schema: claudeRuleFrontmatter },
  ];
}

/** The docs, the TOML host and tool configs, and the standards configs. */
function configFormats(): FormatEntry[] {
  return [
    { comment: "<!--", format: "markdown", match: named("AGENTS.md") },
    { comment: "<!--", format: "markdown", match: named("README.md") },
    { comment: null, format: "markdown", match: named("references/INDEX.md") },
    { comment: "<!--", format: "markdown", match: exact(".repo/lessons/INDEX.md") },
    { comment: "#", format: "toml", match: inDir(".codex/agents", ".toml") },
    { comment: "#", format: "toml", match: inDir(".grok/roles", ".toml") },
    { comment: "#", format: "toml", match: exact(".codex/config.toml") },
    { comment: "#", format: "toml", match: exact(".grok/config.toml") },
    { comment: "#", format: "toml", match: exact("bunfig.toml") },
    { comment: "#", format: "toml", match: exact("rust-toolchain.toml") },
    { comment: "#", format: "toml", match: exact("rustfmt.toml") },
    { comment: "#", format: "toml", match: exact("clippy.toml") },
    { comment: "#", format: "toml", match: exact("deny.toml") },
    { comment: null, format: "json", match: exact(".oxlintrc.json"), schema: OXLINT_CONFIG },
    { comment: "//", format: "jsonc", match: exact(".oxfmtrc.jsonc"), schema: OXFMT_CONFIG },
    { comment: null, format: "json", match: exact("knip.json") },
    { comment: null, format: "json", match: exact("turbo.json"), schema: HOST_SCHEMAS.turboConfig },
  ];
}

/** The text files: the vitest config, the ignore files, the git hooks and the GitHub files. */
function textFormats(): FormatEntry[] {
  return [
    // No TypeScript parser is registered; the generator writes this file from a template, so it is checked as text.
    { comment: "//", format: "text", match: exact("vitest.config.ts") },
    { comment: null, format: "text", match: exact(".gitignore") },
    { comment: null, format: "text", match: exact(".gitattributes") },
    { comment: "#", format: "text", match: exact(".githooks/pre-commit") },
    { comment: "#", format: "text", match: exact(".githooks/commit-msg") },
    { comment: "#", format: "text", match: exact(".githooks/pre-push") },
    { comment: "#", format: "text", match: exact(".github/workflows/bench.yml") },
    { comment: "#", format: "text", match: exact(".github/workflows/ci.yml") },
    { comment: "#", format: "text", match: exact(".github/dependabot.yml") },
    { comment: "#", format: "text", match: exact(".github/workflows/nightly.yml") },
    { comment: "#", format: "text", match: exact(".github/workflows/release.yml") },
    { comment: "<!--", format: "markdown", match: exact("SECURITY.md") },
    { comment: "<!--", format: "markdown", match: exact("CONTRIBUTING.md") },
    { comment: "<!--", format: "markdown", match: exact(".github/PULL_REQUEST_TEMPLATE.md") },
    { comment: "#", format: "text", match: exact(".github/CODEOWNERS") },
    { comment: "#", format: "text", match: exact(".github/ISSUE_TEMPLATE/bug_report.yml") },
    { comment: "#", format: "text", match: exact(".github/ISSUE_TEMPLATE/config.yml") },
  ];
}

/**
 * Every output path a generator may produce, first match wins. A later slice that adds a generated file registers
 * its format here, and its schema when the host has a shape worth checking.
 */
function buildOutputFormats(): readonly FormatEntry[] {
  return [...hostFormats(), ...configFormats(), ...textFormats()];
}

/** The registered formats, in match order. */
export const OUTPUT_FORMATS: readonly FormatEntry[] = /* @__PURE__ */ buildOutputFormats();

/** The registered format of the output at root-relative POSIX path `rel`, or null when none is registered. */
export function formatOf(rel: string): FormatEntry | null {
  return OUTPUT_FORMATS.find((entry) => entry.match(rel)) ?? null;
}

/** A parsed value for a schema to check, or why the text did not parse. */
export type Parsed = { value: unknown } | { problem: string };

/** A frontmatter block: its opening `---`, its YAML (group 1, absent when empty) and its closing `---` line. */
const FRONTMATTER_BLOCK = /^---\r?\n(?:(?<yaml>[\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** The YAML frontmatter of a markdown file as a mapping; empty when the file has none. */
function parseFrontmatter(content: string): Parsed {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return { value: {} };
  const closed = FRONTMATTER_BLOCK.exec(content);

  if (closed === null) return { problem: "invalid frontmatter: no closing ---" };
  let data: unknown;

  try {
    data = parseYaml(closed.groups?.yaml ?? "") ?? {};
  } catch (error) {
    return {
      problem: `invalid frontmatter: ${(error /* yaml throws a YAMLParseError */ as Error).message.split("\n")[0]}`,
    };
  }

  const mapping = z.record(z.string(), z.unknown()).safeParse(data).success;

  if (!mapping) return { problem: "invalid frontmatter: must be a mapping" };

  return { value: data };
}

/** `content` as JSON with comments and trailing commas, or its first error's code and offset. */
function parseJsoncContent(content: string): Parsed {
  const errors: ParseError[] = [];
  const value: unknown = parseJsonc(content, errors, { allowTrailingComma: true });
  const [first] = errors;

  return first === undefined
    ? { value }
    : { problem: `invalid JSONC: ${printParseErrorCode(first.error)} at offset ${first.offset}` };
}

/** Parses `content` as `format` and returns the value a schema checks, or a problem. */
export function parseContent(format: OutputFormat, content: string): Parsed {
  try {
    // Any JSON value: the format's schema checks the shape.
    if (format === "json") return { value: readJson(z.json(), content) };

    if (format === "toml") return { value: parseToml(content) };
  } catch (error) {
    return { problem: `invalid ${format === "json" ? "JSON" : "TOML"}: ${errorMessage(error)}` };
  }

  if (format === "jsonc") return parseJsoncContent(content);

  return format === "markdown" ? parseFrontmatter(content) : { value: undefined };
}
