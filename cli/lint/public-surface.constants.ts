/** The manifest every package root holds. */
export const MANIFEST = "package.json";

/** The config that says where a build writes `outDir` from `rootDir`, so a `dist/` target can be mapped back. */
export const BUILD_CONFIG = "tsconfig.build.json";

/** An `exports` target that can carry declarations: `.ts`, `.d.ts`, `.mts`, `.js` or `.mjs`. */
export const CODE_TARGET: RegExp = /\.(?:ts|mts|js|mjs)$/;

/** The source extension each built extension came from, tried in order. */
export const BUILT_EXTENSIONS: readonly (readonly [RegExp, string])[] = [
  [/(?:\.d)?\.js$/, ".ts"],
  [/(?:\.d)?\.mjs$/, ".mts"],
  [/\.d\.ts$/, ".ts"],
  [/\.d\.mts$/, ".mts"],
];

/** The name a default export is stored under. */
export const DEFAULT = "default";

/** The name a namespace import or `export * as ns` records in place of a declared name. */
export const NAMESPACE = "*";

/** The ESTree node types the walk reads. */
export const NODE = {
  accessorProperty: "AccessorProperty",
  arrow: "ArrowFunctionExpression",
  asExpression: "TSAsExpression",
  assignmentPattern: "AssignmentPattern",
  declarator: "VariableDeclarator",
  exportAll: "ExportAllDeclaration",
  exportAssignment: "TSExportAssignment",
  exportDefault: "ExportDefaultDeclaration",
  exportNamed: "ExportNamedDeclaration",
  functionDeclaration: "FunctionDeclaration",
  functionExpression: "FunctionExpression",
  identifier: "Identifier",
  importDeclaration: "ImportDeclaration",
  importDefault: "ImportDefaultSpecifier",
  importEquals: "TSImportEqualsDeclaration",
  importNamespace: "ImportNamespaceSpecifier",
  importType: "TSImportType",
  member: "MemberExpression",
  module: "TSModuleDeclaration",
  privateIdentifier: "PrivateIdentifier",
  propertyDefinition: "PropertyDefinition",
  qualifiedName: "TSQualifiedName",
  satisfiesExpression: "TSSatisfiesExpression",
  typeParameter: "TSTypeParameter",
  variable: "VariableDeclaration",
} as const;

/** The field of a function that holds its body, which a consumer never sees. */
export const BODY = "body";

/** The field of a default parameter that holds its value, which a consumer never sees. */
export const RIGHT = "right";

/** The field oxlint adds to each node that points back up, which a walk down never follows. */
export const PARENT = "parent";

/** Nodes whose `body` a consumer never sees. */
export const FUNCTIONS: readonly string[] = [NODE.arrow, NODE.functionDeclaration, NODE.functionExpression];

/** Nodes that hold a value after their declared type. */
export const VALUE_HOLDERS: readonly string[] = [NODE.accessorProperty, NODE.propertyDefinition, NODE.declarator];

/** Initializers that carry a written type, so the type shows to a consumer. */
export const TYPED_INITS: readonly string[] = [
  NODE.arrow,
  NODE.functionExpression,
  NODE.asExpression,
  NODE.satisfiesExpression,
];

/** Member modifiers that hide a member from a consumer. */
export const HIDDEN_ACCESS: readonly string[] = ["private", "protected"];

/** A node type that declares a name. */
export const DECLARATION: RegExp = /Declaration$|^TSDeclareFunction$/;

/** Where each node type holds the name it refers to. */
export const REFERENCE_KEYS: Readonly<Record<string, string>> = {
  ClassDeclaration: "superClass",
  TSClassImplements: "expression",
  TSInterfaceHeritage: "expression",
  TSTypeQuery: "exprName",
  TSTypeReference: "typeName",
};
