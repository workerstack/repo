import fs from "node:fs";
import path from "node:path";

import {
  Visitor,
  type Argument,
  type Expression,
  type IdentifierReference,
  type ImportDeclaration,
  type ObjectExpression,
  type ObjectProperty,
  type Program,
} from "oxc-parser";

import {
  DEFINE_ENV_CALL,
  PROCESS_BLOCK,
  SCANNED_EXTENSIONS,
  SCOPE_BLOCKS,
  sealHint,
  VALUE_BLOCKS,
} from "./check-env-values.constants.ts";
import {
  defineCalls,
  isAssignment,
  keyName,
  nameOf,
  sourceOf,
  stringOf,
  topDeclarations,
  unwrapped,
  type Source,
} from "./env-syntax.ts";
import { ENV_PROPERTY } from "./env.constants.ts";
import { FIXTURES_DIR } from "./fixtures.constants.ts";
import { listFiles } from "./list-files.ts";
import { secretReason } from "./secret-reason.ts";
import { isTestFile } from "./test-files.ts";

/** Modules whose `env` export is the process environment, as env-in-config reads them. */
const ENV_MODULES: readonly string[] = ["process", "node:process", "cloudflare:workers"];

/** Globals that carry the environment as `.env`. */
const ENV_GLOBALS: readonly string[] = ["process", "Bun"];

/** The object literal blocks of a defineEnv call, by block name. */
type Blocks = ReadonlyMap<string | undefined, ObjectExpression>;

/** A block of a defineEnv call: its literal keys in order, and whether a spread hides more. */
type Block = { readonly keys: readonly string[]; readonly hasSpread: boolean };

/** The initializer of the top-level `const <name>` of the file, or `name` itself when no such const holds one. */
function constValue(program: Program, name: IdentifierReference): Expression {
  const declarations = topDeclarations(program)
    .filter((statement) => statement.kind === "const")
    .flatMap((statement) => statement.declarations);

  return declarations.find((declaration) => nameOf(declaration.id) === name.name)?.init ?? name;
}

/** The config a defineEnv call is given, inline or by the name of a same-file const, unwrapped. */
function configOf(program: Program, argument: Argument): Argument {
  return unwrapped(argument.type === "Identifier" ? constValue(program, argument) : argument);
}

/** The object literal blocks of a defineEnv call, by block name; a block held in a variable is not read. */
function blocksOf(program: Program, call: Argument[]): Map<string | undefined, ObjectExpression> {
  const members = call
    .slice(0, 1)
    .map((argument) => configOf(program, argument))
    .flatMap((config) => (config.type === "ObjectExpression" ? config.properties.filter(isAssignment) : []));

  const blocks = new Map<string | undefined, ObjectExpression>();

  for (const member of members) if (member.value.type === "ObjectExpression") blocks.set(keyName(member), member.value);

  return blocks;
}

/** The literal keys of a block, and whether it spreads another object. */
function blockOf(node: ObjectExpression): Block {
  const keys: string[] = [];
  let hasSpread = false;

  for (const member of node.properties) {
    const name = keyName(member);

    if (name === undefined) hasSpread = true;
    else keys.push(name);
  }

  return { hasSpread, keys };
}

/** A member's key as the file spells it: quotes kept, and a computed key in its brackets. */
function keyText({ text }: Source, member: ObjectProperty): string {
  const { key } = member;

  return member.computed ? text.slice(member.start, text.indexOf("]", key.end) + 1) : text.slice(key.start, key.end);
}

/** One line per plain value of a value block that looks like a secret. */
function secretLines(source: Source, blocks: Blocks): string[] {
  const lines: string[] = [];

  for (const scope of VALUE_BLOCKS) {
    for (const member of blocks.get(scope)?.properties.filter(isAssignment) ?? []) {
      const key = keyText(source, member);
      const value = stringOf(member.value);
      const reason = value === undefined ? null : secretReason(key, value);

      if (reason === null) continue;
      const fix = sealHint(key, scope);
      lines.push(`env: ${source.rel} ${scope}.${key} looks like a secret (${reason}) but is plain; ${fix}`);
    }
  }

  return lines;
}

/** One line per key a scope block lacks that another holds; blocks with a spread or no key take no part. */
function missingLines(rel: string, blocks: Blocks): string[] {
  const scopes = SCOPE_BLOCKS.flatMap((scope) => {
    const node = blocks.get(scope);
    const block = node === undefined ? undefined : blockOf(node);

    return block === undefined || block.hasSpread || block.keys.length === 0 ? [] : [{ keys: block.keys, scope }];
  });

  const lines: string[] = [];

  for (const { scope, keys } of scopes) {
    for (const other of scopes) {
      const fix = `add it to ${scope} or remove it from ${other.scope}`;

      for (const key of other.keys.filter((name) => !keys.includes(name)))
        lines.push(`env: ${rel} ${scope}.${key} is missing (${other.scope} has it); ${fix}`);
    }
  }

  return lines;
}

