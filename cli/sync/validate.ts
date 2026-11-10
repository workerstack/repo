import fs from "node:fs";
import path from "node:path";
import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { Output } from "./outputs.ts";

/**
 * How an output's text is read: `text` is not parsed; `markdown` parses its YAML frontmatter when it has one;
 * `jsonc` is JSON with comments and trailing commas, as an editor's settings file.
 */
type OutputFormat = "json" | "jsonc" | "toml" | "markdown" | "text";

/**
 * One registered output path pattern. `schema` checks the parsed JSON or TOML, or a markdown file's frontmatter
 * (an empty mapping when it has none).
 */
export type FormatEntry = { match: (path: string) => boolean; format: OutputFormat; schema?: z.ZodType };

const REGISTER_HINT = "no output format registered; add it to cli/sync/validate.ts";

// Every host schema is loose: a host may add keys, and sync must not reject what the host reads.
const hookCommand = z.looseObject({ type: z.string(), command: z.string().optional(), timeout: z.number().optional() });
/** A claude or codex hook entry: an optional matcher and the handlers it runs. */
const hookEntry = z.looseObject({ matcher: z.string().optional(), hooks: z.array(hookCommand).optional() });
/** An event name to its entries, the shape of `hooks` in claude's settings and in codex's and grok's hook files. */
const hooksByEvent = z.record(z.string(), z.array(hookEntry));

const AGENT_FRONTMATTER = z.looseObject({ name: z.string(), description: z.string() });
const CLAUDE_RULE_FRONTMATTER = z.looseObject({ paths: z.array(z.string()).optional() });
const CLAUDE_SETTINGS = z.looseObject({
  permissions: z.looseObject({ deny: z.array(z.string()).optional() }).optional(),
  hooks: hooksByEvent.optional(),
  enableAllProjectMcpServers: z.boolean().optional(),
  enabledMcpjsonServers: z.array(z.string()).optional(),
});
const MCP_SERVERS = z.looseObject({ mcpServers: z.record(z.string(), z.looseObject({})).optional() });
const CODEX_HOOKS = z.looseObject({ hooks: hooksByEvent.optional() });
const CURSOR_HOOKS = z.looseObject({
  version: z.number().optional(),
  hooks: z
    .record(
      z.string(),
      z.array(
        z.looseObject({
          type: z.string().optional(),
          command: z.string().optional(),
          matcher: z.string().optional(),
          timeout: z.number().optional(),
        }),
      ),
    )
    .optional(),
});
/** Antigravity's file nests flat entries (a command) and matcher entries (handlers) under one `rulesync` key. */
const AGENTS_HOOKS = z.looseObject({
  rulesync: z.record(z.string(), z.array(hookEntry.extend({ command: z.string().optional() }))).optional(),
});

