import type { Rule } from "./sync-pstack-rules.constants.ts";

/** The Key order section of the typescript patterns, written after the Object args section. */
const KEY_ORDER_PATTERNS =
  "\n## Key order\n\n" +
  "```ts\n" +
  "// Don't. The query string follows the order the keys were written in.\n" +
  'const query = Object.entries(params).map(([k, v]) => `${k}=${v}`).join("&");\n\n' +
  "// Do. Sort, so any key order gives the same string.\n" +
  "const query = Object.entries(params)\n" +
  "  .toSorted(([a], [b]) => a.localeCompare(b))\n" +
  "  .map(([k, v]) => `${k}=${v}`)\n" +
  '  .join("&");\n' +
  "```\n\n" +
  "```ts\n" +
  "// Don't. `load` gets its context type from `setup`, but sort-keys puts `load` first.\n" +
  "route({ load: ({ context }) => context.user, setup: () => ({ user }) });\n\n" +
  "// Do. Each step is its own call, so its type flows in call order, not key order.\n" +
  "route()\n" +
  "  .setup(() => ({ user }))\n" +
  "  .load(({ context }) => context.user);\n" +
  "```";

/** Rewrites of `references/patterns.md` by skill name, applied in order after the shared patterns rewrites. */
const PATTERNS_RULES: ReadonlyMap<string, readonly Rule[]> = /* @__PURE__ */ new Map([
  [
    "typescript-best-practices",
    [
      {
        id: "typescript.key-order-patterns",
        re: /^Skip on hot paths: .*$/m,
        to: `$&\n${KEY_ORDER_PATTERNS}`,
      },
    ],
  ],
]);

/** The `references/patterns.md` rewrites of the skill called `name`, in order; none for a skill without any. */
export function patternsRulesOf(name: string): readonly Rule[] {
  return PATTERNS_RULES.get(name) ?? [];
}
