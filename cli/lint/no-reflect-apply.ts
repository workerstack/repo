/** Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/rules/no-reflect-apply.ts`. */
import { isGlobalReflectMethodCall } from "./is-global-reflect-method-call.ts";
import type { RepoRule } from "./rule.types.ts";

const MESSAGE = "Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.";

/** Fails a call of `Reflect.apply` on the global Reflect, which bypasses an ordinary typed call. */
export const noReflectApply: RepoRule<"reflectApply"> = {
  create(context) {
    return {
      CallExpression(node) {
        if (isGlobalReflectMethodCall(context.sourceCode, node.callee, "apply"))
          context.report({ messageId: "reflectApply", node });
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { reflectApply: MESSAGE },
    schema: [],
    type: "problem",
  },
};