// The tool configs are strict at the top: sync writes them whole, and a key the tool does not know is a typo.
const strings = z.array(z.string());
const severity = z.enum(["off", "allow", "warn", "error", "deny"]);
const lintRules = z.record(z.string(), z.union([severity, z.tuple([severity], z.unknown())]));
/** `.oxlintrc.json`, one key per property of oxlint's shipped `configuration_schema.json`. */
export const OXLINT_CONFIG: z.ZodObject<
  {
    $schema: z.ZodOptional<z.ZodString>;
    categories: z.ZodOptional<
      z.ZodRecord<
        z.ZodString,
        z.ZodEnum<{
          error: "error";
          deny: "deny";
          off: "off";
          allow: "allow";
          warn: "warn";
        }>
      >
    >;
    env: z.ZodOptional<z.ZodUnknown>;
    extends: z.ZodOptional<z.ZodArray<z.ZodString>>;
    globals: z.ZodOptional<z.ZodUnknown>;
    ignorePatterns: z.ZodOptional<z.ZodArray<z.ZodString>>;
    jsPlugins: z.ZodOptional<z.ZodUnknown>;
    options: z.ZodOptional<
      z.ZodObject<
        {
          typeAware: z.ZodOptional<z.ZodBoolean>;
          respectEslintDisableDirectives: z.ZodOptional<z.ZodBoolean>;
        },
        z.core.$loose
      >
    >;
    overrides: z.ZodOptional<
      z.ZodArray<
        z.ZodObject<
          {
            files: z.ZodArray<z.ZodString>;
            rules: z.ZodOptional<
              z.ZodRecord<
                z.ZodString,
                z.ZodUnion<
                  readonly [
                    z.ZodEnum<{
                      error: "error";
                      deny: "deny";
                      off: "off";
                      allow: "allow";
                      warn: "warn";
                    }>,
                    z.ZodTuple<
                      [
                        z.ZodEnum<{
                          error: "error";
                          deny: "deny";
                          off: "off";
                          allow: "allow";
                          warn: "warn";
                        }>,
                      ],
                      z.ZodUnknown
                    >,
                  ]
                >
              >
            >;
          },
          z.core.$loose
        >
      >
    >;
    plugins: z.ZodOptional<z.ZodArray<z.ZodString>>;
    rules: z.ZodOptional<
      z.ZodRecord<
        z.ZodString,
        z.ZodUnion<
          readonly [
            z.ZodEnum<{
              error: "error";
              deny: "deny";
              off: "off";
              allow: "allow";
              warn: "warn";
            }>,
            z.ZodTuple<
              [
                z.ZodEnum<{
                  error: "error";
                  deny: "deny";
                  off: "off";
                  allow: "allow";
                  warn: "warn";
                }>,
              ],
              z.ZodUnknown
            >,
          ]
        >
      >
    >;
    settings: z.ZodOptional<z.ZodUnknown>;
  },
  z.core.$strict
> = z.strictObject({
  $schema: z.string().optional(),
  categories: z.record(z.string(), severity).optional(),
  env: z.unknown().optional(),
  extends: strings.optional(),
  globals: z.unknown().optional(),
  ignorePatterns: strings.optional(),
  jsPlugins: z.unknown().optional(),
  options: z
    .looseObject({ typeAware: z.boolean().optional(), respectEslintDisableDirectives: z.boolean().optional() })
    .optional(),
  overrides: z.array(z.looseObject({ files: strings, rules: lintRules.optional() })).optional(),
  plugins: strings.optional(),
  rules: lintRules.optional(),
  settings: z.unknown().optional(),
});
/** `.oxfmtrc.jsonc`, one key per property of oxfmt's shipped `configuration_schema.json`. */
export const OXFMT_CONFIG: z.ZodObject<
  {
    arrowParens: z.ZodOptional<z.ZodUnknown>;
    associations: z.ZodOptional<z.ZodUnknown>;
    astro: z.ZodOptional<z.ZodUnknown>;
    bracketSameLine: z.ZodOptional<z.ZodUnknown>;
    bracketSpacing: z.ZodOptional<z.ZodUnknown>;
    embeddedLanguageFormatting: z.ZodOptional<z.ZodUnknown>;
    endOfLine: z.ZodOptional<z.ZodUnknown>;
    experimentalOperatorPosition: z.ZodOptional<z.ZodUnknown>;
    htmlWhitespaceSensitivity: z.ZodOptional<z.ZodUnknown>;
    ignorePatterns: z.ZodOptional<z.ZodArray<z.ZodString>>;
    insertFinalNewline: z.ZodOptional<z.ZodUnknown>;
    jsdoc: z.ZodOptional<z.ZodUnknown>;
    jsxSingleQuote: z.ZodOptional<z.ZodUnknown>;
    objectWrap: z.ZodOptional<z.ZodUnknown>;
    overrides: z.ZodOptional<z.ZodUnknown>;
    printWidth: z.ZodOptional<z.ZodNumber>;
    proseWrap: z.ZodOptional<z.ZodUnknown>;
    quoteProps: z.ZodOptional<z.ZodUnknown>;
    semi: z.ZodOptional<z.ZodUnknown>;
    singleAttributePerLine: z.ZodOptional<z.ZodUnknown>;
    singleQuote: z.ZodOptional<z.ZodUnknown>;
    sortImports: z.ZodOptional<z.ZodUnknown>;
    sortPackageJson: z.ZodOptional<z.ZodUnknown>;
    sortTailwindcss: z.ZodOptional<z.ZodUnknown>;
    svelte: z.ZodOptional<z.ZodUnknown>;
    tabWidth: z.ZodOptional<z.ZodUnknown>;
    trailingComma: z.ZodOptional<z.ZodUnknown>;
    useTabs: z.ZodOptional<z.ZodUnknown>;
    vueIndentScriptAndStyle: z.ZodOptional<z.ZodUnknown>;
  },
  z.core.$strict
