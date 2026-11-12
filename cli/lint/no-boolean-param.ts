import type { ESTree } from "@oxlint/plugins";

import type { RepoRule } from "./rule.types.ts";

/** The message for a flag parameter called `name`. */
function messageOf(name: string): string {
  return (
    `\`${name}: boolean\` is a positional flag the call cannot name; ` +
    `take an options object ({ ${name} }) or split the function in two`
  );
}

type Parameter = ESTree.ParamPattern;
type Func = ESTree.Function | ESTree.ArrowFunctionExpression;

/** Whether the function is one a caller names: a declaration, a class member but a setter, or a function const. */
function isDeclared(node: Func): boolean {
  if (node.type === "FunctionDeclaration" || node.type === "TSDeclareFunction") return true;
  const { parent } = node;
  if (parent.type === "MethodDefinition" || parent.type === "TSAbstractMethodDefinition") return parent.kind !== "set";
  return ["VariableDeclarator", "PropertyDefinition", "TSAbstractPropertyDefinition"].includes(parent.type);
}

/** Whether a type is `boolean` or a union with it as a member. */
function hasBoolean(type: ESTree.TSType): boolean {
  if (type.type === "TSBooleanKeyword") return true;
  return type.type === "TSUnionType" && type.types.some(hasBoolean);
}

/** The identifier a parameter binds, with the default it carries; null for a pattern or a rest. */
function identifierOf(param: Parameter): { id: ESTree.BindingIdentifier; fallback: ESTree.Expression | null } | null {
  if (param.type === "TSParameterProperty") return identifierOf(param.parameter);
  if (param.type === "AssignmentPattern")
    return param.left.type === "Identifier" ? { fallback: param.right, id: param.left } : null;
  return param.type === "Identifier" ? { fallback: null, id: param } : null;
}

/** The name of a parameter typed boolean, or defaulted to true or false when untyped; null for any other. */
function flagName(param: Parameter): string | null {
  const found = identifierOf(param);
  if (found === null) return null;
  const annotation = found.id.typeAnnotation?.typeAnnotation;
  if (annotation !== undefined) return hasBoolean(annotation) ? found.id.name : null;
  const { fallback } = found;
  return fallback?.type === "Literal" && typeof fallback.value === "boolean" ? found.id.name : null;
}

/**
 * Fails a boolean parameter of a function declaration, `declare` or overload signature, class method, constructor,
 * function const or class field holding a function: `f(x, true)` hides what the flag means at the call. A callback,
 * an object literal method, a setter and a signature in an interface or type literal pass, as does a destructured
 * options parameter. Reads the annotation and the default only, since oxlint gives a rule no types.
 */
export const noBooleanParam: RepoRule = {
  create(context) {
    function check(node: Func): void {
      if (!isDeclared(node)) return;
      for (const param of node.params) {
        const name = flagName(param);
        if (name !== null) context.report({ message: messageOf(name), node: param });
      }
    }
    return {
      ArrowFunctionExpression: check,
      FunctionDeclaration: check,
      FunctionExpression: check,
      TSDeclareFunction: check,
      TSEmptyBodyFunctionExpression: check,
    };
  },
};
