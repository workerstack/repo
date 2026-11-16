import { AST_NODE_TYPES } from "@typescript-eslint/types";

/** The statements that make a file a module rather than a global script. */
export const MODULE_STATEMENTS: readonly string[] = [
  AST_NODE_TYPES.ImportDeclaration,
  AST_NODE_TYPES.ExportNamedDeclaration,
  AST_NODE_TYPES.ExportDefaultDeclaration,
  AST_NODE_TYPES.ExportAllDeclaration,
  AST_NODE_TYPES.TSExportAssignment,
  AST_NODE_TYPES.TSImportEqualsDeclaration,
];

/** The keyword that opens an interface declaration, which the fix replaces with `type`. */
export const INTERFACE_KEYWORD = "interface";

/** The declarations an interface of the same name merges with, so it cannot become a type alias. */
export const MERGING_DECLARATIONS: readonly string[] = [
  AST_NODE_TYPES.ClassDeclaration,
  AST_NODE_TYPES.FunctionDeclaration,
  AST_NODE_TYPES.TSInterfaceDeclaration,
  AST_NODE_TYPES.TSModuleDeclaration,
];
