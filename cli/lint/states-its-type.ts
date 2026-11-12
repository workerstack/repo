import { asNode } from "../syntax-node.ts";
import { ARITHMETIC, NODE_TYPES } from "./public-jsdoc.constants.ts";
import { get, nodesOf } from "./public-surface.syntax.ts";

/** Whether `node` is a literal, a template without holes, or arithmetic on them. */
function isLiteral(node: unknown): boolean {
  const type = String(get(node, "type"));

  if (type === NODE_TYPES.literal) return true;

  if (type === NODE_TYPES.template) return nodesOf(get(node, "expressions")).length === 0;

  if (!ARITHMETIC.includes(type)) return false;

  if (type === NODE_TYPES.binary) return isLiteral(get(node, "left")) && isLiteral(get(node, "right"));

  return isLiteral(get(node, "argument"));
}

/** Whether an initializer shows its type: a literal, a cast, or a function that writes its return type. */
export function statesItsType(init: unknown): boolean {
  const type = String(get(init, "type"));

  if (type === NODE_TYPES.satisfies) return statesItsType(get(init, "expression"));

  if (isLiteral(init) || type === NODE_TYPES.asExpression) return true;
  const isFunction = type === NODE_TYPES.arrow || type === NODE_TYPES.functionExpression;

  return isFunction && asNode(get(init, "returnType")) !== null;
}
