// The zod schemas sync checks its parsed outputs against, each built once by a factory marked pure.
import { z } from "zod";

type Severity = z.ZodEnum<{ error: "error"; deny: "deny"; off: "off"; allow: "allow"; warn: "warn" }>;

type LintRules = z.ZodRecord<z.ZodString, z.ZodUnion<readonly [Severity, z.ZodTuple<[Severity], z.ZodUnknown>]>>;

type Strings = z.ZodArray<z.ZodString>;

type Unknown = z.ZodOptional<z.ZodUnknown>;

/** The shape of `.oxlintrc.json`'s schema. */
export type OxlintConfig = z.ZodObject<
  {
    $schema: z.ZodOptional<z.ZodString>;
    categories: z.ZodOptional<z.ZodRecord<z.ZodString, Severity>>;
    env: Unknown;
    extends: z.ZodOptional<Strings>;
    globals: Unknown;
    ignorePatterns: z.ZodOptional<Strings>;
    jsPlugins: Unknown;
    options: z.ZodOptional<
      z.ZodObject<
        { typeAware: z.ZodOptional<z.ZodBoolean>; respectEslintDisableDirectives: z.ZodOptional<z.ZodBoolean> },
        z.core.$loose
      >
    >;
    overrides: z.ZodOptional<
      z.ZodArray<z.ZodObject<{ files: Strings; rules: z.ZodOptional<LintRules> }, z.core.$loose>>
    >;
    plugins: z.ZodOptional<Strings>;
    rules: z.ZodOptional<LintRules>;
    settings: Unknown;
  },
  z.core.$strict
>;

/** The shape of `.oxfmtrc.jsonc`'s schema. */
export type OxfmtConfig = z.ZodObject<
  {
    arrowParens: Unknown;
    associations: Unknown;
    astro: Unknown;
    bracketSameLine: Unknown;
    bracketSpacing: Unknown;
    embeddedLanguageFormatting: Unknown;
    endOfLine: Unknown;
    experimentalOperatorPosition: Unknown;
    htmlWhitespaceSensitivity: Unknown;
    ignorePatterns: z.ZodOptional<Strings>;
    insertFinalNewline: Unknown;
    jsdoc: Unknown;
    jsxSingleQuote: Unknown;
    objectWrap: Unknown;
    overrides: Unknown;
    printWidth: z.ZodOptional<z.ZodNumber>;
    proseWrap: Unknown;
    quoteProps: Unknown;
    semi: Unknown;
    singleAttributePerLine: Unknown;
    singleQuote: Unknown;
    sortImports: Unknown;
    sortPackageJson: Unknown;
    sortTailwindcss: Unknown;
    svelte: Unknown;
    tabWidth: Unknown;
    trailingComma: Unknown;
    useTabs: Unknown;
    vueIndentScriptAndStyle: Unknown;
  },
  z.core.$strict
>;

/** The host file and frontmatter schemas the registered output formats check. */
export type HostSchemas = {
  agentFrontmatter: z.ZodType;
  agentsHooks: z.ZodType;
  claudeRuleFrontmatter: z.ZodType;
  claudeSettings: z.ZodType;
  codexHooks: z.ZodType;
  cursorHooks: z.ZodType;
  mcpServers: z.ZodType;
  turboConfig: z.ZodType;
};

/** Cursor's hooks file: flat entries per event, each a command with an optional matcher. */
function cursorHooks(): z.ZodType {
  const entry = z.looseObject({
    command: z.string().optional(),
    matcher: z.string().optional(),
    timeout: z.number().optional(),
    type: z.string().optional(),
  });

  return z.looseObject({ hooks: z.record(z.string(), z.array(entry)).optional(), version: z.number().optional() });
}

