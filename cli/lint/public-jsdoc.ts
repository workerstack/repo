import { ESLintUtils, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { asNode, type SyntaxNode, textOf } from "../syntax-node.ts";
import { FAULTS, FORMS, NODE_TYPES, UNKNOWN_FAULT } from "./public-jsdoc.constants.ts";
import { check, type Source, visitorOf, type Walk } from "./public-jsdoc.members.ts";
import { declarationOf, declaredNames, get, nodesOf, walkPublic } from "./public-surface.syntax.ts";
import { packageRoot, publicSurface, type Surface } from "./public-surface.ts";
import type { RepoRule } from "./rule.types.ts";
import { statesItsType } from "./states-its-type.ts";

type MessageId = "fault" | "unknown";

type Context = TSESLint.RuleContext<MessageId, []>;

/** Whether a node the walk read is one the linter built, as every node under the program it hands a rule is. */
function isLinted(node: SyntaxNode): node is SyntaxNode & TSESTree.Node {
  return Array.isArray(node["range"]);
}

/** The node as the linter built it, as every node the walk reads is; throws on one that is not, a broken invariant. */
function linted(node: SyntaxNode): TSESTree.Node {
  return ESLintUtils.nullThrows([node].find(isLinted), "the walk reads only nodes the linter built");
}

/** One file being checked: the names a public entry reaches in it, and how to report a fault on a node. */
type File = {
  source: Source;
  names: Map<string, string>;
  signed: Set<string>;
  report: (node: SyntaxNode, data: { label: string; entry: string; fault: string }) => void;
};

/** A reached declaration: its `statement`, the `declaration` inside it and its `name` and `entry`. */
type Found = { statement: SyntaxNode; declaration: SyntaxNode; name: string; entry: string };

/** The names declared as overload signatures (`function f(): void;`), whose implementation carries no doc. */
function signedNames(body: SyntaxNode[]): Set<string> {
  const signed = new Set<string>();

  for (const statement of body) {
    const declaration = declarationOf(statement);

    if (get(declaration, "type") === NODE_TYPES.signature) signed.add(textOf(get(get(declaration, "id"), "name")));
  }

  return signed;
}

function checkDeclaration(file: File, found: Found): void {
  const { statement, declaration, name, entry } = found;

  const walk: Walk = {
    fail: (node, label, fault) => file.report(node, { entry, fault, label }),
    owner: name,
    source: file.source,
  };

  const isFunction = declaration["type"] === NODE_TYPES.functionDeclaration;

  if (isFunction && file.signed.has(name)) return;
  const variable = nodesOf(declaration["declarations"]).find((item) => get(item["id"], "name") === name);
  check(walk, statement, { label: name, name });
  const isAnnotated = asNode(get(variable?.["id"], "typeAnnotation")) !== null;
  const untyped = variable !== undefined && !isAnnotated && !statesItsType(variable["init"]);

  const isUntypedFunction = isFunction && asNode(declaration["returnType"]) === null;

  if (untyped || isUntypedFunction) walk.fail(statement, name, FAULTS.inferred);
  walkPublic(variable ?? declaration, visitorOf(walk));
}

function checkFile(file: File, body: SyntaxNode[]): void {
  for (const statement of body) {
    const declaration = declarationOf(statement);

    if (declaration === null) continue;

    for (const name of declaredNames(statement)) {
      const entry = file.names.get(name);

      if (entry !== undefined) checkDeclaration(file, { declaration, entry, name, statement });
    }
  }
}

/** How a message names a form the walk could not follow. */
function formOf(form: string): string {
  return FORMS[form] ?? `\`${form}\``;
}

/** Reports what is wrong in the file `context` lints, given the surface of its package. */
function checkProgram(context: Context, surface: Surface, program: TSESTree.Program): void {
  const { sourceCode } = context;

  const source: Source = {
    before: (node) => sourceCode.getCommentsBefore(linted(node)),
    text: sourceCode.text,
  };

  function report(node: SyntaxNode, data: Parameters<File["report"]>[1]): void {
    context.report({ data, messageId: "fault", node: linted(node) });
  }

  for (const found of surface.unknown) {
    if (found.file !== context.filename) continue;
    const at = { column: 0, line: found.line };
    context.report({ data: { form: formOf(found.form) }, loc: { end: at, start: at }, messageId: "unknown" });
  }

  const names = surface.names.get(context.filename);
  const body = nodesOf(program.body);

  if (names !== undefined) checkFile({ names, report, signed: signedNames(body), source }, body);
}

/** The rule, with the surfaces it has read held in a closure: one read per package per lint run, no module state. */
function makeRule(): RepoRule<MessageId> {
  const surfaces = new Map<string, Surface>();

  function surfaceOf(root: string): Surface {
    const known = surfaces.get(root);

    if (known !== undefined) return known;
    const read = publicSurface(root);
    surfaces.set(root, read);

    return read;
  }

  return {
    create(context) {
      const root = packageRoot(context.filename);

      if (root === null) return {};
      const surface = surfaceOf(root);

      return { Program: (program) => checkProgram(context, surface, program) };
    },
    defaultOptions: [],
    meta: {
      messages: {
        fault: '`{{label}}` is public through "{{entry}}" and {{fault}}',
        unknown: `cannot follow {{form}} ${UNKNOWN_FAULT}`,
      },
      schema: [],
      type: "problem",
    },
  };
}

/**
 * Requires a written doc on everything a public package's `exports` reach: each declaration and each member a consumer
 * can see, with its type written out, no restated name, no internal reference, and the doc on its own line. A form
 * the walk cannot follow is reported, since what it exposes goes unchecked.
 */
export const publicJsdoc: RepoRule<MessageId> = /* @__PURE__ */ makeRule();