/** The local names one import binds to the `env` of a process module. */
function envImportNames(statement: ImportDeclaration): string[] {
  if (!ENV_MODULES.includes(statement.source.value)) return [];

  return statement.specifiers.flatMap((specifier) =>
    specifier.type === "ImportSpecifier" && nameOf(specifier.imported) === ENV_PROPERTY ? [specifier.local.name] : [],
  );
}

/** The local names an `import { env } from "process"` binds. */
function envImports(program: Program): Set<string> {
  return new Set(
    program.body.flatMap((statement) => (statement.type === "ImportDeclaration" ? envImportNames(statement) : [])),
  );
}

/** How a read names the environment it reads (`process.env`, `env`), or undefined when it is not one. */
function envOwner(node: Expression, imported: ReadonlySet<string>): string | undefined {
  if (node.type === "Identifier") return imported.has(node.name) ? node.name : undefined;

  const isEnv = node.type === "MemberExpression" && !node.computed && nameOf(node.property) === ENV_PROPERTY;

  if (!isEnv) return undefined;
  const owner = node.object;

  if (owner.type === "Identifier" && ENV_GLOBALS.includes(owner.name)) return `${owner.name}.${ENV_PROPERTY}`;

  return owner.type === "MetaProperty" ? `import.meta.${ENV_PROPERTY}` : undefined;
}

/** A named read of the environment: the variable and the text a line shows for it. */
type Read = { readonly key: string; readonly label: string };

/** The named reads of `program`, in source order: `owner.KEY`, `owner["KEY"]` and `const { KEY } = owner`. */
function readsOf(program: Program): Read[] {
  const imported = envImports(program);
  const reads: Read[] = [];

  function add(owner: string | undefined, key: string | undefined): void {
    if (owner !== undefined && key !== undefined) reads.push({ key, label: `${owner}.${key}` });
  }

  new Visitor({
    MemberExpression(node) {
      const key = node.computed ? stringOf(node.property) : nameOf(node.property);
      add(envOwner(node.object, imported), key);
    },
    VariableDeclarator(node) {
      if (node.id.type !== "ObjectPattern" || node.init === null) return;
      const owner = envOwner(node.init, imported);

      for (const element of node.id.properties)
        add(owner, element.type === "Property" && !element.computed ? nameOf(element.key) : undefined);
    },
  }).visit(program);

  return reads;
}

/** One line per variable the file reads by name that no process block declares, once each. */
function processLines(source: Source, declared: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const { key, label } of readsOf(source.program)) {
    if (declared.has(key) || seen.has(key)) continue;
    seen.add(key);
    lines.push(
      `env: ${source.rel} reads ${label} but its process block does not declare it; add \`${key}: "optional"\``,
    );
  }

  return lines;
}

/** The lines of one defineEnv file: plaintext secrets, keys a scope lacks, then undeclared process reads. */
function fileLines(rel: string, text: string): string[] {
  const source = sourceOf(rel, text);
  const declared = new Set<string>();
  const lines: string[] = [];

  for (const { call } of defineCalls(source.program)) {
    const blocks = blocksOf(source.program, call.arguments);
    lines.push(...secretLines(source, blocks), ...missingLines(rel, blocks));
    const processBlock = blocks.get(PROCESS_BLOCK);

    for (const key of processBlock === undefined ? [] : blockOf(processBlock).keys) declared.add(key);
  }

  return [...lines, ...processLines(source, declared)];
}

/** True for a file the check reads: a source of a scanned extension, not a test and not under `__fixtures__`. */
function isScanned(rel: string): boolean {
  return (
    SCANNED_EXTENSIONS.includes(path.posix.extname(rel)) && !isTestFile(rel) && !rel.split("/").includes(FIXTURES_DIR)
  );
}

/**
 * One line per problem in each listed file that calls `defineEnv(`: a plain value that looks like a secret, a key one
 * scope block holds and another lacks, and a process read its process block does not declare.
 */
export function checkEnvValues(cwd: string): string[] {
  return listFiles(cwd)
    .filter(isScanned)
    .flatMap((rel) => {
      const file = path.join(cwd, rel);

      // A tracked file deleted and not yet staged is still listed.
      if (!fs.existsSync(file)) return [];
      const text = fs.readFileSync(file, "utf8");

      return text.includes(DEFINE_ENV_CALL) ? fileLines(rel, text) : [];
    });
}
