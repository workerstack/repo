import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

/** A top-level statement of a module. */
export type Statement = TSESTree.ProgramStatement;

type Declaration = NonNullable<TSESTree.ExportNamedDeclaration["declaration"]>;

/** The patterns nested one level inside `pattern`: `{ a, b: [c] }` → a, [c]; a name or a hole (`[, a]`) nests none. */
function innerPatterns(pattern: TSESTree.Node | null): (TSESTree.Node | null)[] {
  if (pattern?.type === AST_NODE_TYPES.ObjectPattern) {
    return pattern.properties.map((property) =>
      property.type === AST_NODE_TYPES.RestElement ? property : property.value,
    );
  }

  if (pattern?.type === AST_NODE_TYPES.AssignmentPattern) return [pattern.left];

  if (pattern?.type === AST_NODE_TYPES.RestElement) return [pattern.argument];

  return pattern?.type === AST_NODE_TYPES.ArrayPattern ? pattern.elements : [];
}

/** The names a binding pattern declares: `{ a, b: [c] }` → a, c; a hole (`[, a]`) declares none. */
function boundNames(pattern: TSESTree.Node | null): string[] {
  return pattern?.type === AST_NODE_TYPES.Identifier ? [pattern.name] : innerPatterns(pattern).flatMap(boundNames);
}

/** The names a declaration binds, as after `export`. */
export function declaredNames(declaration: Declaration): string[] {
  if (declaration.type === AST_NODE_TYPES.VariableDeclaration)
    return declaration.declarations.flatMap((item) => boundNames(item.id));

  return declaration.id !== null && declaration.id.type === AST_NODE_TYPES.Identifier ? [declaration.id.name] : [];
}

const DECLARATIONS = [
  "ClassDeclaration",
  "FunctionDeclaration",
  "TSDeclareFunction",
  "TSEnumDeclaration",
  "TSInterfaceDeclaration",
  "TSModuleDeclaration",
  "TSTypeAliasDeclaration",
  "VariableDeclaration",
];

function isDeclaration(node: { type: string }): node is Declaration {
  return DECLARATIONS.includes(node.type);
}

/** The declaration a statement makes, bare, after `export` or after `export default`, or null when it makes none. */
export function declarationOf(statement: Statement): Declaration | null {
  if (statement.type === AST_NODE_TYPES.ExportNamedDeclaration) return statement.declaration;
  const inner = statement.type === AST_NODE_TYPES.ExportDefaultDeclaration ? statement.declaration : statement;

  return isDeclaration(inner) ? inner : null;
}

/** What a message asks to move: the names `statement` declares, quoted, or "this" when it declares none. */
function movedOf(statement: Statement): string {
  const declaration = declarationOf(statement);
  const names = declaration === null ? [] : declaredNames(declaration);

  return names.length === 0 ? "this" : names.map((name) => `"${name}"`).join(", ");
}

/** The report of a statement a rule asks to move elsewhere, filling `{{moved}}` in its `move` message. */
export function moveReport(statement: Statement): TSESLint.ReportDescriptor<"move"> {
  return { data: { moved: movedOf(statement) }, messageId: "move", node: statement };
}
