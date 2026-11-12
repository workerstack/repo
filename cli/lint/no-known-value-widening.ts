/** Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/rules/no-known-value-widening.ts`. */
import { AST_NODE_TYPES, ESLintUtils, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { createTypeEnvironment, type TypeEnvironment } from "./dictionary-walk.ts";
import { containsUnknownType } from "./function-parameters.ts";
import {
  hasKnownCallArgumentEvidence,
  hasKnownEvidence,
  localFunctionForCall,
  predicateSubject,
  unwrapExpression,
  variableDeclarator,
} from "./known-value-arguments.ts";
import { classifyWideningTarget, type WideningTarget } from "./known-value-targets.ts";
import { resolveVariable } from "./resolve-variable.ts";
import type { RepoRule } from "./rule.types.ts";
import { functionBoundary } from "./widen-evidence.ts";

const MESSAGE =
  "The explicit {{target}} type on {{subject}} discards known type evidence. " +
  "Keep inference, validate with `satisfies`, or use a named owner contract.";

const ANONYMOUS = "anonymous function";

/** The targets an empty `{}` may start, as an accumulator filled in later. */
const ACCUMULATORS: readonly WideningTarget[] = ["generic container", "open dictionary"];

const ASSERTIONS: readonly string[] = [AST_NODE_TYPES.TSAsExpression, AST_NODE_TYPES.TSTypeAssertion];

type SourceCode = Readonly<TSESLint.SourceCode>;

/** The name a class member's key reads as. */
function keyName(sourceCode: SourceCode, key: TSESTree.PropertyName | TSESTree.PrivateIdentifier): string {
  if (key.type === AST_NODE_TYPES.Identifier || key.type === AST_NODE_TYPES.PrivateIdentifier) return key.name;

  return key.type === AST_NODE_TYPES.Literal ? String(key.value) : sourceCode.getText(key);
}

/** The name `owner` goes by: its own, its const's or its method's, else "anonymous function". */
function functionName(sourceCode: SourceCode, owner: TSESTree.FunctionLike | null): string {
  if (owner === null) return ANONYMOUS;

  const ownName = (owner.id ?? undefined)?.name;

  if (ownName !== undefined) return ownName;
  const { parent } = owner;

  if (parent.type === AST_NODE_TYPES.VariableDeclarator && parent.id.type === AST_NODE_TYPES.Identifier)
    return parent.id.name;

  return parent.type === AST_NODE_TYPES.MethodDefinition ? keyName(sourceCode, parent.key) : ANONYMOUS;
}

/** Whether `expression` is `{}`, past any assertion, `satisfies` or non-null operator around it. */
function isEmptyObject(expression: TSESTree.Expression): boolean {
  const current = unwrapExpression(expression);

  return current.type === AST_NODE_TYPES.ObjectExpression && current.properties.length === 0;
}

/** A known argument to a local `unknown` type predicate, with the subject the message names. */
type PredicateArgument = { argument: TSESTree.Expression; subject: string };

/** Reports `expression` when its known value flows into the written `type` on `subject`. */
type FlowReport = (expression: TSESTree.Expression, type: TSESTree.TypeNode | undefined, subject: string) => void;

/** The known argument `call` passes a local type predicate whose subject is `unknown`, null when it passes none. */
function predicateArgument(
  sourceCode: SourceCode,
  call: TSESTree.CallExpression,
  environment: TypeEnvironment,
): PredicateArgument | null {
  const owner = localFunctionForCall(sourceCode, call.callee);
  const subject = owner === null ? null : predicateSubject(sourceCode, owner);
  const argument = subject === null ? undefined : call.arguments[subject.index];

  if (subject === null || argument === undefined || argument.type === AST_NODE_TYPES.SpreadElement) return null;

  const isKnown =
    containsUnknownType(subject.annotation.typeAnnotation) &&
    hasKnownCallArgumentEvidence(sourceCode, argument, environment);

  const name = `argument for parameter \`${subject.name}\` of \`${functionName(sourceCode, owner)}\``;

  return isKnown ? { argument, subject: name } : null;
}

/** The type `annotation` writes, undefined when there is none. */
function annotated(annotation: TSESTree.TSTypeAnnotation | null | undefined): TSESTree.TypeNode | undefined {
  return (annotation ?? undefined)?.typeAnnotation;
}

/** The visitors for a value written into a binding, an assigned variable or a class property. */
function bindingVisitors(sourceCode: SourceCode, report: FlowReport): TSESLint.RuleListener {
  function checkProperty(node: TSESTree.AccessorProperty | TSESTree.PropertyDefinition): void {
    const value = node.value ?? undefined;

    if (value !== undefined)
      report(value, annotated(node.typeAnnotation), `property \`${keyName(sourceCode, node.key)}\``);
  }

  return {
    AccessorProperty: checkProperty,
    AssignmentExpression(node) {
      if (node.operator !== "=" || node.left.type !== AST_NODE_TYPES.Identifier) return;
      const variable = resolveVariable(sourceCode, node.left);
      const declarator = variable === null ? null : variableDeclarator(variable);

      if (declarator?.id.type === AST_NODE_TYPES.Identifier)
        report(node.right, annotated(declarator.id.typeAnnotation), `binding \`${declarator.id.name}\``);
    },
    PropertyDefinition: checkProperty,
    VariableDeclarator(node) {
      const init = node.init ?? undefined;

      if (init !== undefined && node.id.type === AST_NODE_TYPES.Identifier)
        report(init, annotated(node.id.typeAnnotation), `binding \`${node.id.name}\``);
    },
  };
}

/** The visitors for a value a function returns or an assertion writes into a type. */
function returnVisitors(sourceCode: SourceCode, report: FlowReport): TSESLint.RuleListener {
  function checkAssertion(node: TSESTree.TSAsExpression | TSESTree.TSTypeAssertion): void {
    if (!ASSERTIONS.includes(node.parent.type)) report(node.expression, node.typeAnnotation, "assertion");
  }

  return {
    ArrowFunctionExpression(node) {
      if (node.body.type !== AST_NODE_TYPES.BlockStatement)
        report(node.body, annotated(node.returnType), `return value of \`${functionName(sourceCode, node)}\``);
    },
    ReturnStatement(node) {
      const argument = node.argument ?? undefined;

      if (argument === undefined) return;
      const owner = functionBoundary(node);
      report(argument, annotated(owner?.returnType), `return value of \`${functionName(sourceCode, owner)}\``);
    },
    TSAsExpression: checkAssertion,
    TSTypeAssertion: checkAssertion,
  };
}

/**
 * Fails a value whose type is known where it is written (a literal, an object, an array, a function, a `new`, or a
 * stable const holding one) flowing into an explicit `unknown`, `object`, open dictionary, anonymous object type or
 * generic alias that opens into a dictionary: through a binding, a class property, an assignment, a return or an
 * assertion. Also fails a known argument to a local type predicate whose subject is `unknown`. An empty `{}` may
 * start a dictionary, and a named alias or interface is the owner's contract, so both pass.
 */
export const noKnownValueWidening: RepoRule<"widening"> = {
  create(context) {
    const { sourceCode } = context;
    let environment: TypeEnvironment | null = null;

    function types(): TypeEnvironment {
      return ESLintUtils.nullThrows(environment, "the Program visitor runs first");
    }

    function report(node: TSESTree.Expression, subject: string, target: WideningTarget): void {
      context.report({ data: { subject, target }, messageId: "widening", node });
    }

    function reportFlow(expression: TSESTree.Expression, type: TSESTree.TypeNode | undefined, subject: string): void {
      const target = type === undefined ? null : classifyWideningTarget(type, types());

      if (target === null || (ACCUMULATORS.includes(target) && isEmptyObject(expression))) return;

      if (hasKnownEvidence(sourceCode, expression)) report(expression, subject, target);
    }

    return {
      ...bindingVisitors(sourceCode, reportFlow),
      ...returnVisitors(sourceCode, reportFlow),
      CallExpression(node) {
        const flow = predicateArgument(sourceCode, node, types());

        if (flow !== null) report(flow.argument, flow.subject, "unknown");
      },
      Program(program) {
        environment = createTypeEnvironment(program, sourceCode.visitorKeys);
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { widening: MESSAGE },
    schema: [],
    type: "problem",
  },
};
