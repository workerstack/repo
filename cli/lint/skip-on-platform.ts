import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import type { RepoRule } from "./rule.types.ts";
import { GLOBAL_OBJECT, PROCESS, SKIP, TYPEOF, UNDEFINED, VERSIONS } from "./skip-on-platform.constants.ts";

type Node = TSESTree.Node;

/** The test functions whose `skipIf` and `runIf` take a skip condition. */
const TEST_FUNCTIONS = ["it", "test", "describe"];

/** Chains that keep a test function a test function: `it.concurrent.skipIf`. */
const CHAINS = ["concurrent", "sequential"];
const CONDITIONAL = ["skipIf", "runIf"];
const PLATFORM_READS = ["platform", "arch"];
const COMPARISONS = ["===", "!==", "==", "!=", "<", ">", "<=", ">="];
const JOINS = ["&&", "||"];
const UNARY = ["!", "-"];
const NOTHING = "no condition";
const WHITESPACE = /\s+/g;

const TAIL =
  "a test may skip only on process.platform, process.arch, process.versions or a runtime global, " +
  "so make it hermetic instead";

function nameOf(node: Node | null | undefined): string | undefined {
  return node?.type === AST_NODE_TYPES.Identifier ? node.name : undefined;
}

/** The plain name of `.name` on a member read, or undefined for `[expr]` and private names. */
function memberName(node: TSESTree.MemberExpression): string | undefined {
  return node.computed ? undefined : nameOf(node.property);
}

/** `it`, `test` or `describe`, bare or through `.concurrent` and `.sequential`. */
function isTestFunction(node: Node): boolean {
  if (node.type === AST_NODE_TYPES.Identifier) return TEST_FUNCTIONS.includes(node.name);

  return (
    node.type === AST_NODE_TYPES.MemberExpression &&
    CHAINS.includes(memberName(node) ?? "") &&
    isTestFunction(node.object)
  );
}

/** `it.skipIf` or `describe.concurrent.runIf`: the name of the conditional call, or undefined. */
function conditionalName(callee: Node): string | undefined {
  if (callee.type !== AST_NODE_TYPES.MemberExpression) return undefined;
  const name = memberName(callee);

  return name !== undefined && CONDITIONAL.includes(name) && isTestFunction(callee.object) ? name : undefined;
}

/** `process.platform`, `process.arch`, `process.versions.<name>` or `globalThis.<name>`. */
function isRuntimeRead(node: TSESTree.MemberExpression): boolean {
  const name = memberName(node);
  const { object } = node;

  if (name === undefined) return false;

  if (nameOf(object) === GLOBAL_OBJECT) return true;

  if (nameOf(object) === PROCESS) return PLATFORM_READS.includes(name);

  return (
    object.type === AST_NODE_TYPES.MemberExpression &&
    nameOf(object.object) === PROCESS &&
    memberName(object) === VERSIONS
  );
}

/** The operand a unary read passes through: `!x` and `-x` read what `x` reads, `typeof <identifier>` reads nothing. */
function unaryLeaf(node: TSESTree.UnaryExpression): Node | undefined {
  if (node.operator === TYPEOF) return node.argument.type === AST_NODE_TYPES.Identifier ? undefined : node;

  return UNARY.includes(node.operator) ? firstLeaf(node.argument) : node;
}

/** The first leaf of `a <op> b`, when `op` is a comparison or a join. */
function binaryLeaf(
  node: TSESTree.BinaryExpression | TSESTree.LogicalExpression | TSESTree.PrivateInExpression,
): Node | undefined {
  if (!COMPARISONS.includes(node.operator) && !JOINS.includes(node.operator)) return node;

  return firstLeaf(node.left) ?? firstLeaf(node.right);
}

/** The part of a condition that reads anything but the platform or runtime, as the node to name; undefined if none. */
function firstLeaf(node: Node): Node | undefined {
  if (node.type === AST_NODE_TYPES.Literal) return undefined;

  if (node.type === AST_NODE_TYPES.Identifier) return node.name === UNDEFINED ? undefined : node;

  if (node.type === AST_NODE_TYPES.MemberExpression) return isRuntimeRead(node) ? undefined : node;

  if (node.type === AST_NODE_TYPES.UnaryExpression) return unaryLeaf(node);

  if (node.type === AST_NODE_TYPES.BinaryExpression || node.type === AST_NODE_TYPES.LogicalExpression)
    return binaryLeaf(node);

  return node;
}

/** The function a test hands its context to, when `node` is one: `(ctx) => {}` or `function (ctx) {}`. */
function contextParam(node: Node): string | undefined {
  if (node.type !== AST_NODE_TYPES.ArrowFunctionExpression && node.type !== AST_NODE_TYPES.FunctionExpression)
    return undefined;
  const callee = node.parent.type === AST_NODE_TYPES.CallExpression ? node.parent.callee : undefined;

  if (callee === undefined || !(isTestFunction(callee) || conditionalName(callee) !== undefined)) return undefined;

  return nameOf(node.params[0]);
}

/** Whether `name` is the context parameter of a test callback around `node`: `it("x", (ctx) => { ctx.skip(...) })`. */
function isTestContext(node: Node, name: string): boolean {
  let at: Node = node;

  while (at.type !== AST_NODE_TYPES.Program) {
    at = at.parent;

    if (contextParam(at) === name) return true;
  }

  return false;
}

/** Fails a `skipIf`, `runIf` or `ctx.skip` whose condition reads anything but the platform or the runtime. */
export const skipOnPlatform: RepoRule<"skip"> = {
  create(context) {
    const { text } = context.sourceCode;

    function render(node: Node): string {
      return text.slice(...node.range).replaceAll(WHITESPACE, " ");
    }

    function check(node: TSESTree.CallExpression, who: string) {
      const [condition] = node.arguments;
      const leaf = condition === undefined ? undefined : firstLeaf(condition);

      if (condition !== undefined && leaf === undefined) return;

      const what =
        leaf === undefined ? NOTHING : render(leaf.type === AST_NODE_TYPES.CallExpression ? leaf.callee : leaf);

      context.report({ data: { what, who }, messageId: "skip", node });
    }

    return {
      CallExpression(node) {
        const { callee } = node;
        const conditional = conditionalName(callee);

        if (conditional !== undefined) return check(node, conditional);
        const isSkip = callee.type === AST_NODE_TYPES.MemberExpression && memberName(callee) === SKIP;
        const owner = isSkip ? nameOf(callee.object) : undefined;

        if (owner !== undefined && isTestContext(node, owner)) check(node, SKIP);
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { skip: `{{who}} reads {{what}}; ${TAIL}` },
    schema: [],
    type: "problem",
  },
};
