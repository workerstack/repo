/** The node types, fields and kinds the naming rule reads off untyped nodes: a component's JSX, a `declare global`. */
export const NAMING_SYNTAX = {
  conditional: "ConditionalExpression",
  global: "global",
  logical: "LogicalExpression",
  parent: "parent",
  parenthesized: "ParenthesizedExpression",
  return: "ReturnStatement",
} as const;