> = z.strictObject({
  arrowParens: z.unknown().optional(),
  associations: z.unknown().optional(),
  astro: z.unknown().optional(),
  bracketSameLine: z.unknown().optional(),
  bracketSpacing: z.unknown().optional(),
  embeddedLanguageFormatting: z.unknown().optional(),
  endOfLine: z.unknown().optional(),
  experimentalOperatorPosition: z.unknown().optional(),
  htmlWhitespaceSensitivity: z.unknown().optional(),
  ignorePatterns: strings.optional(),
  insertFinalNewline: z.unknown().optional(),
  jsdoc: z.unknown().optional(),
  jsxSingleQuote: z.unknown().optional(),
  objectWrap: z.unknown().optional(),
  overrides: z.unknown().optional(),
  printWidth: z.number().int().positive().optional(),
  proseWrap: z.unknown().optional(),
  quoteProps: z.unknown().optional(),
  semi: z.unknown().optional(),
  singleAttributePerLine: z.unknown().optional(),
  singleQuote: z.unknown().optional(),
  sortImports: z.unknown().optional(),
  sortPackageJson: z.unknown().optional(),
  sortTailwindcss: z.unknown().optional(),
  svelte: z.unknown().optional(),
  tabWidth: z.unknown().optional(),
  trailingComma: z.unknown().optional(),
  useTabs: z.unknown().optional(),
  vueIndentScriptAndStyle: z.unknown().optional(),
});

/** `turbo.json`: loose, since turbo adds keys; it must name its tasks. */
const buildTurboConfig = () =>
  z.looseObject({
    $schema: z.string().optional(),
    globalDependencies: strings.optional(),
    tasks: z.record(z.string(), z.looseObject({})),
  });
const TURBO_CONFIG = /* @__PURE__ */ buildTurboConfig();

const exact = (rel: string) => (candidate: string) => candidate === rel;
/** Matches `rel` at the root and under any workspace package dir: `AGENTS.md`, `packages/web/AGENTS.md`. */
const named = (rel: string) => (candidate: string) => candidate === rel || candidate.endsWith(`/${rel}`);
/** Matches `<dir>/<one name><ext>` for a dir with no slash at its end. */
const inDir = (dir: string, ext: string) => (candidate: string) =>
  candidate.startsWith(`${dir}/`) && candidate.endsWith(ext) && !candidate.slice(dir.length + 1).includes("/");

/** Matches `<dir>/<any depth><ext>`: a rule may sit in a subfolder. */
const under = (dir: string, ext: string) => (candidate: string) =>
  candidate.startsWith(`${dir}/`) && candidate.endsWith(ext);

/**
 * Every output path a generator may produce, first match wins. A later slice that adds a generated file registers
 * its format here, and its schema when the host has a shape worth checking.
 */
