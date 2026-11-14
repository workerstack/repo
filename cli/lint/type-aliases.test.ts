import * as parser from "@typescript-eslint/parser";
import { TSESLint } from "@typescript-eslint/utils";
import { expect, it } from "vitest";

import { noUnknownReturns } from "./no-unknown-returns.ts";
import { noUnknownTypeAliases } from "./no-unknown-type-aliases.ts";
import { childNodes } from "./type-parameters.ts";

/** Two rules that both read the type alias environment, run over one parse of `code`; the rule ids they report. */
function bothRulesOn(code: string): (string | null)[] {
  const config: TSESLint.FlatConfig.Config = {
    files: ["**/*.ts"],
    languageOptions: { parser },
    plugins: { repo: { rules: { aliases: noUnknownTypeAliases, returns: noUnknownReturns } } },
    rules: { "repo/aliases": "error", "repo/returns": "error" },
  };

  return new TSESLint.Linter().verify(code, config, "a.ts").map((message) => message.ruleId);
}

it("gives the second rule that asks about a program the environment the first built", () => {
  const code = "type Payload = unknown;\nexport function read(): Payload { return 1; }\n";
  expect(bothRulesOn(code)).toStrictEqual(["repo/aliases", "repo/returns"]);
});

it("finds no children under a node type the visitor keys do not name", () => {
  const { ast } = parser.parseForESLint("type A = string;");
  expect(childNodes(ast, {})).toStrictEqual([]);
});
