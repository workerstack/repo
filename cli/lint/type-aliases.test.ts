import type { TSESTree } from "@typescript-eslint/utils";
import { expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import type { RepoRule } from "./rule.types.ts";
import { typeAliasEnvironmentOf } from "./type-aliases.ts";
import { childNodes, type VisitorKeys } from "./type-parameters.ts";

/** A rule that reports, once on the program, the text `look` reads off the program oxlint parsed. */
function probe(look: (program: TSESTree.Program, visitorKeys: VisitorKeys) => string): RepoRule<"seen"> {
  return {
    create(context) {
      return {
        Program(program) {
          const text = look(program, context.sourceCode.visitorKeys);
          context.report({ data: { text }, messageId: "seen", node: program });
        },
      };
    },
    defaultOptions: [],
    meta: { messages: { seen: "{{text}}" }, schema: [], type: "problem" },
  };
}

/** The one message `probe(look)` reports over `a.ts` holding `code`. */
function seen(code: string, look: (program: TSESTree.Program, visitorKeys: VisitorKeys) => string): string[] {
  return reportsOf(probe(look), { "a.ts": code }).map((report) => report.message);
}

it("gives every rule that asks about one program the environment the first ask built", () => {
  const same = seen("type Payload = unknown;", (program, visitorKeys) =>
    String(typeAliasEnvironmentOf(program, visitorKeys) === typeAliasEnvironmentOf(program, visitorKeys)),
  );

  expect(same).toStrictEqual(["true"]);
});

it("finds no children under a node type the visitor keys do not name", () => {
  expect(seen("type A = string;", (program) => String(childNodes(program, {}).length))).toStrictEqual(["0"]);
});
