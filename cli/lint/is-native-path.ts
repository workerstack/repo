import type { ESTree } from "@oxlint/plugins";
import {
  CWD,
  META_PATHS,
  MODULE_DIRS,
  MODULE_SPECIFIERS,
  NATIVE_CALLS,
  PROCESS,
  WIN32,
} from "./native-path-separator.constants.ts";

type Node = ESTree.Node;
type Ident = Extract<Node, { type: "Identifier" }>;
/** The operand a transparent expression passes its value through from, or undefined for any other node. */
function operandOf(node: Node): Node | undefined {
  if (node.type === "AwaitExpression") return node.argument;
  const passes =
    node.type === "ParenthesizedExpression" ||
    node.type === "TSAsExpression" ||
    node.type === "TSNonNullExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSTypeAssertion";
  return passes ? node.expression : undefined;
}

/** `x` for `(x)`, `x as T`, `x!`, `x satisfies T`, `<T>x` and `await x`: the node that holds the value. */
export function unwrap(node: Node): Node {
  let at = node;
  for (let inner = operandOf(at); inner !== undefined; inner = operandOf(at)) at = inner;
  return at;
}

const nameOf = (node: Node): string | undefined => (node.type === "Identifier" ? node.name : undefined);

/** The name a member read spells with a dot, or undefined for `[expr]`. */
const memberName = (node: ESTree.MemberExpression): string | undefined =>
  node.computed ? undefined : nameOf(node.property);

/** The program that holds `node`. */
function programOf(node: Node): ESTree.Program {
  let at = node;
  while (at.type !== "Program") at = at.parent;
  return at;
}

type Import = { source: string; imported: string | undefined };

/** What the import declarations of `node`'s file bind `name` to: the module and the name inside it, if any. */
function importOf(node: Node, name: string): Import | undefined {
  for (const statement of programOf(node).body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers) {
      if (specifier.local.name !== name) continue;
      const imported = specifier.type === "ImportSpecifier" ? nameOf(specifier.imported) : undefined;
      return MODULE_SPECIFIERS.includes(specifier.type) || imported !== undefined
        ? { source: String(statement.source.value), imported }
        : undefined;
    }
  }
  return undefined;
}

const isNativeFunction = (source: string, name: string): boolean => (NATIVE_CALLS[source] ?? []).includes(name);

/** `join(…)` or `tmpdir()`: a name imported from a module whose function of that name returns a native path. */
function isImportedCall(callee: Ident): boolean {
  const found = importOf(callee, callee.name);
  return found?.imported !== undefined && isNativeFunction(found.source, found.imported);
}

/** `path.join(…)`, `path.win32.join(…)` or `os.tmpdir()`: a function of an imported module object. */
function isModuleCall(callee: ESTree.MemberExpression): boolean {
  const name = memberName(callee);
  let { object } = callee;
  if (object.type === "MemberExpression") {
    if (memberName(object) !== WIN32) return false;
    ({ object } = object);
  }
  if (name === undefined || object.type !== "Identifier") return false;
  const found = importOf(object, object.name);
  return found !== undefined && found.imported === undefined && isNativeFunction(found.source, name);
}

/** Whether `callee` is a function of an imported module that returns a native path, like `path.join` or `tmpdir`. */
const isNativeCallee = (callee: Node): boolean =>
  callee.type === "Identifier" ? isImportedCall(callee) : callee.type === "MemberExpression" && isModuleCall(callee);

/** `process.cwd()` or a call of a function that returns a native path. */
function isNativeCall(call: ESTree.CallExpression): boolean {
  const { callee } = call;
  if (callee.type === "MemberExpression" && callee.object.type === "Identifier") {
    if (callee.object.name === PROCESS && memberName(callee) === CWD) return true;
  }
  return isNativeCallee(callee);
}

/** What `name` is in `declaration`: its `const` initializer, `null` for any other binding, else `undefined`. */
function declaredIn(declaration: ESTree.VariableDeclaration, name: string, before: number): Node | null | undefined {
  const found = declaration.declarations.find((d) => d.id.type === "Identifier" && d.id.name === name);
  if (found === undefined) return undefined;
  return declaration.kind === "const" && found.end <= before ? found.init : null;
}

/** What `name` is where `statement` declares it: as `declaredIn` says, or `null` for a function or class. */
function declaredBy(statement: Node, name: string, before: number): Node | null | undefined {
  const inner = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
  if (inner?.type === "VariableDeclaration") return declaredIn(inner, name, before);
  const named = inner?.type === "FunctionDeclaration" || inner?.type === "ClassDeclaration";
  return named && inner.id?.name === name ? null : undefined;
}

/** What the scope `at` makes of `name`, as `declaredBy` says. */
function declaredInScope(at: Node, name: string, before: number): Node | null | undefined {
  if (at.type === "Program" || at.type === "BlockStatement" || at.type === "StaticBlock") {
    for (const statement of at.body) {
      const found = declaredBy(statement, name, before);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const isFunction =
    at.type === "ArrowFunctionExpression" || at.type === "FunctionExpression" || at.type === "FunctionDeclaration";
  return isFunction && at.params.some((param) => nameOf(param) === name) ? null : undefined;
}

/** Whether the nearest binding of `name` up from `node` is a `const` set to a native path. */
function isNativeBinding(node: Ident): boolean {
  for (let at: Node | null | undefined = node.parent; at; at = at.parent) {
    const found = declaredInScope(at, node.name, node.start);
    if (found !== undefined) return found !== null && isNativePath(found);
  }
  return false;
}

/** The member read `x.cwd`, `import.meta.dirname`: native by what it is called or where it comes from. */
function isNativeMember(node: ESTree.MemberExpression): boolean {
  const name = memberName(node);
  if (name === CWD) return true;
  return node.object.type === "MetaProperty" && name !== undefined && META_PATHS.includes(name);
}

/**
 * Whether `node` is provably a native path, one that uses `\` on Windows: a `node:path` call but `path.posix`,
 * `process.cwd()`, `import.meta.dirname`, `__dirname`, anything named `cwd`, and a `const` set to one of these.
 */
export function isNativePath(node: Node): boolean {
  const value = unwrap(node);
  if (value.type === "CallExpression") return isNativeCall(value);
  if (value.type === "MemberExpression") return isNativeMember(value);
  if (value.type !== "Identifier") return false;
  return value.name === CWD || MODULE_DIRS.includes(value.name) || isNativeBinding(value);
}
