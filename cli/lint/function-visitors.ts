import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

/** Every node that owns a parameter list and a return type: functions, their declared signatures and function types. */
export type FunctionOwner =
  | TSESTree.FunctionLike
  | TSESTree.TSCallSignatureDeclaration
  | TSESTree.TSConstructSignatureDeclaration
  | TSESTree.TSConstructorType
  | TSESTree.TSFunctionType
  | TSESTree.TSMethodSignature;

/**
 * The visitors that run `check` on every function, method, declared signature and function type, for a rule to spread
 * into its own visitor object.
 */
export function functionVisitors(check: (node: FunctionOwner) => void): TSESLint.RuleListener {
  return {
    ArrowFunctionExpression: check,
    FunctionDeclaration: check,
    FunctionExpression: check,
    TSCallSignatureDeclaration: check,
    TSConstructSignatureDeclaration: check,
    TSConstructorType: check,
    TSDeclareFunction: check,
    TSEmptyBodyFunctionExpression: check,
    TSFunctionType: check,
    TSMethodSignature: check,
  };
}