const OUTPUT_FORMATS: readonly FormatEntry[] = [
  { match: exact(".claude/settings.json"), format: "json", schema: CLAUDE_SETTINGS },
  { match: exact(".mcp.json"), format: "json", schema: MCP_SERVERS },
  { match: exact(".agents/mcp_config.json"), format: "json", schema: MCP_SERVERS },
  { match: exact(".cursor/hooks.json"), format: "json", schema: CURSOR_HOOKS },
  { match: exact(".codex/hooks.json"), format: "json", schema: CODEX_HOOKS },
  { match: exact(".agents/hooks.json"), format: "json", schema: AGENTS_HOOKS },
  { match: inDir(".grok/hooks", ".json"), format: "json", schema: CODEX_HOOKS },
  { match: exact(".vscode/tasks.json"), format: "json" },
  { match: exact(".vscode/settings.json"), format: "jsonc" },
  { match: inDir(".claude/agents", ".md"), format: "markdown", schema: AGENT_FRONTMATTER },
  { match: inDir(".cursor/agents", ".md"), format: "markdown", schema: AGENT_FRONTMATTER },
  { match: inDir(".grok/agents", ".md"), format: "markdown", schema: AGENT_FRONTMATTER },
  { match: inDir(".agents/agents", ".md"), format: "markdown", schema: AGENT_FRONTMATTER },
  { match: under(".agents/rules", ".md"), format: "markdown" },
  { match: under(".claude/rules", ".md"), format: "markdown", schema: CLAUDE_RULE_FRONTMATTER },
  { match: named("AGENTS.md"), format: "markdown" },
  { match: named("README.md"), format: "markdown" },
  { match: named("CLAUDE.md"), format: "markdown" },
  { match: named("references/INDEX.md"), format: "markdown" },
  { match: exact(".repo/lessons/INDEX.md"), format: "markdown" },
  { match: inDir(".codex/agents", ".toml"), format: "toml" },
  { match: inDir(".grok/roles", ".toml"), format: "toml" },
  { match: exact(".codex/config.toml"), format: "toml" },
  { match: exact(".grok/config.toml"), format: "toml" },
  { match: exact("bunfig.toml"), format: "toml" },
  { match: exact("rust-toolchain.toml"), format: "toml" },
  { match: exact("rustfmt.toml"), format: "toml" },
  { match: exact("clippy.toml"), format: "toml" },
  { match: exact("deny.toml"), format: "toml" },
  { match: exact(".oxlintrc.json"), format: "json", schema: OXLINT_CONFIG },
  { match: exact(".oxfmtrc.jsonc"), format: "jsonc", schema: OXFMT_CONFIG },
  { match: exact("knip.json"), format: "json" },
  { match: exact("turbo.json"), format: "json", schema: TURBO_CONFIG },
  // No TypeScript parser is registered; the generator writes this file from a template, so it is checked as text.
  { match: exact("vitest.config.ts"), format: "text" },
  { match: exact(".gitignore"), format: "text" },
  { match: exact(".gitattributes"), format: "text" },
  { match: exact(".githooks/pre-commit"), format: "text" },
  { match: exact(".githooks/commit-msg"), format: "text" },
  { match: exact(".githooks/pre-push"), format: "text" },
  { match: exact(".github/workflows/ci.yml"), format: "text" },
  { match: exact(".github/workflows/nightly.yml"), format: "text" },
  { match: exact(".github/workflows/release.yml"), format: "text" },
  { match: exact("SECURITY.md"), format: "markdown" },
  { match: exact("CONTRIBUTING.md"), format: "markdown" },
  { match: exact(".github/PULL_REQUEST_TEMPLATE.md"), format: "markdown" },
  { match: exact(".github/CODEOWNERS"), format: "text" },
  { match: exact(".github/ISSUE_TEMPLATE/bug_report.yml"), format: "text" },
  { match: exact(".github/ISSUE_TEMPLATE/config.yml"), format: "text" },
];

