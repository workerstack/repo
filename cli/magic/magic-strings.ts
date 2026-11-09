/**
 * Strings compared to a value the type checker leaves untyped: in `===` `!==` `==` `!=` or a `case`, a string literal
 * against a `string`, `any` or `unknown` (a literal union, template literal or branded string passes), and a local
 * `const` copy of one, reported at its declaration. An empty or punctuation-only string passes.
 */
import ts from "typescript";
import { CONSTANTS_FILE, constString, hitAt, isMeaningful } from "./magic-nodes.ts";
import { MAGIC_STRING, type MagicHit } from "./magic-rules.ts";

/** The checker of the program, and whether a file is one the check reports in. */
export type Context = { checker: ts.TypeChecker; owns: (fileName: string) => boolean };

const EQUALITY = [
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
];
const NULLISH = ts.TypeFlags.Null | ts.TypeFlags.Undefined;
const PLAIN = ts.TypeFlags.String | ts.TypeFlags.Any | ts.TypeFlags.Unknown;

const COMPARED = (text: string) =>
  `${JSON.stringify(text)} is compared to a plain string; type the value as a literal union or brand, or import the string from a *.constants.ts file`;
const COPIES = (name: string, text: string) =>
  `${name} copies ${JSON.stringify(text)} locally to compare to a plain string; move it to a *.constants.ts file`;

/** `string`, `any` or `unknown`, alone or in a union beside `null` or `undefined`. */
function isUntyped(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.some((member) => (member.flags & NULLISH) === 0 && isUntyped(member));
  return (type.flags & PLAIN) !== 0;
}

/** Each side of a comparison with the side it is compared to. */
function comparedPairs(node: ts.Node): [ts.Expression, ts.Expression][] {
  if (ts.isBinaryExpression(node) && EQUALITY.includes(node.operatorToken.kind))
    return [
      [node.left, node.right],
      [node.right, node.left],
    ];
  return ts.isCaseClause(node) ? [[node.expression, node.parent.parent.expression]] : [];
}

/** The declaration of the `const` an identifier names, through an import alias; null for anything else. */
function constOf(id: ts.Identifier, checker: ts.TypeChecker): ts.VariableDeclaration | null {
  const symbol = checker.getSymbolAtLocation(id);
  const target =
    symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
  const declaration = target?.valueDeclaration;
  return declaration !== undefined && ts.isVariableDeclaration(declaration) ? declaration : null;
}

/** The hit at a local `const` string the identifier names, outside a constants file; null when it names none. */
function copyHit(id: ts.Identifier, { checker, owns }: Context): MagicHit | null {
  const declaration = constOf(id, checker);
  if (declaration === null) return null;
  const text = constString(declaration);
  const { fileName } = declaration.getSourceFile();
  if (text === null || !owns(fileName) || CONSTANTS_FILE.test(fileName)) return null;
  return hitAt(declaration.name, MAGIC_STRING, COPIES(declaration.name.getText(), text));
}

/** The hit `side` would make compared to a plain string: a literal at itself, a const copy at its declaration. */
function sideHit(side: ts.Expression, context: Context): MagicHit | null {
  if (isMeaningful(side)) return hitAt(side, MAGIC_STRING, COMPARED(side.text));
  return ts.isIdentifier(side) ? copyHit(side, context) : null;
}

/** Every magic string of `file`; a copy's hit is at its declaration, which `owns` must own. */
export function magicStrings(file: ts.SourceFile, context: Context): MagicHit[] {
  const hits: MagicHit[] = [];
  const visit = (node: ts.Node): void => {
    for (const [side, other] of comparedPairs(node)) {
      const found = sideHit(side, context);
      if (found !== null && isUntyped(context.checker.getTypeAtLocation(other))) hits.push(found);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}
