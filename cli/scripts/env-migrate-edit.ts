/**
 * The pure rewrite behind `bun repo env migrate`: text in, text and counts out. Each createScriptEnv call whose name
 * comes from one of `packages` becomes defineEnv (env-migrate-call.ts); a `secret("v")` and a plain literal
 * secretReason flags become `sealed("<cipher>")`, other values stay. `secretKeysOf(x, s)` (or of `x.<scope>`) becomes
 * `x.sealedKeys(s)` and `unwrapSecrets(x)` becomes `x`, helpers nested in their arguments too. The imports change as
 * env-migrate-imports.ts says. Every other byte is kept.
 */
import ts from "typescript";

import { secretReason } from "../secret-reason.ts";
import { KEYS_OF, OLD_CALL, PREFIX, SCOPES, SEALED_NAME, SEALED_TYPE, UNWRAP } from "./env-command.constants.ts";
import { sourceOf } from "./env-files.ts";
import { callEdits, isTyped } from "./env-migrate-call.ts";
import { importEdits } from "./env-migrate-imports.ts";
import {
  applied,
  calleeOf,
  configBlocks,
  importsFrom,
  lineOf,
  literalsOf,
  outermost,
  secretArgument,
  type Edit,
  type Imports,
  type OldPackage,
} from "./env-migrate-source.ts";

/** What the rewrite takes: the file as a refusal names it, its tsconfig, the seal, and the old modules. */
export type MigrateOptions = {
  readonly file: string;
  readonly isolated: boolean;
  readonly seal: (value: string) => Promise<string>;
  readonly packages: readonly OldPackage[];
};

/** What a file's createScriptEnv calls held: values, secret() sealed, flagged keys sealed, kept values, spreads. */
type MigrateCounts = {
  values: number;
  secrets: number;
  credentials: string[];
  plain: number;
  spreads: Record<string, number>;
};

/** A helper call rewritten: its 1-based line and the old name. */
type HelperSite = { line: number; name: "secretKeysOf" | "unwrapSecrets" };

/** The file rewritten, what it held, and its helper sites. */
export type Migrated = { text: string; counts: MigrateCounts; helpers: HelperSite[] };

/** What a walk of the file found: the calls, values to seal, helper edits, and the old names still used. */
type Walk = {
  readonly calls: ts.CallExpression[];
  readonly edits: Edit[];
  readonly helpers: HelperSite[];
  readonly pending: { readonly node: ts.Node; readonly value: string }[];
  readonly skipped: Set<ts.Node>;
  readonly secretNames: ReadonlySet<string>;
  readonly spreads: string[];
  readonly used: Set<string>;
  readonly values: { readonly kind: "secret" | "credential" | "plain"; readonly key: string }[];
};

const HELPER_NAMES: readonly HelperSite["name"][] = [KEYS_OF, UNWRAP];

/** Records one block value: a secret() or a flagged literal queued to seal, anything else kept. */
function countValue(walk: Walk, imports: Imports, at: { block: string; key: string; value: ts.Node }): void {
  const { block, key, value } = at;
  // A name the file binds to a secret() is as opaque as a secret() of one.
  const name = ts.isShorthandPropertyAssignment(value) ? value.name.text : value.getText();
  const argument = walk.secretNames.has(name) ? [] : secretArgument(value, imports);

  if (argument !== undefined) {
    const [text] = literalsOf(argument);

    if (text === undefined) {
      const fix = "seal it by hand with `bun repo env set`";
      throw new Error(`${PREFIX}${imports.file} ${block}.${key} is secret(<non-literal>); ${fix}`);
    }

    walk.skipped.add(value);
    walk.pending.push({ node: value, value: text });
    walk.values.push({ key, kind: "secret" });

    return;
  }

  const flagged = literalsOf([value]).filter((text) => secretReason(key, text) !== null);

  for (const text of flagged) walk.pending.push({ node: value, value: text });
  walk.values.push({ key, kind: flagged.length > 0 ? "credential" : "plain" });
}

/** `node`, as `text`, the target of a member access: parenthesized unless it already binds tighter. */
function wrapped(node: ts.Node, text: string): string {
  return ts.isLeftHandSideExpression(node) ? text : `(${text})`;
}

/** The env a secretKeysOf target names: `x` of `x.prod`, the scope it was read at being the call's own argument. */
function scopeless(node: ts.Node): ts.Node {
  return ts.isPropertyAccessExpression(node) && SCOPES.includes(node.name.text) ? node.expression : node;
}

/** The text of `node` with the helper calls inside it rewritten. */
function rewrittenText(walk: Walk, imports: Imports, node: ts.Node): string {
  const inner: Walk = { ...walk, edits: [] };
  visit(inner, imports, node);
  const start = node.getStart();
  const shifted = inner.edits.map((edit) => ({ ...edit, end: edit.end - start, start: edit.start - start }));

  return applied(node.getText(), shifted);
}

