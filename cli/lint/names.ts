import type { ESTree } from "@oxlint/plugins";

/** A top-level statement of a module. */
export type Statement = ESTree.Program["body"][number];
type Binding = ESTree.BindingPattern | ESTree.BindingRestElement;
type Declaration = NonNullable<ESTree.ExportNamedDeclaration["declaration"]>;

/** The names a binding pattern declares: `{ a, b: [c] }` → a, c. */
function boundNames(pattern: Binding | null): string[] {
  if (pattern === null) return [];
  if (pattern.type === "Identifier") return [pattern.name];
  if (pattern.type === "ObjectPattern") {
    return pattern.properties.flatMap((property) =>
      boundNames(property.type === "RestElement" ? property : property.value),
    );
  }
  if (pattern.type === "ArrayPattern") return pattern.elements.flatMap(boundNames);
  return boundNames(pattern.type === "AssignmentPattern" ? pattern.left : pattern.argument);
}

/** The names a declaration binds, as after `export`. */
export function declaredNames(declaration: Declaration): string[] {
  if (declaration.type === "VariableDeclaration")
    return declaration.declarations.flatMap((item) => boundNames(item.id));
  return declaration.id !== null && declaration.id.type === "Identifier" ? [declaration.id.name] : [];
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
  if (statement.type === "ExportNamedDeclaration") return statement.declaration;
  const inner = statement.type === "ExportDefaultDeclaration" ? statement.declaration : statement;
  return isDeclaration(inner) ? inner : null;
}

/** What a message asks to move: the names `statement` declares, quoted, or "this" when it declares none. */
export function movedOf(statement: Statement): string {
  const declaration = declarationOf(statement);
  const names = declaration === null ? [] : declaredNames(declaration);
  return names.length === 0 ? "this" : names.map((name) => `"${name}"`).join(", ");
}
