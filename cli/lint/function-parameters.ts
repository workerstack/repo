/**
 * Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/shared/function-parameters.ts`. A function parameter's
 * type annotation and the name it binds, through a parameter property, a default and a rest.
 */
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

/** A parameter, or the binding a parameter property, default or rest wraps. */
type Binding = TSESTree.Parameter | TSESTree.DestructuringPattern;

/**
 * The annotation on `parameter` or on the binding it wraps; undefined when it has none. The parser puts a rest's
 * annotation on the rest and a default's on its left side. oxlint's AST holds null for an absent annotation where
 * typescript-eslint's holds undefined, so the result is normalized to undefined.
 */
export function functionParameterTypeAnnotation(
  parameter: TSESTree.Parameter | TSESTree.BindingName,
): TSESTree.TSTypeAnnotation | undefined {
  if (parameter.type === AST_NODE_TYPES.TSParameterProperty)
    return functionParameterTypeAnnotation(parameter.parameter);

  if (parameter.type === AST_NODE_TYPES.AssignmentPattern) return functionParameterTypeAnnotation(parameter.left);

  return parameter.typeAnnotation ?? undefined;
}

/**
 * The local name `parameter` binds, without its annotation or default: an identifier's name, or a destructured
 * pattern's text up to `annotation`, the annotation `functionParameterTypeAnnotation` found on it.
 */
export function functionParameterBindingName(
  parameter: Binding,
  annotation: TSESTree.TSTypeAnnotation,
  sourceCode: TSESLint.SourceCode,
): string {
  if (parameter.type === AST_NODE_TYPES.TSParameterProperty)
    return functionParameterBindingName(parameter.parameter, annotation, sourceCode);

  if (parameter.type === AST_NODE_TYPES.AssignmentPattern)
    return functionParameterBindingName(parameter.left, annotation, sourceCode);

  if (parameter.type === AST_NODE_TYPES.RestElement)
    return functionParameterBindingName(parameter.argument, annotation, sourceCode);

  if (parameter.type === AST_NODE_TYPES.Identifier) return parameter.name;

  return sourceCode.text.slice(parameter.range[0], annotation.range[0]).trimEnd();
}