/** Records a helper call and the edit that rewrites it, the helpers inside its arguments rewritten first. */
function visitHelper(walk: Walk, imports: Imports, at: { call: ts.CallExpression; name: HelperSite["name"] }): void {
  const { call, name } = at;
  walk.helpers.push({ line: lineOf(call), name });
  const targets = call.arguments.slice(0, 1).map((node) => (name === KEYS_OF ? scopeless(node) : node));
  const target = targets.map((node) => wrapped(node, rewrittenText(walk, imports, node))).join("");
  const rest = call.arguments.slice(1).map((node) => rewrittenText(walk, imports, node));
  const insert = name === KEYS_OF ? `${target}.sealedKeys(${rest.join(", ")})` : target;
  walk.edits.push({ end: call.end, insert, start: call.getStart() });
}

/** Walks `node`: calls of the old names recorded, every other use of an old name kept in `used`. */
function visit(walk: Walk, imports: Imports, node: ts.Node): void {
  if (ts.isImportDeclaration(node) || walk.skipped.has(node)) return;

  if (ts.isCallExpression(node) && visitCall(walk, imports, node)) return;

  if (ts.isIdentifier(node) && imports.locals.has(node.text)) walk.used.add(node.text);
  ts.forEachChild(node, (child) => {
    visit(walk, imports, child);
  });
}

/** Records `call` when it calls createScriptEnv or a helper; whether it did. */
function visitCall(walk: Walk, imports: Imports, call: ts.CallExpression): boolean {
  const callee = calleeOf(call, imports);
  const helper = HELPER_NAMES.find((name) => name === callee);

  if (helper !== undefined) {
    visitHelper(walk, imports, { call, name: helper });

    return true;
  }

  if (callee !== OLD_CALL) return false;
  walk.calls.push(call);

  for (const { block, members } of configBlocks(call)) {
    for (const member of members) {
      if (member.spread) walk.spreads.push(block);
      else countValue(walk, imports, { block, key: member.key, value: member.value });
    }
  }

  for (const argument of call.arguments) visit(walk, imports, argument);

  return true;
}

/** What the walk counted. */
function countsOf(walk: Walk): MigrateCounts {
  function of(kind: string): string[] {
    return walk.values.filter((value) => value.kind === kind).map(({ key }) => key);
  }

  const spreads = [...new Set(walk.spreads)].map((block): [string, number] => [
    block,
    walk.spreads.filter((at) => at === block).length,
  ]);

  return {
    credentials: of("credential"),
    plain: of("plain").length,
    secrets: of("secret").length,
    spreads: Object.fromEntries(spreads),
    values: walk.values.length,
  };
}

/** The edits that seal each queued value, each sealed once. */
async function sealEdits(walk: Walk, { isolated, seal }: MigrateOptions): Promise<Edit[]> {
  const ciphers = await Promise.all(walk.pending.map(({ value }) => seal(value)));
  // isolatedDeclarations cannot infer a call's type in a const config: each seal is cast.
  const cast = isolated ? ` as ${SEALED_TYPE}` : "";

  return walk.pending.map(({ node }, index): Edit => {
    const insert = `${SEALED_NAME}(${JSON.stringify(ciphers[index])})${cast}`;

    return { end: node.end, insert, start: node.getStart() };
  });
}

/** Every name `source` spells (what an isolated config's name must not take), and the names it binds to a secret(). */
function namesOf(source: ts.SourceFile, imports: Imports): { all: Set<string>; secrets: Set<string> } {
  const all = new Set<string>();
  const secrets = new Set<string>();

  function visitNames(node: ts.Node): void {
    if (ts.isIdentifier(node)) all.add(node.text);

    if (secretArgument(node, imports) !== undefined)
      for (const bound of [outermost(node).parent].filter(ts.isVariableDeclaration)) secrets.add(bound.name.getText());

    ts.forEachChild(node, visitNames);
  }

  visitNames(source);

  return { all, secrets };
}

/** `text` migrated; see the file comment. Rejects with the refusal of a secret() of anything but a string literal. */
export async function migrateSource(text: string, options: MigrateOptions): Promise<Migrated> {
  const source = sourceOf(options.file, text);
  const imports = importsFrom(source, options.packages);
  const names = namesOf(source, imports);

  const walk: Walk = {
    calls: [],
    edits: [],
    helpers: [],
    pending: [],
    secretNames: names.secrets,
    skipped: new Set(),
    spreads: [],
    used: new Set(),
    values: [],
  };

  visit(walk, imports, source);

  if (walk.calls.length + walk.helpers.length === 0) return { counts: countsOf(walk), helpers: [], text };
  const seals = await sealEdits(walk, options);
  const at = { file: options.file, isolated: options.isolated, taken: names.all };
  const rewrites = walk.calls.flatMap((call) => callEdits(text, call, at));
  const typed = walk.calls.some((call) => isTyped(call, options));
  const named = { isolated: options.isolated, sealed: seals.length > 0, typed };
  const change = { called: walk.calls.length > 0, named, used: walk.used };
  const all = [...walk.edits, ...seals, ...rewrites, ...importEdits(text, imports, change)];

  return { counts: countsOf(walk), helpers: walk.helpers, text: applied(text, all) };
}
