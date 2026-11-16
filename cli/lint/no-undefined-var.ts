import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

import { eachMatch, type Found, sheetVars } from "./css-vars.ts";
import type { RepoRule } from "./rule.types.ts";

/** The rule's one option, which sync writes from `lint.tailwind`: the entry sheet and the vars code sets at runtime. */
type VarOptions = [{ entryPoint?: string; vars?: readonly string[] }?];

type MessageId = "undefinedVar" | "unresolved";

/** A node whose source text can hold a var: a string, or one piece of a template. */
type Text = TSESTree.Literal | TSESTree.TemplateElement;

/** `var(--x` and `-(--x` or `-(length:--x`: each has the name as its one capture. */
const USES = [/var\(\s*(--[\w-]+)/g, /-\((?:[\w-]+:)?(--[\w-]+)/g];

/** An arbitrary property a class sets on its element, `[--x:1]`. */
const CLASS_SETS = /\[(--[\w-]+):/g;

/** A string that is only a name: a style key or the name `setProperty` takes. */
const BARE_NAME = /^["'`](--[\w-]+)["'`]$/g;

/** The `*` that ends a listed prefix. */
const STAR = /\*$/;

/** Whether `vars` lists `name`: exactly, or as a prefix when an entry ends in `*`. */
function listed(vars: readonly string[], name: string): boolean {
  return vars.some((entry) => (STAR.test(entry) ? name.startsWith(entry.replace(STAR, "")) : entry === name));
}

/** What a piece of source text uses, and the vars it sets on an element. */
type Scanned = { sets: string[]; uses: Found[] };

/** The `${` that opens a template expression: a name running into it is pieced together at runtime. */
const EXPRESSION = "${";

/**
 * The vars the part of `code` between `from` and `to` uses, positioned in the file, and the ones its classes set. A use
 * whose name runs into a template expression, as in `var(--ui-${x})`, is pieced at runtime and left out.
 */
function scanText(code: string, from: number, to: number): Scanned {
  const scanned: Scanned = { sets: [], uses: [] };
  const text = code.slice(from, to);

  for (const pattern of USES) {
    eachMatch(text, pattern, ({ end, name, start }) => {
      if (!code.startsWith(EXPRESSION, from + end)) scanned.uses.push({ end: from + end, name, start: from + start });
    });
  }

  for (const pattern of [CLASS_SETS, BARE_NAME]) eachMatch(text, pattern, (hit) => scanned.sets.push(hit.name));

  return scanned;
}

/** The rule's context, as a rule over `VarOptions` gets it. */
type Context = Readonly<TSESLint.RuleContext<MessageId, VarOptions>>;

/** The visitors for the entry sheet at `entry`: they collect the uses and what the file sets, and report at the end. */
function checksOf(context: Context, entry: string, vars: readonly string[]): TSESLint.RuleListener {
  const { sourceCode: source } = context;
  const uses: Found[] = [];
  const own = new Set<string>();

  function scan(node: Text): void {
    const found = scanText(source.text, ...node.range);

    uses.push(...found.uses);

    for (const name of found.sets) own.add(name);
  }

  function report(): void {
    const unknown = uses.filter((use) => !own.has(use.name) && !listed(vars, use.name));

    if (unknown.length === 0) return;
    const graph = sheetVars(entry, context.cwd);

    for (const { end, name, start } of unknown.filter((use) => !graph.names.has(use.name))) {
      const loc = { end: source.getLocFromIndex(end), start: source.getLocFromIndex(start) };

      context.report(
        graph.broken === null
          ? { data: { entry, name }, loc, messageId: "undefinedVar" }
          : { data: graph.broken, loc, messageId: "unresolved" },
      );
    }
  }

  return { Literal: scan, "Program:exit": report, TemplateElement: scan };
}

/**
 * Fails a custom property used as `var(--x)` or `utility-(--x)` in a string or template that no sheet of
 * `lint.tailwind.entryPoint`'s `@import` graph declares, that the file does not set itself (`[--x:1]` in a class, or
 * the string `"--x"` as a style key) and that `lint.tailwind.vars` does not list; such a var renders nothing. An import
 * in the graph that does not resolve is reported in place of the undefined var, since the graph cannot be known. The
 * sheets are read only when the file uses a var it does not set, and with no entry the rule checks nothing.
 */
export const noUndefinedVar: RepoRule<MessageId, VarOptions> = {
  create(context) {
    const { entryPoint, vars = [] } = context.options[0] ?? {};

    return entryPoint === undefined ? {} : checksOf(context, entryPoint, vars);
  },
  defaultOptions: [],
  meta: {
    messages: {
      undefinedVar:
        '"{{name}}" is not defined by {{entry}} or a sheet it imports. Fix the name, define it in a sheet, ' +
        "or list it in lint.tailwind.vars when code sets it at runtime.",
      unresolved:
        '"{{specifier}}" in {{from}} does not resolve, so vars cannot be checked. ' +
        "Create the file or fix the import.",
    },
    schema: [
      {
        additionalProperties: false,
        properties: { entryPoint: { type: "string" }, vars: { items: { type: "string" }, type: "array" } },
        type: "object",
      },
    ],
    type: "problem",
  },
};
