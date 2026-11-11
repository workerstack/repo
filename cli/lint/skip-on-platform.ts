import type { CreateRule, ESTree } from "@oxlint/plugins";

import { GLOBAL_OBJECT, PROCESS, SKIP, TYPEOF, UNDEFINED, VERSIONS } from "./skip-on-platform.constants.ts";

type Node = ESTree.Node;

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
  return node?.type === "Identifier" ? node.name : undefined;
}

/** The plain name of `.name` on a member read, or undefined for `[expr]` and private names. */
function memberName(node: ESTree.MemberExpression): string | undefined {
  return node.computed ? undefined : nameOf(node.property);
}

/** `it`, `test` or `describe`, bare or through `.concurrent` and `.sequential`. */
function isTestFunction(node: Node): boolean {
  if (node.type === "Identifier") return TEST_FUNCTIONS.includes(node.name);
  return node.type === "MemberExpression" && CHAINS.includes(memberName(node) ?? "") && isTestFunction(node.object);
}

/** `it.skipIf` or `describe.concurrent.runIf`: the name of the conditional call, or undefined. */
function conditionalName(callee: Node): string | undefined {
  if (callee.type !== "MemberExpression") return undefined;
  const name = memberName(callee);
  return name !== undefined && CONDITIONAL.includes(name) && isTestFunction(callee.object) ? name : undefined;
}

/** `process.platform`, `process.arch`, `process.versions.<name>` or `globalThis.<name>`. */
function isRuntimeRead(node: ESTree.MemberExpression): boolean {
  const name = memberName(node);
  const { object } = node;
  if (name === undefined) return false;
  if (nameOf(object) === GLOBAL_OBJECT) return true;
  if (nameOf(object) === PROCESS) return PLATFORM_READS.includes(name);
  return object.type === "MemberExpression" && nameOf(object.object) === PROCESS && memberName(object) === VERSIONS;
}

/** The operand a unary read passes through: `!x` and `-x` read what `x` reads, `typeof <identifier>` reads nothing. */
function unaryLeaf(node: ESTree.UnaryExpression): Node | undefined {
  if (node.operator === TYPEOF) return node.argument.type === "Identifier" ? undefined : node;
  return UNARY.includes(node.operator) ? firstLeaf(node.argument) : node;
}

/** The first leaf of `a <op> b`, when `op` is a comparison or a join. */
function binaryLeaf(
  node: ESTree.BinaryExpression | ESTree.LogicalExpression | ESTree.PrivateInExpression,
): Node | undefined {
  if (!COMPARISONS.includes(node.operator) && !JOINS.includes(node.operator)) return node;
  return firstLeaf(node.left) ?? firstLeaf(node.right);
}

/** The part of a condition that reads anything but the platform or runtime, as the node to name; undefined if none. */
function firstLeaf(node: Node): Node | undefined {
  if (node.type === "Literal") return undefined;
  if (node.type === "Identifier") return node.name === UNDEFINED ? undefined : node;
  if (node.type === "MemberExpression") return isRuntimeRead(node) ? undefined : node;
  if (node.type === "UnaryExpression") return unaryLeaf(node);
  if (node.type === "BinaryExpression" || node.type === "LogicalExpression") return binaryLeaf(node);
  return node;
}

/** The function a test hands its context to, when `node` is one: `(ctx) => {}` or `function (ctx) {}`. */
function contextParam(node: Node): string | undefined {
  if (node.type !== "ArrowFunctionExpression" && node.type !== "FunctionExpression") return undefined;
  const callee = node.parent.type === "CallExpression" ? node.parent.callee : undefined;
  if (callee === undefined || !(isTestFunction(callee) || conditionalName(callee) !== undefined)) return undefined;
  return nameOf(node.params[0]);
}

/** Whether `name` is the context parameter of a test callback around `node`: `it("x", (ctx) => { ctx.skip(...) })`. */
function isTestContext(node: Node, name: string): boolean {
  let at: Node | null = node.parent;
  while (at !== null) {
    if (contextParam(at) === name) return true;
    at = at.parent;
  }
  return false;
}

/** Fails a `skipIf`, `runIf` or `ctx.skip` whose condition reads anything but the platform or the runtime. */
export const skipOnPlatform: CreateRule = {
  create(context) {
    const { text } = context.sourceCode;
    function render(node: Node): string {
      return text.slice(node.start, node.end).replaceAll(WHITESPACE, " ");
    }
    function check(node: ESTree.CallExpression, who: string) {
      const [condition] = node.arguments;
      const leaf = condition === undefined ? undefined : firstLeaf(condition);
      if (condition !== undefined && leaf === undefined) return;
      const what = leaf === undefined ? NOTHING : render(leaf.type === "CallExpression" ? leaf.callee : leaf);
      context.report({ message: `${who} reads ${what}; ${TAIL}`, node });
    }
    return {
      CallExpression(node) {
        const { callee } = node;
        const conditional = conditionalName(callee);
        if (conditional !== undefined) return check(node, conditional);
        const isSkip = callee.type === "MemberExpression" && memberName(callee) === SKIP;
        const owner = isSkip ? nameOf(callee.object) : undefined;
        if (owner !== undefined && isTestContext(node, owner)) check(node, SKIP);
      },
    };
  },
};
