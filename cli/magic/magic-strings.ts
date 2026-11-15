/**
 * Strings compared to a value the type checker leaves untyped: in `===` `!==` `==` `!=` or a `case`, a string literal
 * against a `string`, `any` or `unknown` (a literal union, template literal or branded string passes), and a local
 * `const` copy of one, reported at its declaration. An empty or punctuation-only string passes.
 */
import { SyntaxKind } from "typescript/unstable/ast";
import type { Expression, Identifier, Node, SourceFile, StringLiteralLikeNode } from "typescript/unstable/ast";
import {
  isBinaryExpression,
  isCaseClause,
  isIdentifier,
  isSwitchStatement,
  isVariableDeclaration,
} from "typescript/unstable/ast/is";
import { isUnionType, SymbolFlags, TypeFlags, type Project, type Type } from "typescript/unstable/async";

import { MAGIC_STRING } from "../script-rules.ts";
import type { MagicHit } from "./magic-hit.ts";
import { CONSTANTS_FILE, constString, hitAt, isMeaningful } from "./magic-nodes.ts";

/** The project the files are read in, and whether a file is one the check reports in. */
export type Context = { project: Project; owns: (fileName: string) => boolean };

/** One side of a comparison, and the side it is compared to. */
type Pair = { side: Expression; other: Expression };

/** A side that could hit: a meaningful string literal, or a name that could copy one. */
type Candidate = { side: Identifier | StringLiteralLikeNode; other: Expression };

const EQUALITY = [
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
];

const NULLISH = TypeFlags.Null | TypeFlags.Undefined;
const PLAIN = TypeFlags.String | TypeFlags.Any | TypeFlags.Unknown;

function compared(text: string) {
  return (
    `${JSON.stringify(text)} is compared to a plain string; ` +
    "type the value as a literal union or brand, or import the string from a *.constants.ts file"
  );
}

function copies(name: string, text: string) {
  const quoted = JSON.stringify(text);

  return `${name} copies ${quoted} locally to compare to a plain string; move it to a *.constants.ts file`;
}

/** `string`, `any` or `unknown`, alone or in a union beside `null` or `undefined`. */
async function isUntyped(type: Type): Promise<boolean> {
  if (!isUnionType(type)) return (type.flags & PLAIN) !== 0;

  for (const member of await type.getTypes())
    if ((member.flags & NULLISH) === 0 && (await isUntyped(member))) return true;

  return false;
}

/** Each side of a comparison with the side it is compared to; a `case` is compared to its switch's expression. */
function comparedPairs(node: Node): Pair[] {
  if (isBinaryExpression(node) && EQUALITY.includes(node.operatorToken.kind)) {
    return [
      { other: node.right, side: node.left },
      { other: node.left, side: node.right },
    ];
  }

  if (!isSwitchStatement(node)) return [];

  return node.caseBlock.clauses
    .filter(isCaseClause)
    .map((clause) => ({ other: node.expression, side: clause.expression }));
}

function isCandidate(pair: Pair): pair is Candidate {
  return isMeaningful(pair.side) || isIdentifier(pair.side);
}

/** The hit at a local `const` string the identifier names, outside a constants file; null when it names none. */
async function copyHit(id: Identifier, { owns, project }: Context): Promise<MagicHit | null> {
  const { checker } = project;
  const symbol = await checker.getSymbolAtLocation(id);
  const aliased = symbol !== undefined && (symbol.flags & SymbolFlags.Alias) !== 0;
  const target = aliased ? await checker.getAliasedSymbol(symbol) : symbol;
  const declaration = await target?.valueDeclaration?.resolve(project);

  if (declaration === undefined || !isVariableDeclaration(declaration)) return null;
  const text = constString(declaration);
  const { fileName } = declaration.getSourceFile();

  if (text === null || !owns(fileName) || CONSTANTS_FILE.test(fileName)) return null;

  return hitAt(declaration.name, MAGIC_STRING, copies(declaration.name.getText(), text));
}

/** The hit `side` would make compared to a plain string: a literal at itself, a const copy at its declaration. */
async function sideHit(side: Candidate["side"], context: Context): Promise<MagicHit | null> {
  return isIdentifier(side) ? await copyHit(side, context) : hitAt(side, MAGIC_STRING, compared(side.text));
}

/** Every magic string of `file`; a copy's hit is at its declaration, which `context.owns` must own. */
export async function magicStrings(file: SourceFile, context: Context): Promise<MagicHit[]> {
  const pairs: Candidate[] = [];

  function visit(node: Node): void {
    pairs.push(...comparedPairs(node).filter(isCandidate));
    node.forEachChild(visit);
  }

  visit(file);

  if (pairs.length === 0) return [];
  const others = await context.project.checker.getTypeAtLocation(pairs.map(({ other }) => other));
  const hits: MagicHit[] = [];

  for (const [index, { side }] of pairs.entries()) {
    const other = others[index];

    if (other === undefined || !(await isUntyped(other))) continue;
    const found = await sideHit(side, context);

    if (found !== null) hits.push(found);
  }

  return hits;
}
