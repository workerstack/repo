/** Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/rules/no-reflect-get.ts`. */
import { isGlobalReflectMethodCall } from "./is-global-reflect-method-call.ts";
import type { RepoRule } from "./rule.types.ts";

const MESSAGE =
  "Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.";

/** Fails a call of `Reflect.get` on the global Reflect, which bypasses ordinary property access and its types. */
export const noReflectGet: RepoRule<"reflectGet"> = {
  create(context) {
    return {
      CallExpression(node) {
        if (isGlobalReflectMethodCall(context.sourceCode, node.callee, "get"))
          context.report({ messageId: "reflectGet", node });
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { reflectGet: MESSAGE },
    schema: [],
    type: "problem",
  },
};
