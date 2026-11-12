import type { ESTree } from "@oxlint/plugins";

import { isNativePath, unwrap } from "./is-native-path.ts";
import { MATCHING_METHODS, SEPARATOR } from "./native-path-separator.constants.ts";
import type { RepoRule } from "./rule.types.ts";

const WHITESPACE_RUN = /\s+/g;

type Node = ESTree.Node;

/** The separator a string or template literal holds in its cooked value, or undefined; `"\n"` holds none. */
function separatorIn(node: Node): string | undefined {
  if (node.type === "Literal") return typeof node.value === "string" ? SEPARATOR.exec(node.value)?.[0] : undefined;
  if (node.type !== "TemplateLiteral") return undefined;
  for (const quasi of node.quasis) {
    const found = SEPARATOR.exec(String(quasi.value.cooked));
    if (found !== null) return found[0];
  }
  return undefined;
}

/** Fails a string match against a separator literal on a value that is provably a native path. */
export const nativePathSeparator: RepoRule = {
  create(context) {
    const { text } = context.sourceCode;
    function source(node: Node): string {
      return text.slice(node.start, node.end).replaceAll(WHITESPACE_RUN, " ");
    }
    // An identifier or member is named by its source, a call by its callee.
    function named(receiver: Node): string {
      if (receiver.type !== "CallExpression") return source(receiver);
      return `${source(receiver.callee)}(${receiver.arguments.length === 0 ? "" : "…"})`;
    }
    return {
      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return;
        const method = callee.property.name;
        const [first] = node.arguments;
        const separator = first === undefined || !MATCHING_METHODS.includes(method) ? undefined : separatorIn(first);
        const receiver = unwrap(callee.object);
        if (separator === undefined || !isNativePath(receiver)) return;
        context.report({
          message:
            `\`${named(receiver)}\` is a native path, which uses \\ on Windows, so ` +
            `\`.${method}("${separator}…")\` misses there; use path.basename, path.dirname, path.relative or ` +
            'split(path.sep), or convert it with .replaceAll(path.sep, "/") first',
          node,
        });
      },
    };
  },
};
