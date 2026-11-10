import type { Context, CreateRule, ESTree } from "@oxlint/plugins";
import { FAULTS, FORMS, NODE_TYPES, UNKNOWN_FAULT } from "./public-jsdoc.constants.ts";
import { check, type Source, visitorOf, type Walk } from "./public-jsdoc.members.ts";
import { statesItsType } from "./states-its-type.ts";
import { declarationOf, declaredNames, get, nodesOf, walkPublic } from "./public-surface.syntax.ts";
import { packageRoot, publicSurface, type Surface } from "./public-surface.ts";
import type { Node } from "./public-surface.types.ts";

/** A node the walk read, as the ESTree node oxlint gave it. */
const estree = (node: Node): ESTree.Node =>
  node /* oxlint's own nodes */ as unknown /* the walk only reads them */ as ESTree.Node;

/** One file being checked: the names a public entry reaches in it, and how to report on a node. */
type File = {
  source: Source;
  names: Map<string, string>;
  signed: Set<string>;
  report: (node: Node, message: string) => void;
};
/** A reached declaration: its `statement`, the `declaration` inside it and its `name` and `entry`. */
type Found = { statement: Node; declaration: Node; name: string; entry: string };

/** The names declared as overload signatures (`function f(): void;`), whose implementation carries no doc. */
function signedNames(body: Node[]): Set<string> {
  const signed = new Set<string>();
  for (const statement of body) {
    const declaration = declarationOf(statement);
    if (get(declaration, "type") === NODE_TYPES.signature) signed.add(String(get(get(declaration, "id"), "name")));
  }
  return signed;
}

function checkDeclaration(file: File, found: Found): void {
  const { statement, declaration, name, entry } = found;
  const walk: Walk = {
    source: file.source,
    owner: name,
    fail: (node, label, text) => file.report(node, `\`${label}\` is public through "${entry}" and ${text}`),
  };
  const isFunction = declaration["type"] === NODE_TYPES.functionDeclaration;
  if (isFunction && file.signed.has(name)) return;
  const variable = nodesOf(declaration["declarations"]).find((item) => get(item["id"], "name") === name);
  check(walk, statement, { label: name, name });
  const untyped = variable !== undefined && !get(variable["id"], "typeAnnotation") && !statesItsType(variable["init"]);
  if (untyped || (isFunction && !declaration["returnType"])) walk.fail(statement, name, FAULTS.inferred);
  walkPublic(variable ?? declaration, visitorOf(walk));
}

function checkFile(file: File, body: Node[]): void {
  for (const statement of body) {
    const declaration = declarationOf(statement);
    if (declaration === null) continue;
    for (const name of declaredNames(statement)) {
      const entry = file.names.get(name);
      if (entry !== undefined) checkDeclaration(file, { statement, declaration, name, entry });
    }
  }
}

/** The message for a form the walk could not follow. */
const unknownMessage = (form: string): string => `cannot follow ${FORMS[form] ?? `\`${form}\``} ${UNKNOWN_FAULT}`;

/** Reports what is wrong in the file `context` lints, given the surface of its package. */
function checkProgram(context: Context, surface: Surface, program: ESTree.Program): void {
  const { sourceCode } = context;
  const source: Source = { text: sourceCode.text, before: (node) => sourceCode.getCommentsBefore(estree(node)) };
  const report = (node: Node, message: string): void => context.report({ message, node: estree(node) });
  for (const found of surface.unknown) {
    if (found.file !== context.filename) continue;
    const at = { line: found.line, column: 0 };
    context.report({ message: unknownMessage(found.form), loc: { start: at, end: at } });
  }
  const names = surface.names.get(context.filename);
  const body = nodesOf(program.body);
  if (names !== undefined) checkFile({ source, names, signed: signedNames(body), report }, body);
}

/** The rule, with the surfaces it has read held in a closure: one read per package per lint run, no module state. */
function makeRule(): CreateRule {
  const surfaces = new Map<string, Surface>();
  const surfaceOf = (root: string): Surface => {
    const known = surfaces.get(root);
    if (known !== undefined) return known;
    const read = publicSurface(root);
    surfaces.set(root, read);
    return read;
  };
  return {
    create(context) {
      const root = packageRoot(context.filename);
      if (root === null) return {};
      const surface = surfaceOf(root);
      return { Program: (program) => checkProgram(context, surface, program) };
    },
  };
}

/**
 * Requires a written doc on everything a public package's `exports` reach: each declaration and each member a consumer
 * can see, with its type written out, no restated name, no internal reference, and the doc on its own line. A form
 * the walk cannot follow is reported, since what it exposes goes unchecked.
 */
export const publicJsdoc: CreateRule = /* @__PURE__ */ makeRule();
