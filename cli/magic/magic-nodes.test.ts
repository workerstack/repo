import ts from "typescript";
import { expect, it } from "vitest";

import { isMeaningful } from "./magic-nodes.ts";

it.each([
  ["an empty string", ts.factory.createStringLiteral("")],
  ["punctuation alone", ts.factory.createStringLiteral("/-")],
  ["a number", ts.factory.createNumericLiteral(7)],
])("rejects %s", (_name, node) => {
  expect(isMeaningful(node)).toBe(false);
});

it.each([
  ["a word", ts.factory.createStringLiteral("quick")],
  ["a digit", ts.factory.createNoSubstitutionTemplateLiteral("1")],
])("accepts %s", (_name, node) => {
  expect(isMeaningful(node)).toBe(true);
});
