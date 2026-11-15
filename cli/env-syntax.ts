/**
 * What the defineEnv readers (repo check's env lines and `bun repo env`) take from a source file oxc-parser read: the
 * parsed file, an expression with its type wrappers taken off, a key's or a literal's text, the top-level variable
 * declarations and every defineEnv call with the name it is bound to.
 */
import {
  parseSync,
  Visitor,
  type Argument,
  type BindingPattern,
  type CallExpression,
  type Comment,
  type Expression,
  type ModuleExportName,
  type ObjectProperty,
  type ObjectPropertyKind,
  type Program,
  type PropertyKey,
  type VariableDeclaration,
} from "oxc-parser";

import { DEFINE_ENV } from "./check-env-values.constants.ts";
import { isStringLiteral } from "./syntax-node.ts";

/** A source file as oxc read it: its repo-relative name, text, program, comments, and whether it failed to parse. */
export type Source = {
  readonly rel: string;
  readonly text: string;
  readonly program: Program;
  readonly comments: readonly Comment[];
  readonly isBroken: boolean;
};

/** A defineEnv call and the name `const <name> = defineEnv(…)` binds it to; empty when it is bound to none. */
export type DefineCall = { readonly call: CallExpression; readonly binding: string };

/** `text` of `rel`, parsed as its extension says. */
export function sourceOf(rel: string, text: string): Source {
  const { comments, errors, program } = parseSync(rel, text);

  return { comments, isBroken: errors.length > 0, program, rel, text };
}

/** `node` with every `as`, `satisfies` and pair of parentheses around it taken off; a spread stays as it is. */
export function unwrapped(node: Argument): Argument {
  const isWrapper =
    node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression" || node.type === "ParenthesizedExpression";

  return isWrapper ? unwrapped(node.expression) : node;
}

/** The name an identifier or a string literal spells; undefined for a pattern or any other key. */
export function nameOf(node: PropertyKey | BindingPattern | ModuleExportName): string | undefined {
  if (node.type === "Identifier") return node.name;

  return node.type === "Literal" && isStringLiteral(node) ? node.value : undefined;
}

/** The plain name of an object member's key; undefined for a spread, a computed key or a number. */
export function keyName(member: ObjectPropertyKind): string | undefined {
  return member.type === "Property" && !member.computed ? nameOf(member.key) : undefined;
}

/** True for a `key: value` member: not a spread, a method, an accessor or a shorthand. */
export function isAssignment(member: ObjectPropertyKind): member is ObjectProperty {
  return member.type === "Property" && member.kind === "init" && !member.method && !member.shorthand;
}

/** The string a literal holds, a template with no expressions included; undefined for any other expression. */
export function stringOf(node: Expression): string | undefined {
  if (node.type === "TemplateLiteral")
    return node.expressions.length === 0 ? node.quasis.map((quasi) => quasi.value.cooked).join("") : undefined;

  return node.type === "Literal" && isStringLiteral(node) ? node.value : undefined;
}

/** The variable declarations at the top of `program`, an exported one included. */
export function topDeclarations(program: Program): VariableDeclaration[] {
  return program.body.flatMap((statement) => {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;

    return declaration?.type === "VariableDeclaration" ? [declaration] : [];
  });
}

/** Every defineEnv call of `program` in source order, outermost first, each with the name it is bound to. */
export function defineCalls(program: Program): DefineCall[] {
  const calls: CallExpression[] = [];
  const bindings = new Map<Expression, string>();

  new Visitor({
    CallExpression(node) {
      if (node.callee.type === "Identifier" && node.callee.name === DEFINE_ENV) calls.push(node);
    },
    VariableDeclarator(node) {
      if (node.init !== null) bindings.set(node.init, nameOf(node.id) ?? "");
    },
  }).visit(program);

  return calls.map((call) => ({ binding: bindings.get(call) ?? "", call }));
}