/** Every host schema is loose: a host may add keys, and sync must not reject what the host reads. */
function buildHostSchemas(): HostSchemas {
  const hookCommand = z.looseObject({
    command: z.string().optional(),
    timeout: z.number().optional(),
    type: z.string(),
  });

  // A claude or codex hook entry: an optional matcher and the handlers it runs.
  const hookEntry = z.looseObject({ hooks: z.array(hookCommand).optional(), matcher: z.string().optional() });
  // An event name to its entries, the shape of `hooks` in claude's settings and in codex's and grok's hook files.
  const hooksByEvent = z.record(z.string(), z.array(hookEntry));

  return {
    agentFrontmatter: z.looseObject({ description: z.string(), name: z.string() }),
    // Antigravity's file nests flat entries (a command) and matcher entries (handlers) under one `rulesync` key.
    agentsHooks: z.looseObject({
      rulesync: z.record(z.string(), z.array(hookEntry.extend({ command: z.string().optional() }))).optional(),
    }),
    claudeRuleFrontmatter: z.looseObject({ paths: z.array(z.string()).optional() }),
    claudeSettings: z.looseObject({
      enableAllProjectMcpServers: z.boolean().optional(),
      enabledMcpjsonServers: z.array(z.string()).optional(),
      hooks: hooksByEvent.optional(),
      permissions: z.looseObject({ deny: z.array(z.string()).optional() }).optional(),
    }),
    codexHooks: z.looseObject({ hooks: hooksByEvent.optional() }),
    cursorHooks: cursorHooks(),
    mcpServers: z.looseObject({ mcpServers: z.record(z.string(), z.looseObject({})).optional() }),
    // `turbo.json`: loose, since turbo adds keys; it must name its tasks.
    turboConfig: z.looseObject({
      $schema: z.string().optional(),
      globalDependencies: z.array(z.string()).optional(),
      tasks: z.record(z.string(), z.looseObject({})),
    }),
  };
}

// The tool configs are strict at the top: sync writes them whole, and a key the tool does not know is a typo.
function buildOxlintConfig(): OxlintConfig {
  const strings = z.array(z.string());
  const severity = z.enum(["off", "allow", "warn", "error", "deny"]);
  const lintRules = z.record(z.string(), z.union([severity, z.tuple([severity], z.unknown())]));

  return z.strictObject({
    $schema: z.string().optional(),
    categories: z.record(z.string(), severity).optional(),
    env: z.unknown().optional(),
    extends: strings.optional(),
    globals: z.unknown().optional(),
    ignorePatterns: strings.optional(),
    jsPlugins: z.unknown().optional(),
    options: z
      .looseObject({ respectEslintDisableDirectives: z.boolean().optional(), typeAware: z.boolean().optional() })
      .optional(),
    overrides: z.array(z.looseObject({ files: strings, rules: lintRules.optional() })).optional(),
    plugins: strings.optional(),
    rules: lintRules.optional(),
    settings: z.unknown().optional(),
  });
}

/** The oxfmt config's keys from `arrowParens` to `objectWrap`, in its schema's order. */
function oxfmtLayoutKeys() {
  return {
    arrowParens: z.unknown().optional(),
    associations: z.unknown().optional(),
    astro: z.unknown().optional(),
    bracketSameLine: z.unknown().optional(),
    bracketSpacing: z.unknown().optional(),
    embeddedLanguageFormatting: z.unknown().optional(),
    endOfLine: z.unknown().optional(),
    experimentalOperatorPosition: z.unknown().optional(),
    htmlWhitespaceSensitivity: z.unknown().optional(),
    ignorePatterns: z.array(z.string()).optional(),
    insertFinalNewline: z.unknown().optional(),
    jsdoc: z.unknown().optional(),
    jsxSingleQuote: z.unknown().optional(),
    objectWrap: z.unknown().optional(),
  };
}

function buildOxfmtConfig(): OxfmtConfig {
  return z.strictObject({
    ...oxfmtLayoutKeys(),
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
}

/** `.oxlintrc.json`, one key per property of oxlint's shipped `configuration_schema.json`. */
export const OXLINT_CONFIG: OxlintConfig = /* @__PURE__ */ buildOxlintConfig();

/** `.oxfmtrc.jsonc`, one key per property of oxfmt's shipped `configuration_schema.json`. */
export const OXFMT_CONFIG: OxfmtConfig = /* @__PURE__ */ buildOxfmtConfig();

/** The host schemas, built once. */
export const HOST_SCHEMAS: HostSchemas = /* @__PURE__ */ buildHostSchemas();