/** Parses `content` as `format` and returns the value a schema checks, or a problem. */
function parseContent(format: OutputFormat, content: string): { value: unknown } | { problem: string } {
  try {
    if (format === "json") return { value: JSON.parse(content) };
    if (format === "toml") return { value: parseToml(content) };
  } catch (error) {
    return { problem: `invalid ${format === "json" ? "JSON" : "TOML"}: ${(error as Error).message}` };
  }
  if (format === "jsonc") {
    const errors: ParseError[] = [];
    const value: unknown = parseJsonc(content, errors, { allowTrailingComma: true });
    const first = errors[0];
    return first === undefined
      ? { value }
      : { problem: `invalid JSONC: ${printParseErrorCode(first.error)} at offset ${first.offset}` };
  }
  return format === "markdown" ? parseFrontmatter(content) : { value: undefined };
}

/** The YAML frontmatter of a markdown file as a mapping; empty when the file has none. */
function parseFrontmatter(content: string): { value: unknown } | { problem: string } {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return { value: {} };
  const closed = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(content);
  if (closed === null) return { problem: "invalid frontmatter: no closing ---" };
  let data: unknown;
  try {
    data = parseYaml(closed[1] ?? "") ?? {};
  } catch (error) {
    return { problem: `invalid frontmatter: ${(error as Error).message.split("\n")[0]}` };
  }
  if (typeof data !== "object" || Array.isArray(data)) return { problem: "invalid frontmatter: must be a mapping" };
  return { value: data };
}

/** `dotted.path: message` per zod issue; an issue at the root has no path. */
function schemaProblems(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const where = issue.path.map(String).join(".");
    return where === "" ? issue.message : `${where}: ${issue.message}`;
  });
}

/** The problems of one file output: its parse error, its schema misses, or the missing registration. */
function fileProblems(output: Extract<Output, { kind: "file" }>, formats: readonly FormatEntry[]): string[] {
  const entry = formats.find((candidate) => candidate.match(output.path));
  if (entry === undefined) return [REGISTER_HINT];
  const parsed = parseContent(entry.format, output.content);
  if ("problem" in parsed) return [parsed.problem];
  return entry.schema === undefined ? [] : schemaProblems(entry.schema, parsed.value);
}

/**
 * Whether the link planned at `linkRel` will point at something once sync has run: its target is on disk, a planned
 * output, or the dir above one; a target that is itself a planned link is followed.
 */
function resolves(
  root: string,
  linkRel: string,
  links: Map<string, string>,
  planned: Set<string>,
  seen: Set<string>,
): boolean {
  const target = path
    .relative(root, path.resolve(root, path.dirname(linkRel), links.get(linkRel) as string))
    .split(path.sep)
    .join("/");
  if (fs.existsSync(path.join(root, target)) || planned.has(target)) return true;
  if (!links.has(target) || seen.has(target)) return false;
  return resolves(root, target, links, planned, seen.add(target));
}

/**
 * Every problem in `outputs` as `path: problem` lines, in output order, so a caller can refuse before it writes
 * anything. A file must parse in its registered format and match that format's schema; a path with no registered
 * format is a problem. A link must resolve, against what is on disk under `root` plus the planned outputs (a link
 * to another planned link, or into the dir of a planned file, resolves). `formats` is a test seam.
 */
export function validateOutputs(
  root: string,
  outputs: readonly Output[],
  formats: readonly FormatEntry[] = OUTPUT_FORMATS,
): string[] {
  const links = new Map<string, string>();
  const planned = new Set<string>();
  for (const output of outputs) {
    if (output.kind === "link") links.set(output.path, output.target);
    else planned.add(output.path);
  }
  // A planned file also plans every dir above it.
  for (const rel of [...planned]) {
    for (let dir = path.posix.dirname(rel); dir !== "."; dir = path.posix.dirname(dir)) planned.add(dir);
  }
  const lines: string[] = [];
  for (const output of outputs) {
    if (output.kind === "file") {
      lines.push(...fileProblems(output, formats).map((problem) => `${output.path}: ${problem}`));
    } else if (!resolves(root, output.path, links, planned, new Set([output.path]))) {
      lines.push(`${output.path}: link target ${output.target} does not exist`);
    }
  }
  return lines;
}
