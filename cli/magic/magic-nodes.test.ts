import { TokenFlags } from "typescript/unstable/ast";
import {
  createNoSubstitutionTemplateLiteral,
  createNumericLiteral,
  createStringLiteral,
} from "typescript/unstable/ast/factory";
import { expect, it } from "vitest";

import { isMeaningful } from "./magic-nodes.ts";

it.each([
  ["an empty string", createStringLiteral("", TokenFlags.None)],
  ["punctuation alone", createStringLiteral("/-", TokenFlags.None)],
  ["a number", createNumericLiteral("7", TokenFlags.None)],
])("rejects %s", (_name, node) => {
  expect(isMeaningful(node)).toBe(false);
});

it.each([
  ["a word", createStringLiteral("quick", TokenFlags.None)],
  ["a digit", createNoSubstitutionTemplateLiteral("1", TokenFlags.None)],
])("accepts %s", (_name, node) => {
  expect(isMeaningful(node)).toBe(true);
});
