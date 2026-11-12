import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import {
  CWD,
  META_PATHS,
  MODULE_DIRS,
  MODULE_SPECIFIERS,
  NATIVE_CALLS,
  PROCESS,
  WIN32,
} from "./native-path-separator.constants.ts";

type Node = TSESTree.Node;

type Ident = Extract<Node, { type: "Identifier" }>;

/** The operand a transparent expression passes its value through from, or undefined for any other node. */
function operandOf(node: Node): Node | undefined {
  if (node.type === AST_NODE_TYPES.AwaitExpression) return node.argument;

  const passes =
    node.type === AST_NODE_TYPES.TSAsExpression ||
    node.type === AST_NODE_TYPES.TSNonNullExpression ||
    node.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    node.type === AST_NODE_TYPES.TSTypeAssertion;

  return passes ? node.expression : undefined;
}

/** `x` for `x as T`, `x!`, `x satisfies T`, `<T>x` and `await x`: the node that holds the value. */
export function unwrap(node: Node): Node {
  let at = node;

  for (let inner = operandOf(at); inner !== undefined; inner = operandOf(at)) at = inner;

  return at;
}

function nameOf(node: Node): string | undefined {
  return node.type === AST_NODE_TYPES.Identifier ? node.name : undefined;
}

/** The name a member read spells with a dot, or undefined for `[expr]`. */
function memberName(node: TSESTree.MemberExpression): string | undefined {
  return node.computed ? undefined : nameOf(node.property);
}

/** The program that holds `node`. */
function programOf(node: Node): TSESTree.Program {
  let at = node;

  while (at.type !== AST_NODE_TYPES.Program) at = at.parent;

  return at;
}

type Import = { source: string; imported: string | undefined };

/** What the import declarations of `node`'s file bind `name` to: the module and the name inside it, if any. */
function importOf(node: Node, name: string): Import | undefined {
  for (const statement of programOf(node).body) {
    if (statement.type !== AST_NODE_TYPES.ImportDeclaration) continue;

    for (const specifier of statement.specifiers) {
      if (specifier.local.name !== name) continue;
      const imported = specifier.type === AST_NODE_TYPES.ImportSpecifier ? nameOf(specifier.imported) : undefined;

      return MODULE_SPECIFIERS.includes(specifier.type) || imported !== undefined
        ? { imported, source: statement.source.value }
        : undefined;
    }
  }

  return undefined;
}

function isNativeFunction(source: string, name: string): boolean {
  return (NATIVE_CALLS[source] ?? []).includes(name);
}

/** `join(…)` or `tmpdir()`: a name imported from a module whose function of that name returns a native path. */
function isImportedCall(callee: Ident): boolean {
  const found = importOf(callee, callee.name);

  return found?.imported !== undefined && isNativeFunction(found.source, found.imported);
}

/** `path.join(…)`, `path.win32.join(…)` or `os.tmpdir()`: a function of an imported module object. */
function isModuleCall(callee: TSESTree.MemberExpression): boolean {
  const name = memberName(callee);
  let { object } = callee;

  if (object.type === AST_NODE_TYPES.MemberExpression) {
    if (memberName(object) !== WIN32) return false;
    ({ object } = object);
  }

  if (name === undefined || object.type !== AST_NODE_TYPES.Identifier) return false;
  const found = importOf(object, object.name);

  return found !== undefined && found.imported === undefined && isNativeFunction(found.source, name);
}

/** Whether `callee` is a function of an imported module that returns a native path, like `path.join` or `tmpdir`. */
function isNativeCallee(callee: Node): boolean {
  return callee.type === AST_NODE_TYPES.Identifier
    ? isImportedCall(callee)
    : callee.type === AST_NODE_TYPES.MemberExpression && isModuleCall(callee);
}

/** `process.cwd()` or a call of a function that returns a native path. */
function isNativeCall(call: TSESTree.CallExpression): boolean {
  const { callee } = call;

  if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    callee.object.type === AST_NODE_TYPES.Identifier &&
    callee.object.name === PROCESS &&
    memberName(callee) === CWD
  )
    return true;

  return isNativeCallee(callee);
}

/** What `name` is in `declaration`: its `const` initializer, `null` for any other binding, else `undefined`. */
function declaredIn(declaration: TSESTree.VariableDeclaration, name: string, before: number): Node | null | undefined {
  const found = declaration.declarations.find((d) => d.id.type === AST_NODE_TYPES.Identifier && d.id.name === name);

  if (found === undefined) return undefined;

  return declaration.kind === "const" && found.range[1] <= before ? found.init : null;
}

/** What `name` is where `statement` declares it: as `declaredIn` says, or `null` for a function or class. */
function declaredBy(statement: Node, name: string, before: number): Node | null | undefined {
  const inner = statement.type === AST_NODE_TYPES.ExportNamedDeclaration ? statement.declaration : statement;

  if (inner?.type === AST_NODE_TYPES.VariableDeclaration) return declaredIn(inner, name, before);
  const named = inner?.type === AST_NODE_TYPES.FunctionDeclaration || inner?.type === AST_NODE_TYPES.ClassDeclaration;

  return named && inner.id?.name === name ? null : undefined;
}

/** What the scope `at` makes of `name`, as `declaredBy` says. */
function declaredInScope(at: Node, name: string, before: number): Node | null | undefined {
  if (
    at.type === AST_NODE_TYPES.Program ||
    at.type === AST_NODE_TYPES.BlockStatement ||
    at.type === AST_NODE_TYPES.StaticBlock
  ) {
    for (const statement of at.body) {
      const found = declaredBy(statement, name, before);

      if (found !== undefined) return found;
    }

    return undefined;
  }

  const isFunction =
    at.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    at.type === AST_NODE_TYPES.FunctionExpression ||
    at.type === AST_NODE_TYPES.FunctionDeclaration;

  return isFunction && at.params.some((param) => nameOf(param) === name) ? null : undefined;
}

/** Whether the nearest binding of `name` up from `node` is a `const` set to a native path. */
function isNativeBinding(node: Ident): boolean {
  let at: Node = node;

  while (at.type !== AST_NODE_TYPES.Program) {
    at = at.parent;
    const found = declaredInScope(at, node.name, node.range[0]);

    if (found !== undefined) return found !== null && isNativePath(found);
  }

  return false;
}

/** The member read `x.cwd`, `import.meta.dirname`: native by what it is called or where it comes from. */
function isNativeMember(node: TSESTree.MemberExpression): boolean {
  const name = memberName(node);

  if (name === CWD) return true;

  return node.object.type === AST_NODE_TYPES.MetaProperty && name !== undefined && META_PATHS.includes(name);
}

/**
 * Whether `node` is provably a native path, one that uses `\` on Windows: a `node:path` call but `path.posix`,
 * `process.cwd()`, `import.meta.dirname`, `__dirname`, anything named `cwd`, and a `const` set to one of these.
 */
export function isNativePath(node: Node): boolean {
  const value = unwrap(node);

  if (value.type === AST_NODE_TYPES.CallExpression) return isNativeCall(value);

  if (value.type === AST_NODE_TYPES.MemberExpression) return isNativeMember(value);

  if (value.type !== AST_NODE_TYPES.Identifier) return false;

  return value.name === CWD || MODULE_DIRS.includes(value.name) || isNativeBinding(value);
}
